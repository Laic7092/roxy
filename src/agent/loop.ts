import { bus } from "../bus/instance";
import { LiteLLMProvider } from "../provider/llm";
import { ContextMng } from "./context";
import { Session } from "../session/manager";

interface Options {
    session: Session,
    ctx: ContextMng,
    provider: LiteLLMProvider,
    model: string
}

export class AgentLoop {
    provider: LiteLLMProvider
    ctx: ContextMng
    session: Session
    model: string
    constructor({
        session,
        ctx,
        provider,
        model
    }: Options) {
        this.session = session
        this.ctx = ctx
        this.provider = provider
        this.model = model
    }

    async msgHandler(msg: string, onStreamData?: (data: string) => void) {
        this.session.addMessage('user', msg)
        
        // 构建上下文
        const contextMessages = this.ctx.buildContext(this.session.messages);
        
        // 调用启用流式处理的 API，传递流式数据回调
        const result = await this.provider.chat({
            messages: contextMessages,
            model: this.model,
            stream: true,  // 启用流式处理
            onStreamData   // 传递流式数据回调
        });
        
        // 从结果中提取内容并添加到会话
        if (result && result.choices && result.choices[0] && result.choices[0].message) {
            const { content } = result.choices[0].message;
            this.session.addMessage('assistant', content);
        }
    }
}