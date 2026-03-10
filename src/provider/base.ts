import type { ProviderConfig } from '../config/types'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type {
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions'

export interface ChatContext {
  model: string
  messages: ChatCompletionMessageParam[]
  stream?: boolean
  onStreamData?: (data: string) => void
  tools?: ChatCompletionTool[]
  tool_choice?: ChatCompletionToolChoiceOption
  think?: boolean | 'high' | 'medium' | 'low'
}

export interface ChatResponse {
  choices: Array<{
    message: {
      role: string
      content?: string
      thinking?: string
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: {
          name: string
          arguments: string | object
        }
      }>
    }
  }>
}

export default abstract class LLMProvider {
  cfg: ProviderConfig
  constructor(cfg: ProviderConfig) {
    this.cfg = cfg
  }

  abstract chat(context: ChatContext): Promise<ChatResponse>
}
