import { readFile } from 'fs/promises'
import { join } from 'path'
import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'
import type LLMProvider from '../provider/base'
import type { SessionManager } from '../session/manager'
import type { ChannelManager } from '../channels/manager'

/**
 * Heartbeat 工具定义
 */
const HEARTBEAT_TOOL = {
  name: 'heartbeat',
  description: 'Report heartbeat decision after reviewing tasks.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['skip', 'run'],
        description: 'skip = nothing to do, run = has active tasks',
      },
      tasks: {
        type: 'string',
        description: 'Natural-language summary of active tasks (required for run)',
      },
    },
    required: ['action'],
  },
}

/**
 * HeartbeatService - 定时唤醒 Agent 检查任务
 *
 * Phase 1 (决策): 读取 HEARTBEAT.md 并通过工具调用询问 LLM 是否有活跃任务
 * Phase 2 (执行): 仅当 Phase 1 返回 run 时，通过回调执行任务
 */
export interface HeartbeatServiceConfig {
  /** 心跳间隔（秒），默认 30 分钟 */
  intervalSeconds?: number
  /** 是否启用，默认 true */
  enabled?: boolean
}

export interface HeartbeatCallbacks {
  /** 任务执行回调 */
  onExecute?: (tasks: string) => Promise<string>
  /** 结果通知回调 */
  onNotify?: (response: string, target?: { channelId: string; sessionId: string }) => Promise<void>
}

export class HeartbeatService {
  private workspace: string
  private provider: LLMProvider
  private model: string
  private sessionManager?: SessionManager
  private channelManager?: ChannelManager
  private onExecute?: (tasks: string) => Promise<string>
  private onNotify?: (
    response: string,
    target?: { channelId: string; sessionId: string },
  ) => Promise<void>
  private intervalSeconds: number
  private enabled: boolean
  private _running = false
  private timer: NodeJS.Timeout | null = null
  private heartbeatFilePath: string

  constructor(
    workspace: string,
    provider: LLMProvider,
    model: string,
    callbacks?: HeartbeatCallbacks,
    config?: HeartbeatServiceConfig,
    deps?: {
      sessionManager?: SessionManager
      channelManager?: ChannelManager
    },
  ) {
    this.workspace = workspace
    this.provider = provider
    this.model = model
    this.onExecute = callbacks?.onExecute
    this.onNotify = callbacks?.onNotify
    this.intervalSeconds = config?.intervalSeconds ?? 30 * 60 // 默认 30 分钟
    this.enabled = config?.enabled ?? true
    this.heartbeatFilePath = join(workspace, 'HEARTBEAT.md')
    this.sessionManager = deps?.sessionManager
    this.channelManager = deps?.channelManager
  }

  /**
   * 智能选择心跳通知的目标渠道和会话
   * 优先选择最近更新的非内部会话
   */
  private async pickHeartbeatTarget(): Promise<{ channelId: string; sessionId: string }> {
    // 如果有 ChannelManager，优先使用启用的外部渠道
    if (this.channelManager) {
      const enabledChannels = this.channelManager.enabledChannels

      // 如果有 SessionManager，查找最近更新的会话
      if (this.sessionManager) {
        const sessions = await this.sessionManager.listSessions()
        for (const session of sessions) {
          const key = session.key || ''
          if (!key.includes(':')) continue

          const [channelId, sessionId] = key.split(':', 2)

          // 跳过内部渠道
          if (channelId === 'cli' || channelId === 'system' || channelId === 'heartbeat') continue

          // 检查是否是启用的渠道
          if (enabledChannels.includes(channelId) && sessionId) {
            log(
              'debug',
              `Selected channel ${channelId}:${sessionId} for heartbeat notification`,
              'HeartbeatService',
            )
            return { channelId, sessionId }
          }
        }
      }

      // 返回第一个启用的外部渠道
      for (const channelId of enabledChannels) {
        if (channelId !== 'cli' && channelId !== 'system') {
          return { channelId, sessionId: 'default' }
        }
      }
    }

    // 默认返回 cli
    return { channelId: 'cli', sessionId: 'direct' }
  }

