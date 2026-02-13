import LLMProvider from "./base";

export class LiteLLMProvider extends LLMProvider {
    constructor(cfg) {
        super(cfg)
    }

    async chat(ctx: Ctx): Promise<any> {
        const { messages, stream, onStreamData, tools, tool_choice } = ctx;
        const { apiKey, baseURL, model } = this.cfg;

        const requestBody: any = {
            messages,
            model
        };

        // 如果提供了工具定义，添加到请求体
        if (tools && tools.length > 0) {
            requestBody.tools = tools;
        }

        // 如果指定了工具选择策略，添加到请求体
        if (tool_choice) {
            requestBody.tool_choice = tool_choice;
        }

        // 如果启用了流式处理，添加相应参数
        if (stream) {
            requestBody['stream'] = true;
        }

        try {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': stream ? 'text/event-stream' : 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody)
            };

            console.log(options)
            const response = await fetch(baseURL, options);
            if (!response.ok) {
                // 尝试获取响应体内容作为错误信息
                let errorMessage = `HTTP error! status: ${response.status}`;
                try {
                    const errorBody = await response.text(); // 获取响应体文本
                    if (errorBody) {
                        errorMessage += `\nResponse body: ${errorBody}`;
                    }
                } catch (e) {
                    // 如果无法读取响应体，则记录原始错误
                    console.warn('Could not read error response body:', e);
                }
                
                console.error('请求失败:', errorMessage);
                throw new Error(errorMessage);
            }

            // 如果是流式响应，处理 SSE 数据
            if (stream) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                let buffer = '';
                let fullContent = '';
                let toolCalls: any[] = []; // 存储工具调用
                let currentToolCallIndex: number | null = null;
                let currentProperty: string | null = null;

                while (true) {
                    const { done, value } = await reader.read();

                    if (done) {
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // 保留不完整的最后一行

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.substring(6); // 移除 'data: ' 前缀

                            if (data === '[DONE]') {
                                // 返回最终结果，可能包含内容或工具调用
                                const result: any = {
                                    choices: [{
                                        message: {
                                            role: 'assistant'
                                        }
                                    }]
                                };

                                if (fullContent) {
                                    result.choices[0].message.content = fullContent;
                                }

                                if (toolCalls.length > 0) {
                                    result.choices[0].message.tool_calls = toolCalls;
                                }

                                return result;
                            }

                            try {
                                const parsed = JSON.parse(data);
                                
                                // 检查是否有内容
                                const content = parsed.choices?.[0]?.delta?.content;
                                if (content) {
                                    // 使用回调函数输出流式内容，而不是直接写入 stdout
                                    if (onStreamData) {
                                        onStreamData(content);
                                    }
                                    // 累积内容
                                    fullContent += content;
                                }

                                // 检查是否有工具调用
                                const delta = parsed.choices?.[0]?.delta;
                                if (delta?.tool_calls) {
                                    for (const toolCallDelta of delta.tool_calls) {
                                        const index = toolCallDelta.index;

                                        // 确保toolCalls数组中有对应索引的位置
                                        if (!toolCalls[index]) {
                                            toolCalls[index] = {
                                                id: '',
                                                type: 'function',
                                                function: {
                                                    name: '',
                                                    arguments: ''
                                                }
                                            };
                                        }

                                        // 更新工具调用信息
                                        if (toolCallDelta.id) {
                                            toolCalls[index].id = toolCallDelta.id;
                                        }
                                        if (toolCallDelta.function?.name) {
                                            toolCalls[index].function.name += toolCallDelta.function.name;
                                        }
                                        if (toolCallDelta.function?.arguments) {
                                            toolCalls[index].function.arguments += toolCallDelta.function.arguments;
                                        }
                                    }
                                }
                            } catch (e) {
                                console.warn('Failed to parse SSE data:', e);
                            }
                        }
                    }
                }

                // 返回最终结果，可能包含内容或工具调用
                const result: any = {
                    choices: [{
                        message: {
                            role: 'assistant'
                        }
                    }]
                };

                if (fullContent) {
                    result.choices[0].message.content = fullContent;
                }

                if (toolCalls.length > 0) {
                    result.choices[0].message.tool_calls = toolCalls;
                }

                return result;
            } else {
                // 非流式响应，按原方式处理
                const data = await response.json();
                console.log(data);
                return data;
            }
        } catch (error) {
            console.error('请求失败:', error.message);
            throw error;
        }
    }
}
