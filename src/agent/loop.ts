import type { LiteLLMProvider } from '../provider/llm'
import type { ContextMng } from './context'
import type { Session } from '../session/manager'
import type { ToolExecutor } from '../tools/ToolExecutor'
import { RoxyError, ErrorCode, isRecoverableError } from '../types/errors'
import { logError, log, withTimeout } from '../utils/error-handler'

export interface AgentLoopDeps {
  provider: LiteLLMProvider
  toolExecutor: ToolExecutor
}

export interface ProcessCallbacks {
  onStream: (chunk: string) => void
  onToolCall: (name: string, args: any) => void
  onToolResult: (name: string, result: any) => void
  onError?: (error: RoxyError) => Promise<void>
}

/**
 * AgentLoop - 无状态消息处理器
 *
 * 职责单一：给定 Session 和 Context，处理用户消息并返回 AI 响应
 * 不管理 Session 缓存，不管理 Context 缓存，不做路由决策
 */
export class AgentLoop {
  // 配置常量
  private static readonly MAX_ITERATIONS = 20
  private static readonly MAX_TIME_MS = 5 * 60 * 1000 // 5 分钟
  private static readonly LLM_TIMEOUT_MS = 30000 // 30 秒

  constructor(private deps: AgentLoopDeps) {}

  /**
   * 核心方法：处理单条消息
   *
   * @param msg 用户消息
   * @param session 会话对象（由调用者管理）
   * @param ctx 上下文对象（由调用者管理）
   * @param callbacks 回调函数（用于流式输出和工具调用通知）
   * @returns 最终的 AI 响应内容
   */
  async process(
    msg: string,
    session: Session,
    ctx: ContextMng,
    callbacks: ProcessCallbacks,
  ): Promise<string> {
    const startTime = Date.now()
    let aiResponse = ''

    try {
      session.addMessage('user', msg)

      // 构建上下文
      let contextMessages = await ctx.buildContext(session.messages)

      // 获取工具定义
      const tools = await this.deps.toolExecutor.getToolDefinitions()

      // 循环处理，直到没有工具调用
      let hasToolCalls = true
      let iteration = 0

      while (hasToolCalls && iteration < AgentLoop.MAX_ITERATIONS) {
        // 检查超时
        const elapsed = Date.now() - startTime
        if (elapsed >= AgentLoop.MAX_TIME_MS) {
          const timeoutError = new RoxyError(
            ErrorCode.TIMEOUT,
            `Processing timeout (${AgentLoop.MAX_TIME_MS}ms) exceeded`
          )
          logError(timeoutError, 'error', 'AgentLoop')
          await callbacks.onError?.(timeoutError)
          session.addMessage('assistant', '处理超时，请简化您的请求。')
          break
        }

        iteration++
        hasToolCalls = false

        try {
          // 调用 LLM API（带超时）
          const result = await withTimeout(
            this.deps.provider.chat({
              messages: contextMessages,
              model: this.deps.provider.cfg.model,
              stream: true,
              onStreamData: callbacks.onStream,
              tools,
              tool_choice: 'auto',
            }),
            AgentLoop.LLM_TIMEOUT_MS,
            'LLM chat'
          )

          // 检查是否需要执行工具调用
          const toolCalls = result?.choices?.[0]?.message?.tool_calls

          if (toolCalls && toolCalls.length > 0) {
            hasToolCalls = true

            // 通知调用者有工具调用发生
            for (const toolCall of toolCalls) {
              try {
                const args = JSON.parse(toolCall.function.arguments)
                callbacks.onToolCall(toolCall.function.name, args)
              } catch (e) {
                const parseError = new RoxyError(
                  ErrorCode.TOOL_ARGUMENT_PARSE_ERROR,
                  `Failed to parse tool arguments for '${toolCall.function.name}'`,
                  e instanceof Error ? e : undefined,
                  { rawArguments: toolCall.function.arguments }
                )
                logError(parseError, 'warn', 'AgentLoop')
                callbacks.onToolCall(toolCall.function.name, { error: 'Invalid arguments format' })
              }
            }

            // 执行所有工具调用
            const toolResults = await this.deps.toolExecutor.executeTools(
              toolCalls.map((call) => ({
                name: call.function.name,
                arguments: call.function.arguments,
                id: call.id,
              })),
            )

            // 通知调用者工具执行结果
            for (const toolResult of toolResults) {
              callbacks.onToolResult(toolResult.name, toolResult.result)
            }

            // 将工具调用结果添加到消息历史中
            const { content, tool_calls } = result?.choices?.[0]?.message
            let init = false
            for (const toolResult of toolResults) {
              if (!init) {
                session.addMessage('assistant', content ?? '', tool_calls)
                init = true
              }
              session.addMessage('tool', toolResult.result, toolResult.tool_call_id)
            }

            // 重新构建上下文
            contextMessages = await ctx.buildContext(session.messages)
          } else {
            // 没有工具调用，处理最终的 AI 响应
            if (result && result.choices && result.choices[0] && result.choices[0].message) {
              const { content } = result.choices[0].message
              if (content) {
                session.addMessage('assistant', content)
                aiResponse = content
              }
            }
            break
          }
        } catch (error) {
          const roxyError = error instanceof RoxyError
            ? error
            : new RoxyError(
                ErrorCode.LLM_API_ERROR,
                `AgentLoop iteration ${iteration} failed`,
                error instanceof Error ? error : undefined
              )

          logError(roxyError, 'warn', 'AgentLoop')

          // 检查是否为可恢复错误
          if (isRecoverableError(roxyError)) {
            const retryMsg = `Retrying after error: ${roxyError.message}`
            log('warn', retryMsg, 'AgentLoop')
            await callbacks.onError?.(roxyError)
            continue
          }

          // 致命错误，抛出
          throw roxyError
        }
      }

      // 检查是否达到最大迭代次数
      if (iteration >= AgentLoop.MAX_ITERATIONS && hasToolCalls) {
        log('warn', `Reached maximum iteration limit (${AgentLoop.MAX_ITERATIONS})`, 'AgentLoop')
        session.addMessage('assistant', '工具调用次数过多，请简化您的请求。')
      }

      return aiResponse
    } catch (error) {
      const roxyError = error instanceof RoxyError
        ? error
        : new RoxyError(
            ErrorCode.SYSTEM_ERROR,
            'AgentLoop.process failed',
            error instanceof Error ? error : undefined
          )

      logError(roxyError, 'error', 'AgentLoop')

      // 通知调用者错误
      await callbacks.onError?.(roxyError)

      // 重新抛出，让调用者处理
      throw roxyError
    }
  }
}
