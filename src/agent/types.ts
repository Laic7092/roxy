/**
 * Agent 类型定义
 */

/**
 * Agent 角色类型
 */
export enum AgentRole {
  /** 主 Agent，处理通用对话 */
  MAIN = 'main',
  /** SubAgent，处理专门任务 */
  SUB = 'sub',
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** Agent 唯一标识 */
  id: string
  /** Agent 角色 */
  role: AgentRole
  /** 使用的模型（可选，默认使用全局配置） */
  model?: string
  /** 系统提示词（可选） */
  systemPrompt?: string
  /** 启用的技能列表 */
  skills?: string[]
  /** 启用的工具列表 */
  tools?: string[]
  /** 最大迭代次数 */
  maxIterations?: number
  /** 超时时间（毫秒） */
  timeoutMs?: number
  /** 思考模式，默认 false */
  think?: boolean | 'high' | 'medium' | 'low'
}

/**
 * Agent 任务状态
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Agent 任务
 */
export interface AgentTask {
  /** 任务唯一标识 */
  id: string
  /** 父任务 ID（SubAgent 用） */
  parentId?: string
  /** 执行任务的 Agent ID */
  agentId: string
  /** 任务内容 */
  content: string
  /** 会话 ID */
  sessionId: string
  /** 通道 ID */
  channelId: string
  /** 任务上下文 */
  context?: any
  /** 任务状态 */
  status: TaskStatus
  /** 任务结果 */
  result?: any
  /** 错误信息（失败时） */
  error?: string
  /** 创建时间 */
  createdAt: Date
  /** 完成时间 */
  completedAt?: Date
}
