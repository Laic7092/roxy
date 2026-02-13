type Role = 'system' | 'user' | 'assistant' | 'tool'

interface Message {
    role: Role
    content: string
}

interface Ctx {
    model: string;
    messages: Message[]
    stream?: boolean;
    onStreamData?: (data: string) => void;
    tools?: Tool[]
    tool_choice?: 'none' | 'auto' | 'required'
}

interface Tool {
    type: 'function';

    function: {
        name: string;
        description?: string;
        parameters?: object;
        strict?: boolean;
    };
}

interface Cfg {
    apiKey: string
    baseURL: string
    model: string
}