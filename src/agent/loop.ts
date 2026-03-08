import type { LiteLLMProvider } from '../provider/llm'
import type { ContextMng } from './context'
import type { Session, SessionManager } from '../session/manager'
import type { ToolExecutor } from '../tools/ToolExecutor'
import type { Bus } from '../bus/instance'
import type { AgentConfig } from './types'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError, log } from '../utils/error-handler'

export interface AgentLoopDeps {
  config: AgentConfig
  provider: LiteLLMProvider
  toolExecutor: ToolExecutor
  bus: Bus
  context: ContextMng
  sessionManager: SessionManager
}

export interface RunContext {
  taskId: string
  agentId: string
  channelId: string
  sessionId: string
  content: string
}

export interface RunResult {
  content: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
}

/**
 * AgentLoop - LLM 对话引擎
 *
 * 职责：
 * - 处理 LLM 对话和工具调用循环
 * - 发布响应/工具调用事件到 Bus
 */
export class AgentLoop {
  private static readonly MAX_ITERATIONS = 20
  private static readonly MAX_TIME_MS = 5 * 60 * 1000

  private config: AgentConfig
  private provider: LiteLLMProvider
  private toolExecutor: ToolExecutor
  private bus: Bus
  private context: ContextMng
  private sessionManager: SessionManager
  private session: Session | null = null

  constructor(deps: AgentLoopDeps) {
    this.config = deps.config
    this.provider = deps.provider
    this.toolExecutor = deps.toolExecutor
    this.bus = deps.bus
    this.context = deps.context
    this.sessionManager = deps.sessionManager

    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    this.bus.on('agent:execute', async (event) => {
      if (event.agentId === this.config.id) {
        await this.run(event)
      }
    })

    this.bus.on('subagent:complete', () => {
      // SubAgent 完成事件，当前无需处理
    })
  }

  /**
   * 运行 LLM 对话
   */
  async run(ctx: RunContext): Promise<RunResult> {
    const startTime = Date.now()

    this.session = await this.sessionManager.getOrCreate(ctx.sessionId)
    this.session.addMessage('user', ctx.content)
    await this.sessionManager.save(ctx.sessionId)

    let contextMessages = await this.context.buildContext(this.session.messages)
    const tools = await this.toolExecutor.getToolDefinitions()

    let hasToolCalls = true
    let iteration = 0
    let aiResponse = ''
    let toolCallsResult: RunResult['toolCalls']

    while (hasToolCalls && iteration < AgentLoop.MAX_ITERATIONS) {
      const elapsed = Date.now() - startTime
      if (elapsed >= AgentLoop.MAX_TIME_MS) {
        logError(new RoxyError(ErrorCode.TIMEOUT, 'Timeout exceeded'), 'error', 'AgentLoop')
        this.session.addMessage('assistant', '处理超时')
        break
      }

      iteration++
      hasToolCalls = false

      try {
        const result = await this.provider.chat({
          messages: contextMessages,
          model: this.config.model || this.provider.cfg.model,
          stream: true,
          onStreamData: (chunk) => this.handleStreamData(ctx, chunk),
          tools,
          tool_choice: 'auto',
        })

        const { tool_calls: toolCalls, content } = result?.choices?.[0]?.message

        this.session.addMessage('assistant', content || '', toolCalls)
        await this.sessionManager.save(ctx.sessionId)

        aiResponse = content
        toolCallsResult = toolCalls

        // 只有在没有工具调用时才发送 response 事件
        // 有工具调用时，等待工具执行完成后再发送最终响应
        if (!toolCalls || toolCalls.length === 0) {
          this.bus.emit('agent:response', {
            agentId: ctx.agentId,
            taskId: ctx.taskId,
            channelId: ctx.channelId,
            sessionId: ctx.sessionId,
            content,
            toolCalls,
            timestamp: new Date(),
          })
        }

        if (toolCalls && toolCalls.length > 0) {
          hasToolCalls = true

          for (const toolCall of toolCalls) {
            try {
              const args = JSON.parse(toolCall.function.arguments)
              this.bus.emit('agent:tool_call', {
                agentId: ctx.agentId,
                taskId: ctx.taskId,
                channelId: ctx.channelId,
                sessionId: ctx.sessionId,
                toolName: toolCall.function.name,
                toolArgs: args,
                toolCallId: toolCall.id,
                timestamp: new Date(),
              })
            } catch {
              logError(
                new RoxyError(
                  ErrorCode.TOOL_ARGUMENT_PARSE_ERROR,
                  'Failed to parse tool arguments',
                ),
                'warn',
                'AgentLoop',
              )
            }
          }

          const toolResults = await this.toolExecutor.executeTools(
            toolCalls.map((call) => ({
              name: call.function.name,
              arguments: call.function.arguments,
              id: call.id,
            })),
            { channelId: ctx.channelId, sessionId: ctx.sessionId },
          )

          for (const toolResult of toolResults) {
            this.bus.emit('agent:tool_result', {
              agentId: ctx.agentId,
              taskId: ctx.taskId,
              channelId: ctx.channelId,
              sessionId: ctx.sessionId,
              toolName: toolResult.name,
              toolResult: toolResult.result,
              toolCallId: toolResult.tool_call_id,
              timestamp: new Date(),
            })

            this.session.addMessage('tool', toolResult.result, toolResult.tool_call_id)
            await this.sessionManager.save(ctx.sessionId)
          }

          contextMessages = await this.context.buildContext(this.session.messages)
        }
      } catch (error) {
        const roxyError =
          error instanceof RoxyError
            ? error
            : new RoxyError(
                ErrorCode.LLM_API_ERROR,
                `Iteration ${iteration} failed`,
                error instanceof Error ? error : undefined,
              )

        logError(roxyError, 'warn', 'AgentLoop')

        // 所有错误都添加到 session，不直接抛出
        this.session.addMessage('assistant', `抱歉，发生错误：${roxyError.message}`)
        await this.sessionManager.save(ctx.sessionId)
        break
      }
    }

    if (iteration >= AgentLoop.MAX_ITERATIONS && hasToolCalls) {
      log('warn', `Max iterations reached`, 'AgentLoop')
      this.session.addMessage('assistant', '工具调用次数过多')
    }

    return { content: aiResponse, toolCalls: toolCallsResult }
  }

  private handleStreamData(ctx: RunContext, chunk: string): void {
    this.bus.emit('agent:stream', {
      agentId: ctx.agentId,
      taskId: ctx.taskId,
      channelId: ctx.channelId,
      sessionId: ctx.sessionId,
      chunk,
      timestamp: new Date(),
    })
  }

  getSession(): Session | null {
    return this.session
  }
}
