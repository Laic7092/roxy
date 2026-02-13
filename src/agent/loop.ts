import { bus } from "../bus/instance";
import { LiteLLMProvider } from "../provider/llm";
import { ContextMng } from "./context";
import { Session } from "../session/manager";
import { ToolExecutor } from "../tools/ToolExecutor";

// 定义工具调用回调类型
export type ToolCallCallback = (toolName: string, args: any) => void;
export type ToolResultCallback = (toolName: string, result: any) => void;

interface Options {
    session: Session,
    ctx: ContextMng,
    provider: LiteLLMProvider,
    model: string,
    toolExecutor: ToolExecutor
}

export class AgentLoop {
    provider: LiteLLMProvider
    ctx: ContextMng
    session: Session
    model: string
    toolExecutor: ToolExecutor

    constructor({
        session,
        ctx,
        provider,
        model,
        toolExecutor
    }: Options) {
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
        onToolResult?: ToolResultCallback
    ) {
        this.session.addMessage('user', msg)

        // 构建上下文
        const contextMessages = this.ctx.buildContext(this.session.messages);

        // 获取工具定义
        const tools = this.toolExecutor.getToolDefinitions();

        // 调用启用流式处理的 API，传递流式数据回调和工具定义
        let result = await this.provider.chat({
            messages: contextMessages,
            model: this.model,
            stream: true,  // 启用流式处理
            onStreamData,  // 传递流式数据回调
            tools,         // 传递工具定义
            tool_choice: 'auto'  // 让模型自动决定何时使用工具
        });

        // 检查是否需要执行工具调用
        const toolCalls = result?.choices?.[0]?.message?.tool_calls;

        if (toolCalls && toolCalls.length > 0) {
            // 通知UI有工具调用发生
            for (const toolCall of toolCalls) {
                if (onToolCall) {
                    try {
                        const args = JSON.parse(toolCall.function.arguments);
                        onToolCall(toolCall.function.name, args);
                    } catch (e) {
                        console.error('解析工具参数失败:', e);
                        if (onToolCall) onToolCall(toolCall.function.name, {});
                    }
                }
            }

            // 执行所有工具调用，保留AI提供的ID
            const toolResults = await this.toolExecutor.executeTools(
                toolCalls.map(call => ({
                    name: call.function.name,
                    arguments: call.function.arguments,
                    id: call.id  // 保留AI提供的ID
                }))
            );

            // 通知UI工具执行结果
            for (const toolResult of toolResults) {
                if (onToolResult) {
                    onToolResult(toolResult.name, toolResult.result);
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
                this.session.addMessage('tool', toolResult.result, toolResult.tool_call_id);
            }

            // 再次调用AI，将工具结果作为上下文
            const updatedContextMessages = this.ctx.buildContext(this.session.messages);

            result = await this.provider.chat({
                messages: updatedContextMessages,
                model: this.model,
                stream: true,
                onStreamData
            });
        }

        // 从结果中提取内容并添加到会话
        if (result && result.choices && result.choices[0] && result.choices[0].message) {
            const { content, tool_calls } = result.choices[0].message;
            if (content && !toolCalls) {
                this.session.addMessage('assistant', content);
            }
        }
    }
}