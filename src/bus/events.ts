/**
 * 事件类型定义
 *
 * 统一的事件格式，用于 EventBus 通信
 */

/**
 * 用户消息事件（Channel → Orchestrator）
 */
export interface UserMessageEvent {
  channelId: string
  sessionId: string
  content: string
  timestamp: Date
}

/**
 * Agent 响应事件（Agent → Channel/Session）
 */
export interface AgentResponseEvent {
  agentId: string
  taskId: string
  channelId: string
  sessionId: string
  content: string
  timestamp: Date
}

/**
 * Agent 流式输出事件（Agent → Channel）
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
 * Agent 工具调用事件（Agent → Executor）
 */
export interface AgentToolCallEvent {
  agentId: string
  taskId: string
  channelId: string
  sessionId: string
  toolName: string
  toolArgs: any
  toolCallId?: string
  timestamp: Date
}

/**
 * Agent 工具调用结果事件（Executor → Agent）
 */
export interface AgentToolResultEvent {
  agentId: string
  taskId: string
  channelId: string
  sessionId: string
  toolName: string
  toolResult: any
  toolCallId: string
  error?: string
  timestamp: Date
}

/**
 * Agent 任务执行事件（Orchestrator → Agent）
 */
export interface AgentExecuteEvent {
  task: AgentTask
}

/**
 * Agent 任务完成事件（Agent → Orchestrator）
 */
export interface AgentTaskCompleteEvent {
  taskId: string
  agentId: string
  sessionId: string
  channelId: string
  result: any
  timestamp: Date
}

/**
 * Agent 任务失败事件（Agent → Orchestrator）
 */
export interface AgentTaskFailedEvent {
  taskId: string
  agentId: string
  sessionId: string
  channelId: string
  error: string
  timestamp: Date
}

/**
 * Agent 生成事件（Orchestrator → AgentFactory）
 */
export interface AgentSpawnEvent {
  config: AgentConfig
}

/**
 * Agent 委托事件（Parent Agent → SubAgent）
 */
export interface AgentDelegateEvent {
  parentId: string
  parentAgentId: string
  delegation: DelegationRequest
}

/**
 * SubAgent 任务开始事件（SubAgent → Parent）
 */
export interface SubAgentStartEvent {
  /** SubAgent 任务 ID */
  taskId: string
  /** 任务标签 */
  label: string
  /** 任务内容 */
  task: string
  /** 父 Agent 的通道 ID */
  parentChannelId: string
  /** 父 Agent 的会话 ID */
  parentSessionId: string
  timestamp: Date
}

/**
 * SubAgent 任务完成事件（SubAgent → Parent）
 */
export interface SubAgentCompleteEvent {
  /** SubAgent 任务 ID */
  taskId: string
  /** 任务标签 */
  label: string
  /** 父 Agent 的通道 ID */
  parentChannelId: string
  /** 父 Agent 的会话 ID */
  parentSessionId: string
  /** 任务结果 */
  result: string
  /** 是否成功 */
  success: boolean
  /** 错误信息（失败时） */
  error?: string
  timestamp: Date
}

/**
 * Team 广播事件（Team Lead → Members）
 */
export interface TeamBroadcastEvent {
  teamId: string
  task: string
  parallel: boolean
}

/**
 * 会话保存事件（Auto-triggered）
 */
export interface SessionSaveEvent {
  sessionId: string
  message: SessionMessage
}

/**
 * 会话消息
 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: any
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
  // 用户消息
  'user:message': UserMessageEvent

  // Agent 响应
  'agent:response': AgentResponseEvent
  'agent:stream': AgentStreamEvent

  // 工具调用
  'agent:tool_call': AgentToolCallEvent
  'agent:tool_result': AgentToolResultEvent

  // 任务执行
  'agent:execute': AgentExecuteEvent
  'agent:task:complete': AgentTaskCompleteEvent
  'agent:task:failed': AgentTaskFailedEvent

  // Agent 生命周期
  'agent:spawn': AgentSpawnEvent

  // SubAgent 委托
  'agent:delegate': AgentDelegateEvent
  'subagent:start': SubAgentStartEvent
  'subagent:complete': SubAgentCompleteEvent

  // Team 协作
  'team:broadcast': TeamBroadcastEvent

  // 会话管理
  'session:save': SessionSaveEvent

  // 错误处理
  error: ErrorEvent
}

// 导入类型
import type { AgentTask, AgentConfig, DelegationRequest } from '../agent/types'
