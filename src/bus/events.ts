/**
 * 事件类型定义
 *
 * 统一的事件格式，用于 EventBus 通信
 */

/**
 * 用户消息事件
 */
export interface UserMessageEvent {
  channelId: string
  sessionId: string
  content: string
  timestamp: Date
}

/**
 * Agent 响应事件
 */
export interface AgentResponseEvent {
  agentId: string
  taskId: string
  channelId: string
  sessionId: string
  content: string
  toolCalls?: any
  timestamp: Date
}

/**
 * Agent 流式输出事件
 */
export interface AgentStreamEvent {
  agentId: string
  taskId: string
  channelId: string
  sessionId: string
  chunk: string
  timestamp: Date
}

/**
 * Agent 工具调用事件
 */
export interface AgentToolCallEvent {
  agentId: string
  taskId: string
  channelId: string
  sessionId: string
  toolName: string
  toolArgs: any
  toolCallId: string
  timestamp: Date
}

/**
 * Agent 工具调用结果事件
 */
export interface AgentToolResultEvent {
  agentId: string
  taskId: string
  channelId: string
  sessionId: string
  toolName: string
  toolResult: any
  toolCallId: string
  timestamp: Date
}

/**
 * Agent 任务执行事件
 */
export interface AgentExecuteEvent {
  taskId: string
  agentId: string
  channelId: string
  sessionId: string
  content: string
}

/**
 * SubAgent 任务开始事件
 */
export interface SubAgentStartEvent {
  taskId: string
  label: string
  task: string
  parentChannelId: string
  parentSessionId: string
  timestamp: Date
}

/**
 * SubAgent 任务完成事件
 */
export interface SubAgentCompleteEvent {
  taskId: string
  label: string
  parentChannelId: string
  parentSessionId: string
  result: string
  success: boolean
  error?: string
  timestamp: Date
}

/**
 * 错误事件
 */
export interface ErrorEvent {
  channelId?: string
  sessionId?: string
  agentId?: string
  taskId?: string
  error: any
  timestamp: Date
}

/**
 * 所有事件类型的映射
 */
export interface EventMap {
  'user:message': UserMessageEvent
  'agent:response': AgentResponseEvent
  'agent:stream': AgentStreamEvent
  'agent:tool_call': AgentToolCallEvent
  'agent:tool_result': AgentToolResultEvent
  'agent:execute': AgentExecuteEvent
  'subagent:start': SubAgentStartEvent
  'subagent:complete': SubAgentCompleteEvent
  error: ErrorEvent
}
