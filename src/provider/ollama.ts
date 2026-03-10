import { Ollama } from 'ollama'
import LLMProvider, { type ChatContext, type ChatResponse } from './base'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError } from '../utils/error-handler'
import type { ProviderConfig } from '../config/types'

/**
 * Ollama Provider
 *
 * 使用官方 Ollama SDK 实现
 * API 文档：https://docs.ollama.com/api/chat
 */
export class OllamaProvider extends LLMProvider {
  private client: Ollama

  constructor(cfg: ProviderConfig) {
    super(cfg)
    this.client = new Ollama({
      host: cfg.baseURL.replace(/\/v1$/, ''),
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
        stream: stream ?? false,
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
        if (typeof tool_choice === 'object' && tool_choice.type === 'function') {
          params.tool_choice = {
            type: 'function',
            function: {
              name: tool_choice.function.name,
            },
          }
        } else if (tool_choice === 'auto' || tool_choice === 'none' || tool_choice === 'required') {
          params.tool_choice = tool_choice
        }
      }

      // 流式处理
      if (stream) {
        return this.handleStream(params, onStreamData)
      } else {
        return this.handleNonStream(params)
      }
    } catch (error) {
      if (error instanceof RoxyError) {
        throw error
      }

      // 网络错误
      if (error instanceof TypeError && error.message.includes('fetch')) {
        const networkError = RoxyError.network(`Network error: ${error.message}`, error)
        logError(networkError, 'error', 'OllamaProvider')
        throw networkError
      }

      const roxyError = RoxyError.from(error, ErrorCode.LLM_API_ERROR, 'Ollama chat request failed')
      logError(roxyError, 'error', 'OllamaProvider')
      throw roxyError
    }
  }

  private async handleStream(params: any, onStreamData?: (data: string) => void): Promise<any> {
    const streamResponse = await this.client.chat(params)

    let fullContent = ''
    let thinking = ''
    const toolCalls: any[] = []

    for await (const chunk of streamResponse) {
      const content = chunk.message?.content
      if (content) {
        fullContent += content
        if (onStreamData) {
          onStreamData(content)
        }
      }

      // 检查是否有 thinking 输出
      const thinkingContent = chunk.message?.thinking
      if (thinkingContent) {
        thinking += thinkingContent
        if (onStreamData) {
          onStreamData(thinkingContent)
        }
      }

      // 检查是否有工具调用
      if (chunk.message?.tool_calls) {
        for (const toolCall of chunk.message.tool_calls) {
          const args = toolCall.function?.arguments || {}
          toolCalls.push({
            id: toolCall.id || `toolcall-${toolCalls.length}`,
            type: 'function',
            function: {
              name: toolCall.function?.name || '',
              arguments: args,
            },
          })
        }
      }

      // 如果是最后一个消息，返回完整结果
      if (chunk.done) {
        const result: any = {
          id: 'ollama-' + Date.now(),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: chunk.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
              },
              finish_reason: chunk.done_reason || 'stop',
            },
          ],
          usage: {
            prompt_tokens: chunk.prompt_eval_count || 0,
            completion_tokens: chunk.eval_count || 0,
            total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0),
          },
        }

        if (fullContent) {
          result.choices[0].message.content = fullContent
        }

        if (thinking) {
          result.choices[0].message.thinking = thinking
        }

        if (toolCalls.length > 0) {
          result.choices[0].message.tool_calls = toolCalls
        }

        return result
      }
    }

    // 如果循环结束但没有收到 done 标志，返回已收集的数据
    const result: any = {
      message: {
        role: 'assistant',
      },
    }

    if (fullContent) {
      result.message.content = fullContent
    }

    if (thinking) {
      result.message.thinking = thinking
    }

    if (toolCalls.length > 0) {
      result.message.tool_calls = toolCalls
    }

    return result
  }

  private async handleNonStream(params: any): Promise<any> {
    const response = await this.client.chat(params)

    // 转换为 OpenAI 兼容格式
    const result: any = {
      id: 'ollama-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
          },
          finish_reason: response.done_reason || 'stop',
        },
      ],
      usage: {
        prompt_tokens: response.prompt_eval_count || 0,
        completion_tokens: response.eval_count || 0,
        total_tokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
      },
    }

    if (response.message?.content) {
      result.choices[0].message.content = response.message.content
    }

    if (response.message?.thinking) {
      result.choices[0].message.thinking = response.message.thinking
    }

    if (response.message?.tool_calls) {
      result.choices[0].message.tool_calls = response.message.tool_calls.map((tc: any) => {
        const args = tc.function?.arguments || {}
        return {
          id: tc.id || `toolcall-${Math.random().toString(36).slice(2)}`,
          type: 'function',
          function: {
            name: tc.function?.name || '',
            arguments: args,
          },
        }
      })
    }

    return result
  }
}
