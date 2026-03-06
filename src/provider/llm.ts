import LLMProvider from './base'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError, log, sleep } from '../utils/error-handler'

export class LiteLLMProvider extends LLMProvider {
  constructor(cfg) {
    super(cfg)
  }

  /**
   * 带重试机制的 chat 方法
   *
   * @param ctx 上下文
   * @param maxRetries 最大重试次数
   */
  async chatWithRetry(ctx: Ctx, maxRetries: number = 3): Promise<any> {
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.chat(ctx)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // 检查是否应该重试
        if (!this.shouldRetry(lastError) || attempt === maxRetries) {
          break
        }

        // 计算指数退避延迟
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000)

        log(
          'warn',
          `LLM call failed，重试中 (attempt ${attempt}/${maxRetries}) after ${backoffMs}ms`,
          'LiteLLMProvider',
          { error: lastError.message },
        )

        await sleep(backoffMs)
      }
    }

    const roxyError = RoxyError.llm(`LLM call failed after ${maxRetries} attempts`, lastError, {
      lastError: lastError?.message,
      attempts: maxRetries,
    })
    logError(roxyError, 'error', 'LiteLLMProvider')
    throw roxyError
  }

  /**
   * 判断错误是否应该重试
   */
  private shouldRetry(error: Error): boolean {
    // 可重试的错误关键字
    const retryableMessages = [
      'network',
      'timeout',
      'rate limit',
      'too many requests',
      'server error',
      'gateway',
      'service unavailable',
      'temporarily unavailable',
      'econnreset',
      'econnrefused',
      'enotfound',
    ]

    const message = error.message.toLowerCase()
    return retryableMessages.some((keyword) => message.includes(keyword))
  }

  async chat(ctx: Ctx): Promise<any> {
    const { messages, stream, onStreamData, tools, tool_choice } = ctx
    const { apiKey, baseURL, model } = this.cfg

    const fullURL = baseURL + '/chat/completions'

    const requestBody: any = {
      messages,
      model,
    }

    // 如果提供了工具定义，添加到请求体
    if (tools && tools.length > 0) {
      requestBody.tools = tools
    }

    // 如果指定了工具选择策略，添加到请求体
    if (tool_choice) {
      requestBody.tool_choice = tool_choice
    }

    // 如果启用了流式处理，添加相应参数
    if (stream) {
      requestBody['stream'] = true
    }

    try {
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: stream ? 'text/event-stream' : 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }

      const response = await fetch(fullURL, options)
      if (!response.ok) {
        // 尝试获取响应体内容作为错误信息
        let errorMessage = `HTTP error! status: ${response.status}`
        try {
          const errorBody = await response.text()
          if (errorBody) {
            errorMessage += `\nResponse body: ${errorBody}`
          }
        } catch (e) {
          log('warn', 'Could not read error response body', 'LiteLLMProvider')
        }

        // 检查是否为速率限制
        if (response.status === 429) {
          throw RoxyError.llm(`Rate limited: ${response.status}`, undefined, {
            statusCode: response.status,
            responseBody: errorMessage,
          })
        }

        // 检查是否为服务器错误
        if (response.status >= 500) {
          throw RoxyError.llm(`Server error: ${response.status}`, undefined, {
            statusCode: response.status,
            responseBody: errorMessage,
          })
        }

        throw RoxyError.http(response.status, errorMessage)
      }

      // 如果是流式响应，处理 SSE 数据
      if (stream) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        let buffer = ''
        let fullContent = ''
        let toolCalls: any[] = []

        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.substring(6)

              if (data === '[DONE]') {
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
              }

              try {
                const parsed = JSON.parse(data)

                // 检查是否有内容
                const content = parsed.choices?.[0]?.delta?.content
                if (content) {
                  if (onStreamData) {
                    onStreamData(content)
                  }
                  fullContent += content
                }

                // 检查是否有工具调用
                const delta = parsed.choices?.[0]?.delta
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
              } catch (e) {
                // SSE 解析错误，记录并跳过
                const parseError = new RoxyError(
                  ErrorCode.SSE_PARSE_ERROR,
                  'Failed to parse SSE data',
                  e instanceof Error ? e : undefined,
                )
                logError(parseError, 'warn', 'LiteLLMProvider')
                // 继续处理，不中断
              }
            }
          }
        }

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
        const data = await response.json()
        return data
      }
    } catch (error) {
      // 已经是 RoxyError，直接抛出
      if (error instanceof RoxyError) {
        throw error
      }

      // 网络错误
      if (error instanceof TypeError && error.message.includes('fetch')) {
        const networkError = RoxyError.network(`Network error: ${error.message}`, error)
        logError(networkError, 'error', 'LiteLLMProvider')
        throw networkError
      }

      // 其他错误，包装后抛出
      const roxyError = RoxyError.from(error, ErrorCode.LLM_API_ERROR, 'LLM chat request failed')
      logError(roxyError, 'error', 'LiteLLMProvider')
      throw roxyError
    }
  }
}
