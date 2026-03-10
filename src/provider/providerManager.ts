import { RoxyError, ErrorCode } from '../types/errors'
import { log } from '../utils/error-handler'
import type { ProviderConfig } from '../config/types'
import type LLMProvider from './base'

/**
 * Provider 构造函数类型
 */
type ProviderConstructor = new (cfg: ProviderConfig) => LLMProvider

/**
 * Provider 类型推断规则
 */
type ProviderTypeResolver = (config: ProviderConfig) => boolean

/**
 * Provider 管理器
 *
 * 负责注册、管理和获取 LLM Provider 实例
 * 支持根据配置自动推断 Provider 类型
 */
export class ProviderManager {
  private providers: Map<string, LLMProvider> = new Map()
  private providerConfigs: Map<string, ProviderConfig> = new Map()
  private providerClasses: Map<string, ProviderConstructor> = new Map()

  /**
   * Provider 类型推断规则映射
   * 按顺序匹配，第一个匹配成功的规则对应的 Provider 类型将被使用
   */
  private typeResolvers: Map<string, ProviderTypeResolver> = new Map([
    // Ollama: 本地地址且包含 11434 端口
    [
      'ollama',
      (cfg) => {
        const url = cfg.baseURL.toLowerCase()
        return url.includes('11434') || url.includes('localhost') || url.includes('127.0.0.1')
      },
    ],
    // OpenAI 兼容：兜底规则，所有其他都使用 OpenAIProvider
    ['openai', () => true],
  ])

  /**
   * 根据配置自动推断 Provider 类型
   * @param config Provider 配置
   * @returns 推断出的 Provider 类型
   */
  private inferProviderType(config: ProviderConfig): string {
    // 如果显式指定了 providerType，直接使用
    if (config.providerType) {
      return config.providerType
    }

    // 按顺序匹配推断规则
    for (const [type, resolver] of this.typeResolvers) {
      if (resolver(config)) {
        return type
      }
    }

    // 默认返回 openai
    return 'openai'
  }

  /**
   * 注册 Provider 类
   * @param providerId Provider 标识符
   * @param ProviderClass Provider 类构造函数
   */
  registerProvider(
    providerId: string,
    ProviderClass: new (cfg: ProviderConfig) => LLMProvider,
  ): void {
    this.providerClasses.set(providerId, ProviderClass)
    log('info', `Provider registered: ${providerId}`, 'providerManager')
  }

  /**
   * 配置 Provider
   * @param providerId Provider 标识符
   * @param config Provider 配置
   */
  configureProvider(providerId: string, config: ProviderConfig): void {
    if (!this.providerClasses.has(providerId)) {
      throw new RoxyError(
        ErrorCode.CONFIG_INVALID,
        `Provider not registered: ${providerId}`,
        undefined,
        { providerId },
      )
    }

    this.providerConfigs.set(providerId, config)
    // 清除已存在的实例，下次获取时重新创建
    this.providers.delete(providerId)
    log('info', `Provider configured: ${providerId}`, 'providerManager')
  }

  /**
   * 获取 Provider 实例
   * 根据配置自动使用推断的 Provider 类型
   * @param providerId Provider 标识符（配置中的 key，如 "deepseek"）
   * @returns Provider 实例
   */
  getProvider(providerId: string): LLMProvider {
    // 检查是否已存在实例
    const cached = this.providers.get(providerId)
    if (cached) {
      return cached
    }

    // 获取配置
    const config = this.providerConfigs.get(providerId)

    if (!config) {
      throw new RoxyError(
        ErrorCode.CONFIG_NOT_FOUND,
        `Provider not configured: ${providerId}`,
        undefined,
        { providerId },
      )
    }

    // 使用推断出的 providerType 获取对应的 Provider 类
    const providerType = config.providerType || this.inferProviderType(config)
    const ProviderClass = this.providerClasses.get(providerType)

    if (!ProviderClass) {
      throw new RoxyError(
        ErrorCode.CONFIG_INVALID,
        `Provider type "${providerType}" not registered`,
        undefined,
        { providerId, providerType },
      )
    }

    // 创建新实例
    const provider = new ProviderClass(config)
    this.providers.set(providerId, provider)
    return provider
  }

  /**
   * 获取所有已配置的 Provider ID 列表
   */
  getConfiguredProviders(): string[] {
    return Array.from(this.providerConfigs.keys())
  }

  /**
   * 获取所有已注册的 Provider ID 列表
   */
  getRegisteredProviders(): string[] {
    return Array.from(this.providerClasses.keys())
  }

  /**
   * 移除 Provider 配置
   * @param providerId Provider 标识符
   */
  removeProvider(providerId: string): void {
    this.providerConfigs.delete(providerId)
    this.providers.delete(providerId)
    log('info', `Provider removed: ${providerId}`, 'providerManager')
  }

  /**
   * 从配置批量初始化 Provider
   * 自动推断 Provider 类型并匹配对应的 Provider 类
   * @param providersConfig 配置对象
   */
  initializeFromConfig(providersConfig: Record<string, ProviderConfig>): void {
    for (const [providerId, config] of Object.entries(providersConfig)) {
      // 推断 Provider 类型
      const providerType = this.inferProviderType(config)

      // 检查是否有对应的 Provider 类
      if (!this.providerClasses.has(providerType)) {
        log(
          'warn',
          `Provider type "${providerType}" not registered for provider "${providerId}", skipping`,
          'providerManager',
        )
        continue
      }

      // 从环境变量读取 apiKey（如果配置了 envName）
      const finalConfig = { ...config, providerType }
      if (config.envName && process.env[config.envName]) {
        finalConfig.apiKey = process.env[config.envName]
      }

      // 使用 providerId 作为 key 存储配置，但使用推断出的 providerType 对应的类
      this.providerConfigs.set(providerId, finalConfig)
      // 清除已存在的实例，下次获取时重新创建
      this.providers.delete(providerId)

      log('info', `Provider configured: ${providerId} (type: ${providerType})`, 'providerManager')
    }
  }

  /**
   * 清除所有 Provider
   */
  clear(): void {
    this.providers.clear()
    this.providerConfigs.clear()
    log('info', 'All providers cleared', 'providerManager')
  }
}

// 导出单例
export const providerManager = new ProviderManager()
