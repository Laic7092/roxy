/**
 * SubAgent - 后台任务执行管理
 *
 * 职责：
 * - 管理后台 SubAgent 任务
 * - 执行 SubAgent 任务循环
 * - 通过事件总线通知主 Agent 任务结果
 */

import { v4 as uuidv4 } from 'uuid'
import type { LiteLLMProvider } from '../provider/llm'
import type { ToolExecutor } from '../tools/ToolExecutor'
import type { Bus } from '../bus/instance'
import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface SubAgentTask {
  id: string
  label: string
  task: string
  parentChannelId: string
  parentSessionId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  result?: string
  error?: string
  createdAt: Date
  completedAt?: Date
}

export interface SubAgentConfig {
  model?: string
  temperature?: number
  maxTokens?: number
  reasoningEffort?: string
  maxIterations?: number
  restrictToWorkspace?: boolean
  execConfig?: {
    timeout?: number
    pathAppend?: string[]
  }
}

export interface SubAgentManagerDeps {
  provider: LiteLLMProvider
  bus: Bus
  toolExecutor: ToolExecutor
  config?: SubAgentConfig
  workspace: string
}

export class SubAgentManager {
  private static readonly DEFAULT_MAX_ITERATIONS = 15
  private static readonly DEFAULT_TEMPERATURE = 0.7
  private static readonly DEFAULT_MAX_TOKENS = 4096

  private provider: LiteLLMProvider
  private bus: Bus
  private toolExecutor: ToolExecutor
  private workspace: string
  private config: Required<SubAgentConfig>

  // 运行中的任务和取消控制器
  private runningTasks: Map<string, { promise: Promise<void>; abortController: AbortController }> =
    new Map()
  // 会话 -> 任务 ID 映射
  private sessionTasks: Map<string, Set<string>> = new Map()

  constructor(deps: SubAgentManagerDeps) {
    this.provider = deps.provider
    this.bus = deps.bus
    this.toolExecutor = deps.toolExecutor
    this.workspace = deps.workspace

    // 合并默认配置
    this.config = {
      model: deps.config?.model || deps.provider.cfg.model,
      temperature: deps.config?.temperature ?? SubAgentManager.DEFAULT_TEMPERATURE,
      maxTokens: deps.config?.maxTokens ?? SubAgentManager.DEFAULT_MAX_TOKENS,
      reasoningEffort: deps.config?.reasoningEffort,
      maxIterations: deps.config?.maxIterations ?? SubAgentManager.DEFAULT_MAX_ITERATIONS,
      restrictToWorkspace: deps.config?.restrictToWorkspace ?? false,
      execConfig: deps.config?.execConfig || {},
    }
  }

  /**
   * Spawn 一个 SubAgent 任务
   * @param task 任务内容
   * @param label 任务标签（可选）
   * @param parentChannelId 父 Agent 的通道 ID
   * @param parentSessionId 父 Agent 的会话 ID
   */
  async spawn(
    task: string,
    label?: string,
    parentChannelId?: string,
    parentSessionId?: string,
  ): Promise<string> {
    const taskId = uuidv4().slice(0, 8)
    const displayLabel = label || (task.length > 30 ? task.slice(0, 30) + '...' : task)

    // 创建任务对象
    const subAgentTask: SubAgentTask = {
      id: taskId,
      label: displayLabel,
      task,
      parentChannelId: parentChannelId || 'subagent',
      parentSessionId: parentSessionId || 'subagent',
      status: 'pending',
      createdAt: new Date(),
    }

    // 创建取消控制器
    const abortController = new AbortController()

    // 创建执行 Promise
    const executionPromise = this.runSubAgent(subAgentTask, abortController.signal)

    // 存储任务引用
    this.runningTasks.set(taskId, { promise: executionPromise, abortController })

    // 更新会话映射（使用父会话 ID）
    if (parentSessionId) {
      if (!this.sessionTasks.has(parentSessionId)) {
        this.sessionTasks.set(parentSessionId, new Set())
      }
      this.sessionTasks.get(parentSessionId)!.add(taskId)
    }

    // 任务完成后的清理
    const cleanup = () => {
      this.runningTasks.delete(taskId)
      if (parentSessionId) {
        const taskIds = this.sessionTasks.get(parentSessionId)
        if (taskIds) {
          taskIds.delete(taskId)
          if (taskIds.size === 0) {
            this.sessionTasks.delete(parentSessionId)
          }
        }
      }
    }

    executionPromise.finally(cleanup)

    log('debug', `Spawned subagent [${taskId}]: ${displayLabel}`, 'SubAgentManager')

    // 通过事件总线通知主 Agent
    this.bus.emit('subagent:start', {
      taskId,
      label: displayLabel,
      task,
      parentChannelId: parentChannelId || 'subagent',
      parentSessionId: parentSessionId || 'subagent',
      timestamp: new Date(),
    })

    return `Subagent [${displayLabel}] started (id: ${taskId}). I'll notify you when it completes.`
  }

