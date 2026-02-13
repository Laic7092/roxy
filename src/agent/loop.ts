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

    msgHandler(msg: string) {
        this.session.addMessage('user', msg)
        this.provider.chat({
            messages: this.ctx.buildContext(this.session.messages),
            model: this.model
        }).then(data => {
            const { choices } = data
            const { tool_calls, content } = choices[0].message
            this.session.addMessage('assistant', content)
            console.log(choices[0].message)

            if (tool_calls) {
                console.log(tool_calls)

            }
        }).catch(console.error)
    }
}