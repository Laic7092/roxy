/**
 * Roxy - AI Assistant Framework
 *
 * 事件驱动的 AI 助手框架，支持多 LLM 提供商、工具调用、会话管理和技能扩展
 */

// Provider 管理
export { providerManager, ProviderManager } from './provider/providerManager'

// Provider 实现
export { OllamaProvider } from './provider/ollama'
export { OpenAIProvider } from './provider/openai'
export { LLMProvider } from './provider/index'

// 配置管理
export { loadConfig, saveConfig, updateConfig, initAll } from './config/manager'
export type { RoxyConfig } from './config/types'

// 事件总线
export { bus, getBus, Bus } from './bus/instance'

// 类型定义
export * from './types/errors'
