import LLMProvider from "./base";

export class LiteLLMProvider extends LLMProvider {
    constructor(cfg) {
        super(cfg)
    }

    async chat(ctx: Ctx): Promise<any> {
        const { messages } = ctx
        const { apiKey, baseURL, model } = this.cfg

        try {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    messages,
                    model
                })
            }
            console.log(options)
            const response = await fetch(baseURL, options);
            if (!response.ok) {
                console.error(response)
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log(data);
            return data
        } catch (error) {
            console.error('请求失败:', error.message);
        }
    }
}
