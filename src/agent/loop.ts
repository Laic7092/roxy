import { bus } from '../bus/instance'
import type { LiteLLMProvider } from '../provider/llm'
import type { ContextMng } from './context'
import type { Session } from '../session/manager'
import type { ToolExecutor } from '../tools/ToolExecutor'

// 定义工具调用回调类型
export type ToolCallCallback = (toolName: string, args: any) => void
export type ToolResultCallback = (toolName: string, result: any) => void

interface Options {
  session: Session
  ctx: ContextMng
  provider: LiteLLMProvider
  model: string
  toolExecutor: ToolExecutor
}

export class AgentLoop {
  provider: LiteLLMProvider
  ctx: ContextMng
  session: Session
  model: string
  toolExecutor: ToolExecutor

  constructor({ session, ctx, provider, model, toolExecutor }: Options) {
    this.session = session
    this.ctx = ctx
    this.provider = provider
    this.model = model
    this.toolExecutor = toolExecutor
  }

  async msgHandler(
    msg: string,
    onStreamData?: (data: string) => void,
    onToolCall?: ToolCallCallback,
    onToolResult?: ToolResultCallback,
  ) {
    this.session.addMessage('user', msg)

    // 构建上下文 - 现在是异步的
    let contextMessages = await this.ctx.buildContext(this.session.messages)

    // 获取工具定义
    const tools = await this.toolExecutor.getToolDefinitions()

    // 循环处理，直到没有工具调用
    let hasToolCalls = true
    let maxIterations = 7 // 防止无限循环
    let iteration = 0

    while (hasToolCalls && iteration < maxIterations) {
      iteration++
      hasToolCalls = false

      // 调用启用流式处理的 API，传递流式数据回调和工具定义
      let result = await this.provider.chat({
        messages: contextMessages,
        model: this.model,
        stream: true, // 启用流式处理
        onStreamData, // 传递流式数据回调
        tools, // 传递工具定义
        tool_choice: 'auto', // 让模型自动决定何时使用工具
      })

      // 检查是否需要执行工具调用
      const toolCalls = result?.choices?.[0]?.message?.tool_calls

      if (toolCalls && toolCalls.length > 0) {
        hasToolCalls = true

        // 通知UI有工具调用发生
        for (const toolCall of toolCalls) {
          if (onToolCall) {
            try {
              const args = JSON.parse(toolCall.function.arguments)
              onToolCall(toolCall.function.name, args)
            } catch (e) {
              console.error('解析工具参数失败:', e)
              console.error('原始参数:', toolCall.function.arguments)

              // 向AI返回错误信息，让它知道参数解析失败
              if (onToolCall) {
                onToolCall(toolCall.function.name, { error: 'Invalid arguments format' })
              }
            }
          }
        }

        // 执行所有工具调用，保留AI提供的ID
        const toolResults = await this.toolExecutor.executeTools(
          toolCalls.map((call) => ({
            name: call.function.name,
            arguments: call.function.arguments,
            id: call.id, // 保留AI提供的ID
          })),
        )

        // 通知UI工具执行结果
        for (const toolResult of toolResults) {
          if (onToolResult) {
            onToolResult(toolResult.name, toolResult.result)
          }
        }

        // 将工具调用结果添加到消息历史中
        const { content, tool_calls } = result?.choices?.[0]?.message
        let init = false
        for (const toolResult of toolResults) {
          if (!init) {
            this.session.addMessage('assistant', content, tool_calls)
            init = true
          }
          this.session.addMessage('tool', toolResult.result, toolResult.tool_call_id)
        }

        // 重新构建上下文，包含工具调用的结果
        contextMessages = await this.ctx.buildContext(this.session.messages)
      } else {
        // 没有工具调用，处理最终的AI响应
        if (result && result.choices && result.choices[0] && result.choices[0].message) {
          const { content } = result.choices[0].message
          if (content) {
            this.session.addMessage('assistant', content)
          }
        }
        break // 退出循环
      }
    }

    if (iteration >= maxIterations) {
      console.warn(`达到最大迭代次数 ${maxIterations}，停止工具调用循环`)
      // 可以添加一条系统消息告知用户
      this.session.addMessage('assistant', '工具调用次数过多，请简化您的请求。')
    }
  }
}