import type { AgentConfig } from '../agent/types'

/**
 * Gateway 配置
 */
export interface GatewayConfig {
  workspace: string
  sessionDir?: string
  agents?: AgentConfig[]
  defaultModel?: string
}

/**
 * Gateway 依赖注入容器
 */
export interface GatewayDeps {
  config: GatewayConfig
}

/**
 * 消息输入
 */
export interface GatewayInput {
  channelId: string
  sessionId: string
  content: string
}

/**
 * 消息输出
 */
export interface GatewayOutput {
  type: 'response' | 'stream' | 'tool_call' | 'tool_result' | 'error' | 'subagent_start' | 'subagent_complete'
  channelId: string
  sessionId: string
  data: any
}

/**
 * Gateway 事件处理器
 */
export type GatewayEventHandler = (output: GatewayOutput) => void | Promise<void>
