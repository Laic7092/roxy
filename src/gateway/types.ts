/**
 * Gateway 类型定义
 *
 * Gateway 作为统一入口，使用 config/manager 中的 RoxyConfig
 */

import type { RoxyConfig } from '../config/types'

/**
 * Gateway 配置（即 RoxyConfig）
 */
export type GatewayConfig = RoxyConfig

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
  type:
    | 'response'
    | 'stream'
    | 'tool_call'
    | 'tool_result'
    | 'error'
    | 'subagent_start'
    | 'subagent_complete'
  channelId: string
  sessionId: string
  data: any
}

/**
 * Gateway 事件处理器
 */
export type GatewayEventHandler = (output: GatewayOutput) => void | Promise<void>
