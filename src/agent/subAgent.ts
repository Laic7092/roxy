/**
 * SubAgent - 后台任务执行管理
 *
 * 职责：
 * - 管理后台 SubAgent 任务
 * - 执行 SubAgent 任务循环
 * - 通知主 Agent 任务结果
 */

import { v4 as uuidv4 } from 'uuid'
import type { LiteLLMProvider } from '../provider/llm'
import type { EventBus } from '../bus/instance'
import type { SessionManager } from '../session/manager'
import type { ToolExecutor } from '../tools/ToolExecutor'
import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'

export interface SubAgentTask {
  id: string
  label: string
  task: string
  sessionId: string
  channelId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  result?: string
  error?: string
  createdAt: Date
  completedAt?: Date
  // 父 Agent 的上下文（用于返回结果）
  parentChannelId: string
  parentSessionId: string
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
  eventBus: EventBus
  sessionManager: SessionManager
  toolExecutor: ToolExecutor
  config?: SubAgentConfig
  workspace: string
}

export class SubAgentManager {
  private static readonly DEFAULT_MAX_ITERATIONS = 15
  private static readonly DEFAULT_TEMPERATURE = 0.7
  private static readonly DEFAULT_MAX_TOKENS = 4096

  private provider: LiteLLMProvider
  private eventBus: EventBus
  private sessionManager: SessionManager
  private toolExecutor: ToolExecutor
  private workspace: string
  private config: Required<SubAgentConfig>

  // 运行中的任务
  private runningTasks: Map<string, Promise<void>> = new Map()
  // 会话 -> 任务 ID 映射
  private sessionTasks: Map<string, Set<string>> = new Map()

  constructor(deps: SubAgentManagerDeps) {
    this.provider = deps.provider
    this.eventBus = deps.eventBus
    this.sessionManager = deps.sessionManager
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
      sessionId: parentSessionId ? `subagent:${parentSessionId}:${taskId}` : 'subagent:' + taskId,
      channelId: parentChannelId || 'subagent',
      status: 'pending',
      createdAt: new Date(),
      parentChannelId: parentChannelId || 'subagent',
      parentSessionId: parentSessionId || 'subagent',
    }

    // 创建执行 Promise
    const executionPromise = this.runSubAgent(subAgentTask)

    // 存储任务引用
    this.runningTasks.set(taskId, executionPromise)

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

    log('info', `Spawned subagent [${taskId}]: ${displayLabel}`, 'SubAgentManager')

    // 发布 SubAgent 开始事件
    this.eventBus.publishSubAgentStart({
      taskId,
      label: displayLabel,
      task,
      parentChannelId,
      parentSessionId,
    })

    return `Subagent [${displayLabel}] started (id: ${taskId}). I'll notify you when it completes.`
  }

  /**
   * 执行 SubAgent 任务
   */
  private async runSubAgent(task: SubAgentTask): Promise<void> {
    log('info', `Subagent [${task.id}] starting task: ${task.label}`, 'SubAgentManager')

    try {
      task.status = 'running'

      // 获取或创建会话
      const session = await this.sessionManager.getOrCreate(task.sessionId)

      // 添加用户消息
      session.addMessage('user', task.task)

      // 构建消息历史
      let messages = this.buildMessages(session.messages)

      // 获取工具定义
      const tools = await this.toolExecutor.getToolDefinitions()

      // 执行 Agent 循环
      let iteration = 0
      let finalResult: string | null = null

      while (iteration < this.config.maxIterations) {
        iteration++

        // 调用 LLM
        const result = await this.provider.chat({
          messages,
          model: this.config.model,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          tools,
          tool_choice: 'auto',
        })

        const toolCalls = result?.choices?.[0]?.message?.tool_calls

        if (toolCalls && toolCalls.length > 0) {
          // 添加助手消息
          const { content, tool_calls } = result.choices[0].message
          session.addMessage('assistant', content || '', tool_calls)

          // 执行工具调用
          const toolResults = await this.toolExecutor.executeTools(
            toolCalls.map((call: any) => ({
              name: call.function.name,
              arguments: call.function.arguments,
              id: call.id,
            })),
          )

          // 添加工具结果
          for (const toolResult of toolResults) {
            session.addMessage('tool', toolResult.result, toolResult.tool_call_id)
            // 注意：不发布工具结果事件到主 Agent 通道，因为这是 SubAgent 的内部执行
            // 只在 SubAgent 自己的会话中记录
          }

          // 重新构建消息
          messages = this.buildMessages(session.messages)
        } else {
          // 没有工具调用，获取最终响应
          const { content } = result.choices[0].message
          if (content) {
            session.addMessage('assistant', content)
            finalResult = content
            // 注意：不直接发布响应事件，由 announceResult 通过 subagent:complete 事件通知
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

      log('info', `Subagent [${task.id}] completed successfully`, 'SubAgentManager')

      // 通知主 Agent
      await this.announceResult(task, 'ok')
    } catch (error) {
      task.status = 'failed'
      task.error = error instanceof Error ? error.message : 'Unknown error'
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

      // 通知主 Agent
      await this.announceResult(task, 'error')

      throw error
    }
  }

  /**
   * 构建消息历史
   */
  private buildMessages(sessionMessages: any[]): any[] {
    return [
      { role: 'system', content: this.buildSystemPrompt() },
      ...sessionMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        tool_calls: (msg as any).tool_calls,
        tool_call_id: (msg as any).tool_call_id,
      })),
    ]
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    const timeCtx = new Date().toISOString()

    return `# SubAgent

${timeCtx}

You are a subagent spawned by the main agent to complete a specific task.
Stay focused on the assigned task. Your final response will be reported back to the main agent.

## Workspace
${this.workspace}

## Guidelines
- Use available tools to accomplish the task
- Provide a clear final response when done
- Keep responses concise and focused`
  }

  /**
   * 通知主 Agent 任务结果
   */
  private async announceResult(task: SubAgentTask, status: 'ok' | 'error'): Promise<void> {
    const statusText = status === 'ok' ? 'completed successfully' : 'failed'

    const announceContent = `[Subagent '${task.label}' ${statusText}]

Task: ${task.task}

Result:
${task.result || task.error}`

    // 发布 SubAgent 完成事件
    this.eventBus.publishSubAgentComplete({
      taskId: task.id,
      label: task.label,
      parentChannelId: task.parentChannelId,
      parentSessionId: task.parentSessionId,
      result: announceContent,
      success: status === 'ok',
      error: status === 'error' ? task.error : undefined,
    })

    log(
      'debug',
      `Subagent [${task.id}] announced result to ${task.parentChannelId}`,
      'SubAgentManager',
    )
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
      const taskPromise = this.runningTasks.get(taskId)
      if (taskPromise) {
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