  /**
   * 读取 HEARTBEAT.md 文件
   */
  private async readHeartbeatFile(): Promise<string | null> {
    try {
      const content = await readFile(this.heartbeatFilePath, 'utf-8')
      return content.trim() || null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      logError(
        new RoxyError(
          ErrorCode.SYSTEM_ERROR,
          'Failed to read HEARTBEAT.md',
          error instanceof Error ? error : undefined,
        ),
        'warn',
        'HeartbeatService',
      )
      return null
    }
  }

  /**
   * Phase 1: 让 LLM 决定 skip/run
   */
  private async decide(content: string): Promise<{ action: string; tasks: string }> {
    try {
      const response = await this.provider.chat({
        messages: [
          {
            role: 'system',
            content: 'You are a heartbeat agent. Call the heartbeat tool to report your decision.',
          },
          {
            role: 'user',
            content: `Review the following HEARTBEAT.md and decide whether there are active tasks.\n\n${content}`,
          },
        ],
        model: this.model,
        tools: [HEARTBEAT_TOOL],
        tool_choice: 'auto',
        think: false,
      })

      const toolCalls = response.choices?.[0]?.message?.tool_calls

      if (!toolCalls || toolCalls.length === 0) {
        log(
          'info',
          'Heartbeat: LLM did not call heartbeat tool, defaulting to skip',
          'HeartbeatService',
        )
        return { action: 'skip', tasks: '' }
      }

      const args = JSON.parse(toolCalls[0].function.arguments)
      return {
        action: args.action || 'skip',
        tasks: args.tasks || '',
      }
    } catch (error) {
      logError(
        new RoxyError(
          ErrorCode.LLM_API_ERROR,
          'Heartbeat decision failed',
          error instanceof Error ? error : undefined,
        ),
        'error',
        'HeartbeatService',
      )
      return { action: 'skip', tasks: '' }
    }
  }

  /**
   * 执行一次心跳检查
   */
  private async tick(): Promise<void> {
    const content = await this.readHeartbeatFile()

    if (!content) {
      log('debug', 'Heartbeat: HEARTBEAT.md missing or empty', 'HeartbeatService')
      return
    }

    log('info', 'Heartbeat: checking for tasks...', 'HeartbeatService')

    try {
      const { action, tasks } = await this.decide(content)

      if (action !== 'run') {
        log('info', 'Heartbeat: OK (nothing to report)', 'HeartbeatService')
        return
      }

      log('info', `Heartbeat: tasks found, executing...`, 'HeartbeatService')

      if (this.onExecute && tasks) {
        const response = await this.onExecute(tasks)
        if (response && this.onNotify) {
          // 智能选择通知渠道
          const target = await this.pickHeartbeatTarget()
          log(
            'info',
            `Heartbeat: completed, delivering response to ${target.channelId}`,
            'HeartbeatService',
          )
          await this.onNotify(response, target)
        }
      }
    } catch (error) {
      logError(
        new RoxyError(
          ErrorCode.SYSTEM_ERROR,
          'Heartbeat execution failed',
          error instanceof Error ? error : undefined,
        ),
        'error',
        'HeartbeatService',
      )
    }
  }

  /**
   * 启动心跳服务
   */
  async start(): Promise<void> {
    if (!this.enabled) {
      log('info', 'Heartbeat disabled', 'HeartbeatService')
      return
    }

    if (this._running) {
      log('warn', 'Heartbeat already running', 'HeartbeatService')
      return
    }

    this._running = true
    this.scheduleNextTick()
    log('info', `Heartbeat started (every ${this.intervalSeconds}s)`, 'HeartbeatService')
  }

  /**
   * 停止心跳服务
   */
  stop(): void {
    this._running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    log('info', 'Heartbeat stopped', 'HeartbeatService')
  }

  /**
   * 调度下一次心跳
   */
  private scheduleNextTick(): void {
    if (!this._running) {
      return
    }

    this.timer = setTimeout(async () => {
      if (this._running) {
        await this.tick()
        this.scheduleNextTick()
      }
    }, this.intervalSeconds * 1000)
  }

  /**
   * 手动触发一次心跳
   */
  async triggerNow(): Promise<string | null> {
    const content = await this.readHeartbeatFile()
    if (!content) {
      return null
    }

    const { action, tasks } = await this.decide(content)
    if (action !== 'run' || !this.onExecute || !tasks) {
      return null
    }

    return await this.onExecute(tasks)
  }

  get isRunning(): boolean {
    return this._running
  }
}
