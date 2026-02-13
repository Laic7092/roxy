import LLMProvider from "./base";

export class LiteLLMProvider extends LLMProvider {
    constructor(cfg) {
        super(cfg)
    }

    async chat(ctx: Ctx): Promise<any> {
        const { messages, stream, onStreamData } = ctx;
        const { apiKey, baseURL, model } = this.cfg;

        const requestBody = {
            messages,
            model
        };

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

            const response = await fetch(baseURL, options);
            if (!response.ok) {
                console.error(response);
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // 如果是流式响应，处理 SSE 数据
            if (stream) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                let buffer = '';
                let fullContent = '';
                
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
                                return { choices: [{ message: { content: fullContent, role: 'assistant' } }] };
                            }
                            
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.delta?.content;
                                
                                if (content) {
                                    // 使用回调函数输出流式内容，而不是直接写入 stdout
                                    if (onStreamData) {
                                        onStreamData(content);
                                    }
                                    // 累积内容
                                    fullContent += content;
                                }
                            } catch (e) {
                                console.warn('Failed to parse SSE data:', e);
                            }
                        }
                    }
                }
                
                return { choices: [{ message: { content: fullContent, role: 'assistant' } }] };
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
