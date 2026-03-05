/**
 * @deprecated 使用 events.ts 中的 EventMap 代替
 */

/**
 * 入站消息 - 从 Channel 到 Agent
 * @deprecated 使用事件系统代替
 */
export interface InboundMessage {
  channelId: string
  content: string
  sessionId?: string
  timestamp: Date
}

/**
 * 出站消息类型
 * @deprecated 使用事件系统代替
 */
export type OutboundMessageType =
  | 'typing'
  | 'stream'
  | 'response'
  | 'tool_call'
  | 'tool_result'
  | 'error'

/**
 * 出站消息 - 从 Agent 到 Channel
 * @deprecated 使用事件系统代替
 */
export interface OutboundMessage {
  channelId: string
  type: OutboundMessageType
  content: string | any
  replyTo?: string
  timestamp?: Date
}

/**
 * BUS 事件类型定义（用于直接事件订阅）
 * @deprecated 使用 events.ts 中的 EventMap
 */
export interface BusEvents {
  'channel:connect': { channelId: string }
  'channel:disconnect': { channelId: string }
  'session:switched': { channelId: string; sessionId: string }
  [key: string]: any
  [key: symbol]: any
}
