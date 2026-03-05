import type { LiteLLMProvider } from '../provider/llm'
import type { ContextMng } from './context'
import type { Session, SessionMessage, SessionManager } from '../session/manager'
import type { ToolExecutor } from '../tools/ToolExecutor'
import type { EventBus } from '../bus/instance'
import type { AgentConfig, AgentTask } from './types'
import { TaskStatus } from './types'
import { RoxyError, ErrorCode, isRecoverableError } from '../types/errors'
import { logError, log, withTimeout } from '../utils/error-handler'
import { v4 as uuidv4 } from 'uuid'

export interface AgentLoopDeps {
  config: AgentConfig
  provider: LiteLLMProvider
  toolExecutor: ToolExecutor
  eventBus: EventBus
  context: ContextMng
  sessionManager: SessionManager
}

/**
 * AgentLoop - 事件驱动的消息处理器
 *
 * 职责：
 * - 监听 agent:execute 事件执行任务
 * - 处理 LLM 对话和工具调用
 * - 发布响应事件到 EventBus
 */
export class AgentLoop {
  // 配置常量
  private static readonly MAX_ITERATIONS = 20
  private static readonly MAX_TIME_MS = 5 * 60 * 1000 // 5 分钟
  private static readonly LLM_TIMEOUT_MS = 30000 // 30 秒

  private config: AgentConfig
  private provider: LiteLLMProvider
  private toolExecutor: ToolExecutor
  private eventBus: EventBus
  private context: ContextMng
  private sessionManager: SessionManager

  // 当前会话引用
  private session: Session | null = null

  constructor(deps: AgentLoopDeps) {
    this.config = deps.config
    this.provider = deps.provider
    this.toolExecutor = deps.toolExecutor
    this.eventBus = deps.eventBus
    this.context = deps.context
    this.sessionManager = deps.sessionManager

    // 订阅执行事件
    this.setupEventHandlers()
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    // 监听 agent:execute 事件
    this.eventBus.on('agent:execute', async (event) => {
      // 只处理分配给此 Agent 的任务
      if (event.task.agentId === this.config.id) {
        await this.executeTask(event.task)
      }
    })

    // 监听 subagent:complete 事件
    this.eventBus.on('subagent:complete', (event) => {
      // 只处理属于当前会话的结果
      if (this.session && event.parentSessionId === this.session.id) {
        this.handleSubAgentComplete(event)
      }
    })
  }

  /**
   * 处理 SubAgent 完成事件
   */
  private handleSubAgentComplete(event: any): void {
    log(
      'debug',
      `SubAgent complete event received: sessionId=${event.parentSessionId}, currentSession=${this.session?.id}`,
      'AgentLoop',
    )

    // 只处理属于当前会话的结果
    if (!this.session || event.parentSessionId !== this.session.id) {
      log('debug', `Session mismatch, skipping`, 'AgentLoop')
      return
    }

    // 添加结果到会话
    this.session.addMessage('assistant', event.result)

    log('debug', `SubAgent [${event.taskId}] result saved to session`, 'AgentLoop')
  }

