import type { Role } from '../session/manager'
import type { ChatContext, ChatResponse } from '../provider/base'

// 重新导出 Provider 类型
export type { ChatContext, ChatResponse }
export type Ctx = ChatContext

interface Message {
  role: Role
  content: string | null
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string | object
  }
}

interface ToolMessage {
  role: 'tool'
  content: string
  tool_call_id: string
}

export interface Tool {
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