  /**
   * 执行 SubAgent 任务
   */
  private async runSubAgent(
    task: SubAgentTask,
    signal: AbortSignal,
  ): Promise<void> {
    log('debug', `Subagent [${task.id}] starting task: ${task.label}`, 'SubAgentManager')

    try {
      task.status = 'running'

      // 构建消息历史（内存中，不持久化）
      const messages: Array<{
        role: string
        content: string
        tool_calls?: any[]
        tool_call_id?: string
      }> = [
        { role: 'system', content: this.buildSystemPrompt() },
        { role: 'user', content: task.task },
      ]

      // 为 SubAgent 创建独立的工具注册表
      const subAgentTools = await this.buildSubAgentTools()

      // 执行 Agent 循环
      let iteration = 0
      let finalResult: string | null = null

      while (iteration < this.config.maxIterations) {
        // 检查是否被取消
        if (signal.aborted) {
          throw new RoxyError(ErrorCode.SYSTEM_ERROR, 'Subagent cancelled by user')
        }

        iteration++

        // 调用 LLM
        const result = await this.provider.chat({
          messages,
          model: this.config.model,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          tools: subAgentTools,
          tool_choice: 'auto',
        })

        const toolCalls = result?.choices?.[0]?.message?.tool_calls

        if (toolCalls && toolCalls.length > 0) {
          // 添加助手消息
          const { content, tool_calls } = result.choices[0].message
          messages.push({
            role: 'assistant',
            content: content || '',
            tool_calls,
          })

          // 执行工具调用
          const toolResults = await this.toolExecutor.executeTools(
            toolCalls.map((call: any) => ({
              name: call.function.name,
              arguments: call.function.arguments,
              id: call.id,
            })),
            { channelId: task.parentChannelId, sessionId: task.parentSessionId },
          )

          // 添加工具结果
          for (const toolResult of toolResults) {
            messages.push({
              role: 'tool',
              tool_call_id: toolResult.tool_call_id,
              content: toolResult.result,
            })
          }
        } else {
          // 没有工具调用，获取最终响应
          const { content } = result.choices[0].message
          if (content) {
            finalResult = content
          }
          break
        }
      }

      if (finalResult === null) {
        finalResult = 'Task completed but no final response was generated.'
      }

      task.status = 'completed'
      task.result = finalResult
      task.completedAt = new Date()

      log('debug', `Subagent [${task.id}] completed successfully`, 'SubAgentManager')

      // 通过事件总线通知主 Agent
      await this.announceResult(task, 'ok')
    } catch (error) {
      // 检查是否是取消导致的错误
      if (signal.aborted) {
        task.status = 'cancelled'
        task.error = 'Subagent cancelled by user'
      } else {
        task.status = 'failed'
        task.error = error instanceof Error ? error.message : 'Unknown error'
      }
      task.completedAt = new Date()

      logError(
        error instanceof RoxyError
          ? error
          : new RoxyError(
              ErrorCode.SYSTEM_ERROR,
              `Subagent [${task.id}] failed`,
              error instanceof Error ? error : undefined,
            ),
        'error',
        'SubAgentManager',
      )

      // 通过事件总线通知主 Agent
      await this.announceResult(task, 'error')

      throw error
    }
  }

  /**
   * 为 SubAgent 构建独立的工具列表
   * 排除 spawn 工具，防止递归 spawn
   */
  private async buildSubAgentTools(): Promise<any[]> {
    const allTools = await this.toolExecutor.getToolDefinitions()
    // 排除 spawn 工具，防止 SubAgent 再 spawn 子任务
    return allTools.filter((tool: any) => tool.function.name !== 'spawn')
  }

  /**
   * 构建系统提示词（支持技能系统）
   */
  private buildSystemPrompt(): string {
    const timeCtx = new Date().toISOString()
    const parts = [
      `# SubAgent

${timeCtx}

You are a subagent spawned by the main agent to complete a specific task.
Stay focused on the assigned task. Your final response will be reported back to the main agent.

## Workspace
${this.workspace}`,
    ]

    // 加载技能系统
    const skillsSummary = this.loadSkillsSummary()
    if (skillsSummary) {
      parts.push(`## Skills

Read SKILL.md with read_file to use a skill.

${skillsSummary}`)
    }

    return parts.join('\n\n')
  }

  /**
   * 加载技能摘要
   */
  private loadSkillsSummary(): string | null {
    const skillMdPath = join(this.workspace, 'SKILL.md')
    if (!existsSync(skillMdPath)) {
      return null
    }

    try {
      const content = readFileSync(skillMdPath, 'utf-8')
      // 返回技能文件内容作为摘要
      return content.trim()
    } catch {
      return null
    }
  }

  /**
   * 通知主 Agent 任务结果
   */
  private async announceResult(task: SubAgentTask, status: 'ok' | 'error'): Promise<void> {
    const statusText = status === 'ok' ? 'completed successfully' : 'failed'

    // 构建通知内容（类似 Python 版本）
    const announceContent = `[Subagent '${task.label}' ${statusText}]

Task: ${task.task}

Result:
${task.result || task.error}

Summarize this naturally for the user. Keep it brief (1-2 sentences). Do not mention technical details like "subagent" or task IDs.`

    // 通过 subagent:complete 事件通知
    this.bus.emit('subagent:complete', {
      taskId: task.id,
      label: task.label,
      parentChannelId: task.parentChannelId,
      parentSessionId: task.parentSessionId,
      result: announceContent,
      success: status === 'ok',
      error: status === 'error' ? task.error : undefined,
      timestamp: new Date(),
    })

    log('debug', `Subagent [${task.id}] announced result via event bus`, 'SubAgentManager')
  }

  /**
   * 取消指定会话的所有 SubAgent 任务
   */
  async cancelBySession(sessionId: string): Promise<number> {
    const taskIds = this.sessionTasks.get(sessionId)
    if (!taskIds || taskIds.size === 0) {
      return 0
    }

    let cancelled = 0

    for (const taskId of taskIds) {
      const taskRef = this.runningTasks.get(taskId)
      if (taskRef) {
        // 真正中断任务
        taskRef.abortController.abort()
        this.runningTasks.delete(taskId)
        cancelled++
        log('info', `Cancelled subagent [${taskId}] for session ${sessionId}`, 'SubAgentManager')
      }
    }

    this.sessionTasks.delete(sessionId)
    return cancelled
  }

  /**
   * 获取运行中的 SubAgent 数量
   */
  getRunningCount(): number {
    return this.runningTasks.size
  }
}
