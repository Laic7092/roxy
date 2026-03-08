import LLMProvider from './base'
import { RoxyError, ErrorCode } from '../types/errors'
import { log, logError } from '../utils/error-handler'
import type { ProviderConfig } from '../config/types'

/**
 * Ollama Provider
 * 
 * 实现 Ollama API 的聊天接口
 * API 文档：https://docs.ollama.com/api/chat
 */
export class OllamaProvider extends LLMProvider {
  constructor(cfg: ProviderConfig) {
    super(cfg)
  }

  async chat(ctx: Ctx): Promise<any> {
    const { stream, onStreamData } = ctx

    // 构建请求体和 URL
    const requestBody = this.buildRequestBody(ctx)
    const fullURL = this.buildURL()

    try {
      const options: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: stream ? 'application/x-ndjson' : 'application/json',
        },
        body: JSON.stringify(requestBody),
      }

      const response = await fetch(fullURL, options)

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`
        try {
          const errorBody = await response.text()
          if (errorBody) {
            errorMessage += `\nResponse body: ${errorBody}`
          }
        } catch {
          log('warn', 'Could not read error response body', 'OllamaProvider')
        }

        if (response.status === 429) {
          throw RoxyError.llm(`Rate limited: ${response.status}`, undefined, {
            statusCode: response.status,
            responseBody: errorMessage,
          })
        }

        if (response.status >= 500) {
          throw RoxyError.llm(`Server error: ${response.status}`, undefined, {
            statusCode: response.status,
            responseBody: errorMessage,
          })
        }

        throw RoxyError.http(response.status, errorMessage)
      }

      // 如果是流式响应，处理 NDJSON 数据
      if (stream) {
        return this.handleStreamResponse(response, onStreamData)
      } else {
        return this.handleNonStreamResponse(response)
      }
    } catch (error) {
      if (error instanceof RoxyError) {
        throw error
      }

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

  /**
   * 处理流式响应（NDJSON 格式）
   */
  private async handleStreamResponse(
    response: Response,
    onStreamData?: (data: string) => void,
  ): Promise<any> {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    let buffer = ''
    let fullContent = ''
    let toolCalls: any[] = []
    let thinking = ''

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine) {
          continue
        }

        try {
          const parsed = JSON.parse(trimmedLine)

          // 检查是否有内容
          const content = parsed.message?.content
          if (content) {
            if (onStreamData) {
              onStreamData(content)
            }
            fullContent += content
          }

          // 检查是否有 thinking 输出
          const thinkingContent = parsed.message?.thinking
          if (thinkingContent) {
            thinking += thinkingContent
            if (onStreamData) {
              onStreamData(thinkingContent)
            }
          }

          // 检查是否有工具调用
          if (parsed.message?.tool_calls) {
            for (const toolCall of parsed.message.tool_calls) {
              // Ollama 返回的 arguments 是对象，保持原样
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
          if (parsed.done) {
            // 转换为 OpenAI 兼容格式
            const result: any = {
              id: 'ollama-' + Date.now(),
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: parsed.model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                  },
                  finish_reason: parsed.done_reason || 'stop',
                },
              ],
              usage: {
                prompt_tokens: parsed.prompt_eval_count || 0,
                completion_tokens: parsed.eval_count || 0,
                total_tokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0),
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
        } catch (e) {
          const parseError = new RoxyError(
            ErrorCode.SSE_PARSE_ERROR,
            `Failed to parse NDJSON line: ${trimmedLine.substring(0, 100)}`,
            e instanceof Error ? e : undefined,
          )
          logError(parseError, 'warn', 'OllamaProvider')
          // 继续处理，不中断
        }
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

  /**
   * 处理非流式响应
   */
  private async handleNonStreamResponse(response: Response): Promise<any> {
    const data = await response.json()

    // 转换为 OpenAI 兼容格式
    const result: any = {
      id: 'ollama-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
          },
          finish_reason: data.done_reason || 'stop',
        },
      ],
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    }

    if (data.message?.content) {
      result.choices[0].message.content = data.message.content
    }

    if (data.message?.thinking) {
      result.choices[0].message.thinking = data.message.thinking
    }

    if (data.message?.tool_calls) {
      result.choices[0].message.tool_calls = data.message.tool_calls.map((tc: any) => {
        // Ollama 返回的 arguments 是对象，保持原样
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

  /**
   * 构建 Ollama API URL
   * 
   * Ollama 原生 API 使用 /api/chat，而非 OpenAI 兼容的 /v1/chat/completions
   * 需要移除配置中可能存在的 /v1 后缀
   */
  private buildURL(): string {
    const { baseURL } = this.cfg
    return baseURL.replace(/\/v1$/, '') + '/api/chat'
  }

  /**
   * 构建请求体
   */
  private buildRequestBody(ctx: Ctx): any {
    const { messages, stream, tools, tool_choice, think } = ctx
    const { model } = this.cfg

    const requestBody: any = {
      model,
      messages,
      stream: stream ?? false,
      think: think ?? false,
    }

    // 如果提供了工具定义，添加到请求体
    if (tools && tools.length > 0) {
      requestBody.tools = tools
    }

    // 如果指定了工具选择策略，添加到请求体
    if (tool_choice) {
      if (typeof tool_choice === 'object' && tool_choice.type === 'function') {
        requestBody.tool_choice = {
          type: 'function',
          function: {
            name: tool_choice.function.name,
          },
        }
      } else if (tool_choice === 'auto' || tool_choice === 'none' || tool_choice === 'required') {
        requestBody.tool_choice = tool_choice
      }
    }

    return requestBody
  }
}
