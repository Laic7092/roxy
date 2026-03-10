import OpenAI from 'openai'
import LLMProvider, { type ChatContext, type ChatResponse } from './base'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError } from '../utils/error-handler'
import type { ProviderConfig } from '../config/types'

/**
 * OpenAI Provider
 *
 * 使用官方 OpenAI SDK 实现
 * 适用于所有 OpenAI 兼容的 LLM 服务（OpenAI、DeepSeek、Moonshot 等）
 */
export class OpenAIProvider extends LLMProvider {
  private client: OpenAI

  constructor(cfg: ProviderConfig) {
    super(cfg)
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
    })
  }

  async chat(ctx: ChatContext): Promise<ChatResponse> {
    const { messages, stream, onStreamData, tools, tool_choice, think } = ctx
    const { model } = this.cfg

    try {
      // 构建请求参数
      const params: any = {
        model,
        messages,
      }

      // 添加 think 参数（如果提供）
      if (think !== undefined) {
        params.think = think
      }

      // 如果提供了工具定义，添加到请求
      if (tools?.length) {
        params.tools = tools
      }

      // 如果指定了工具选择策略，添加到请求
      if (tool_choice) {
        params.tool_choice = tool_choice
      }

      // 流式处理
      if (stream) {
        const streamResponse = await this.client.chat.completions.create({
          ...params,
          stream: true,
        })

        let fullContent = ''
        const toolCalls: any[] = []

        for await (const chunk of streamResponse) {
          const delta = chunk.choices[0]?.delta

          // 处理内容
          if (delta?.content) {
            fullContent += delta.content
            if (onStreamData) {
              onStreamData(delta.content)
            }
          }

          // 处理工具调用
          if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index

              if (!toolCalls[index]) {
                toolCalls[index] = {
                  id: '',
                  type: 'function',
                  function: {
                    name: '',
                    arguments: '',
                  },
                }
              }

              if (toolCallDelta.id) {
                toolCalls[index].id = toolCallDelta.id
              }
              if (toolCallDelta.function?.name) {
                toolCalls[index].function.name += toolCallDelta.function.name
              }
              if (toolCallDelta.function?.arguments) {
                toolCalls[index].function.arguments += toolCallDelta.function.arguments
              }
            }
          }
        }

        // 构建最终结果
        const result: any = {
          choices: [
            {
              message: {
                role: 'assistant',
              },
            },
          ],
        }

        if (fullContent) {
          result.choices[0].message.content = fullContent
        }

        if (toolCalls.length > 0) {
          result.choices[0].message.tool_calls = toolCalls
        }

        return result
      } else {
        // 非流式处理
        const response = await this.client.chat.completions.create(params)
        return response
      }
    } catch (error) {
      // 已经是 RoxyError，直接抛出
      if (error instanceof RoxyError) {
        throw error
      }

      // OpenAI SDK 错误处理
      if (error instanceof OpenAI.APIError) {
        const status = error.status || error.code
        const message = error.message

        // 速率限制
        if (status === 429) {
          throw RoxyError.llm(`Rate limited: ${status}`, undefined, {
            statusCode: status,
            responseBody: message,
          })
        }

        // 服务器错误
        if (status && status >= 500) {
          throw RoxyError.llm(`Server error: ${status}`, undefined, {
            statusCode: status,
            responseBody: message,
          })
        }

        // 其他 API 错误
        throw RoxyError.llm(message, undefined, {
          statusCode: status,
          responseBody: message,
        })
      }

      // 网络错误
      if (error instanceof TypeError && error.message.includes('fetch')) {
        const networkError = RoxyError.network(`Network error: ${error.message}`, error)
        logError(networkError, 'error', 'OpenAIProvider')
        throw networkError
      }

      // 其他错误，包装后抛出
      const roxyError = RoxyError.from(error, ErrorCode.LLM_API_ERROR, 'LLM chat request failed')
      logError(roxyError, 'error', 'OpenAIProvider')
      throw roxyError
    }
  }
}
