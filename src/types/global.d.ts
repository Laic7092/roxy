type Role = 'system' | 'user' | 'assistant' | 'tool'

interface Message {
  role: Role
  content: string | null
  tool_calls?: ToolCall[]
}

interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}

interface ToolMessage {
  role: 'tool'
  content: string
  tool_call_id: string
}

interface Ctx {
  model: string
  messages: (Message | ToolMessage)[]
  stream?: boolean
  onStreamData?: (data: string) => void
  tools?: Tool[]
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } }
}

interface Tool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required: string[]
    }
  }
}

interface Cfg {
  apiKey: string
  baseURL: string
  model: string
}
