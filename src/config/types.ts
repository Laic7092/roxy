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
  /** 可选：显式指定 Provider 类型，不填则自动推断 */
  providerType?: 'openai' | 'ollama'
  model?: string
  /** 可选：环境变量名，用于读取 apiKey（优先级高于配置文件） */
  envName?: string
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
 * Web 工具配置
 */
export interface WebToolsConfig {
  /** 代理配置 */
  proxy?: string
  /** 是否验证 SSL 证书，默认 true */
  rejectUnauthorized?: boolean
  /** 搜索工具配置 */
  search?: {
    /** Brave Search API Key */
    apiKey?: string
    /** 最大结果数，默认 5 */
    maxResults?: number
  }
  /** 抓取工具配置 */
  fetch?: {
    /** 最大字符数，默认 50000 */
    maxChars?: number
  }
}

/**
 * 工具配置
 */
export interface ToolsConfig {
  web?: WebToolsConfig
}

/**
 * Agent 默认配置
 */
export interface AgentDefaultsConfig {
  /** 默认使用的模型 */
  model: string
  /** 思考模式，默认 false */
  think?: boolean | 'high' | 'medium' | 'low'
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
    defaults: AgentDefaultsConfig
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
  /** 工具配置 */
  tools?: ToolsConfig
}

/**
 * 默认配置
 *
 * 内置支持的 LLM 服务商：
 * - Ollama: 本地运行，使用原生 API
 * - OpenAI 兼容服务：DeepSeek、Moonshot、零一万物、通义千问等
 */
export const defaultConfig: RoxyConfig = {
  workspace: join(homedir(), '.roxy', 'workspace'),
  sessionDir: join(homedir(), '.roxy', 'sessions'),
  agents: {
    defaults: {
      model: 'ollama/qwen3.5:9b',
      think: false, // 默认关闭思考模式
    },
  },
  providers: {
    // ========== OpenAI 兼容服务 ==========
    // 所有 OpenAI 兼容服务自动使用 OpenAIProvider
    // 格式：model: "<providerId>/<modelName>"
    // 安全提示：建议使用环境变量存储 API Key
    // 配置 envName 后，会从环境变量读取 apiKey，优先级高于配置文件

    deepseek: {
      // DeepSeek: https://platform.deepseek.com
      apiKey: '',
      baseURL: 'https://api.deepseek.com',
      envName: 'DEEPSEEK_API_KEY',
    },

    moonshot: {
      // Moonshot (Kimi): https://platform.moonshot.cn
      apiKey: '',
      baseURL: 'https://api.moonshot.cn/v1',
      envName: 'MOONSHOT_API_KEY',
    },

    '01ai': {
      // 零一万物 (Yi): https://platform.lingyiwanwu.com
      apiKey: '',
      baseURL: 'https://api.lingyiwanwu.com/v1',
      envName: 'YI_API_KEY',
    },

    qwen: {
      // 通义千问：https://dashscope.console.aliyun.com
      apiKey: '',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      envName: 'DASHSCOPE_API_KEY',
    },

    openai: {
      // OpenAI: https://platform.openai.com
      apiKey: '',
      baseURL: 'https://api.openai.com/v1',
      envName: 'OPENAI_API_KEY',
    },

    // ========== 本地服务 ==========
    ollama: {
      // Ollama: 本地运行，使用原生 API
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
