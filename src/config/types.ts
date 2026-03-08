/**
 * Roxy 统一配置类型定义
 *
 * 所有配置集中在此处管理，包括：
 * - 工作区配置
 * - LLM Provider 配置
 * - Agent 配置
 * - Channel 配置
 * - 心跳服务配置
 * - Cron 服务配置
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentConfig } from '../agent/types'

/**
 * LLM Provider 配置
 */
export interface ProviderConfig {
  apiKey: string
  baseURL: string
  [key: string]: any
}

/**
 * 心跳服务配置
 */
export interface HeartbeatConfig {
  /** 是否启用心跳，默认 true */
  enabled?: boolean
  /** 心跳间隔（秒），默认 1800s (30 分钟) */
  interval?: number
}

/**
 * Cron 定时任务配置
 */
export interface CronConfig {
  /** 是否启用 Cron，默认 true */
  enabled?: boolean
}

/**
 * Channel 配置
 */
export interface ChannelConfig {
  id: string
  enabled?: boolean
  [key: string]: any
}

/**
 * Roxy 统一配置
 */
export interface RoxyConfig {
  /** 工作区路径 */
  workspace: string
  /** 会话存储路径 */
  sessionDir?: string
  /** LLM Provider 配置 */
  providers: {
    [providerId: string]: ProviderConfig
  }
  /** Agent 默认配置 */
  agents: {
    defaults: {
      model: string
    }
    /** 自定义 Agent 列表 */
    list?: AgentConfig[]
  }
  /** 心跳服务配置 */
  heartbeat?: HeartbeatConfig
  /** Cron 服务配置 */
  cron?: CronConfig
  /** Channel 配置 */
  channels?: {
    [channelId: string]: ChannelConfig
  }
}

/**
 * 默认配置
 */
export const defaultConfig: RoxyConfig = {
  workspace: join(homedir(), '.roxy', 'workspace'),
  sessionDir: join(homedir(), '.roxy', 'sessions'),
  agents: {
    defaults: {
      model: 'ollama/qwen3.5:9b',
    },
  },
  providers: {
    deepseek: {
      apiKey: '',
      baseURL: 'https://api.deepseek.com',
    },
    ollama: {
      apiKey: 'ollama-local',
      baseURL: 'http://localhost:11434/v1',
    },
  },
  heartbeat: {
    enabled: true,
    interval: 1800, // 30 分钟
  },
  cron: {
    enabled: true,
  },
}