  /**
   * 执行任务
   */
  private async executeTask(task: AgentTask): Promise<void> {
    const startTime = Date.now()

    try {
      // 更新任务状态
      task.status = TaskStatus.RUNNING

      // 获取或创建会话
      this.session = await this.getOrCreateSession(task.sessionId)

      // 添加用户消息
      this.session.addMessage('user', task.content)

      // 构建上下文
      let contextMessages = await this.context.buildContext(this.session.messages)

      // 获取工具定义
      const tools = await this.toolExecutor.getToolDefinitions()

      // 循环处理，直到没有工具调用
      let hasToolCalls = true
      let iteration = 0
      let aiResponse = ''

      while (hasToolCalls && iteration < AgentLoop.MAX_ITERATIONS) {
        // 检查超时
        const elapsed = Date.now() - startTime
        if (elapsed >= AgentLoop.MAX_TIME_MS) {
          const timeoutError = new RoxyError(
            ErrorCode.TIMEOUT,
            `Processing timeout (${AgentLoop.MAX_TIME_MS}ms) exceeded`,
          )
          logError(timeoutError, 'error', 'AgentLoop')
          this.session.addMessage('assistant', '处理超时，请简化您的请求。')
          break
        }

        iteration++
        hasToolCalls = false

        try {
          // 调用 LLM API（带超时）
          const result = await withTimeout(
            this.provider.chat({
              messages: contextMessages,
              model: this.config.model || this.provider.cfg.model,
              stream: true,
              onStreamData: (chunk) => this.handleStreamData(task, chunk),
              tools,
              tool_choice: 'auto',
            }),
            AgentLoop.LLM_TIMEOUT_MS,
            'LLM chat',
          )

          // 检查是否需要执行工具调用
          const toolCalls = result?.choices?.[0]?.message?.tool_calls

          if (toolCalls && toolCalls.length > 0) {
            hasToolCalls = true

            // 发布工具调用事件
            for (const toolCall of toolCalls) {
              try {
                const args = JSON.parse(toolCall.function.arguments)
                this.eventBus.publishAgentToolCall({
                  agentId: this.config.id,
                  taskId: task.id,
                  channelId: task.channelId,
                  sessionId: task.sessionId,
                  toolName: toolCall.function.name,
                  toolArgs: args,
                  toolCallId: toolCall.id,
                })
              } catch (e) {
                const parseError = new RoxyError(
                  ErrorCode.TOOL_ARGUMENT_PARSE_ERROR,
                  `Failed to parse tool arguments for '${toolCall.function.name}'`,
                  e instanceof Error ? e : undefined,
                  { rawArguments: toolCall.function.arguments },
                )
                logError(parseError, 'warn', 'AgentLoop')
              }
            }

            // 执行工具调用
            const toolResults = await this.toolExecutor.executeTools(
              toolCalls.map((call) => ({
                name: call.function.name,
                arguments: call.function.arguments,
                id: call.id,
              })),
              { channelId: task.channelId, sessionId: task.sessionId },
            )

            // 发布工具结果事件
            for (const toolResult of toolResults) {
              this.eventBus.publishAgentToolResult({
                agentId: this.config.id,
                taskId: task.id,
                channelId: task.channelId,
                sessionId: task.sessionId,
                toolName: toolResult.name,
                toolResult: toolResult.result,
                toolCallId: toolResult.tool_call_id,
              })
            }

            // 将工具调用结果添加到消息历史中
            const { content, tool_calls } = result?.choices?.[0]?.message
            let init = false
            for (const toolResult of toolResults) {
              if (!init) {
                this.session.addMessage('assistant', content ?? '', tool_calls)
                init = true
              }
              this.session.addMessage('tool', toolResult.result, toolResult.tool_call_id)
            }

            // 重新构建上下文
            contextMessages = await this.context.buildContext(this.session.messages)
          } else {
            // 没有工具调用，处理最终的 AI 响应
            if (result && result.choices && result.choices[0] && result.choices[0].message) {
              const { content } = result.choices[0].message
              if (content) {
                this.session.addMessage('assistant', content)
                aiResponse = content

                // 发布最终响应事件
                this.eventBus.publishAgentResponse({
                  agentId: this.config.id,
                  taskId: task.id,
                  channelId: task.channelId,
                  sessionId: task.sessionId,
                  content: content,
                })
              }
            }
            break
          }
        } catch (error) {
          const roxyError =
            error instanceof RoxyError
              ? error
              : new RoxyError(
                  ErrorCode.LLM_API_ERROR,
                  `AgentLoop iteration ${iteration} failed`,
                  error instanceof Error ? error : undefined,
                )

          logError(roxyError, 'warn', 'AgentLoop')

          // 检查是否为可恢复错误
          if (isRecoverableError(roxyError)) {
            const retryMsg = `Retrying after error: ${roxyError.message}`
            log('warn', retryMsg, 'AgentLoop')
            continue
          }

          // 致命错误，抛出
          throw roxyError
        }
      }

      // 检查是否达到最大迭代次数
      if (iteration >= AgentLoop.MAX_ITERATIONS && hasToolCalls) {
        log('warn', `Reached maximum iteration limit (${AgentLoop.MAX_ITERATIONS})`, 'AgentLoop')
        this.session.addMessage('assistant', '工具调用次数过多，请简化您的请求。')
      }

      // 任务完成
      task.status = TaskStatus.COMPLETED
      task.result = aiResponse
      task.completedAt = new Date()
    } catch (error) {
      // 任务失败
      task.status = TaskStatus.FAILED
      task.error = error instanceof Error ? error.message : 'Unknown error'
      task.completedAt = new Date()

      const roxyError =
        error instanceof RoxyError
          ? error
          : new RoxyError(
              ErrorCode.SYSTEM_ERROR,
              'AgentLoop.executeTask failed',
              error instanceof Error ? error : undefined,
            )

      logError(roxyError, 'error', 'AgentLoop')

      // 发布错误事件
      this.eventBus.publishError({
        agentId: this.config.id,
        taskId: task.id,
        sessionId: task.sessionId,
        channelId: task.channelId,
        error: roxyError,
        timestamp: new Date(),
      })

      // 抛出错误
      throw roxyError
    }
  }

  /**
   * 处理流式数据
   */
  private handleStreamData(task: AgentTask, chunk: string): void {
    this.eventBus.publishAgentStream({
      agentId: this.config.id,
      taskId: task.id,
      channelId: task.channelId,
      sessionId: task.sessionId,
      chunk,
      timestamp: new Date(),
    })
  }

  /**
   * 获取或创建会话
   */
  private async getOrCreateSession(sessionId: string): Promise<Session> {
    return this.sessionManager.getOrCreate(sessionId)
  }

  /**
   * 获取当前会话
   */
  getSession(): Session | null {
    return this.session
  }

  /**
   * 处理直接调用（向后兼容）
   * @deprecated 使用事件驱动方式代替
   */
  async process(task: AgentTask): Promise<string> {
    await this.executeTask(task)
    return task.result || ''
  }
}
