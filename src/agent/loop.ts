import type { LiteLLMProvider } from '../provider/llm'
import type { ContextMng } from './context'
import type { Session } from '../session/manager'
import type { ToolExecutor } from '../tools/ToolExecutor'

export interface AgentLoopDeps {
  provider: LiteLLMProvider
  toolExecutor: ToolExecutor
}

export interface ProcessCallbacks {
  onStream: (chunk: string) => void
  onToolCall: (name: string, args: any) => void
  onToolResult: (name: string, result: any) => void
}

/**
 * AgentLoop - 无状态消息处理器
 * 
 * 职责单一：给定 Session 和 Context，处理用户消息并返回 AI 响应
 * 不管理 Session 缓存，不管理 Context 缓存，不做路由决策
 */
export class AgentLoop {
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
    session.addMessage('user', msg)

    // 构建上下文
    let contextMessages = await ctx.buildContext(session.messages)

    // 获取工具定义
    const tools = await this.deps.toolExecutor.getToolDefinitions()

    // 循环处理，直到没有工具调用
    let hasToolCalls = true
    let maxIterations = 20
    let iteration = 0
    let aiResponse = ''

    while (hasToolCalls && iteration < maxIterations) {
      iteration++
      hasToolCalls = false

      // 调用 LLM API
      const result = await this.deps.provider.chat({
        messages: contextMessages,
        model: this.deps.provider.cfg.model,
        stream: true,
        onStreamData: callbacks.onStream,
        tools,
        tool_choice: 'auto',
      })

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
            console.error('解析工具参数失败:', e)
            console.error('原始参数:', toolCall.function.arguments)
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
            session.addMessage('assistant', content, tool_calls)
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
    }

    if (iteration >= maxIterations) {
      console.warn(`达到最大迭代次数 ${maxIterations}，停止工具调用循环`)
      session.addMessage('assistant', '工具调用次数过多，请简化您的请求。')
    }

    return aiResponse
  }
}
