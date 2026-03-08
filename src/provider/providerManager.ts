import { RoxyError, ErrorCode } from '../types/errors'
import { log } from '../utils/error-handler'
import type { ProviderConfig } from '../config/types'
import type LLMProvider from './base'

/**
 * Provider 构造函数类型
 */
type ProviderConstructor = new (cfg: ProviderConfig) => LLMProvider

/**
 * Provider 管理器
 * 
 * 负责注册、管理和获取 LLM Provider 实例
 */
export class ProviderManager {
  private providers: Map<string, LLMProvider> = new Map()
  private providerConfigs: Map<string, ProviderConfig> = new Map()
  private providerClasses: Map<string, ProviderConstructor> = new Map()

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
   * @param providerId Provider 标识符
   * @returns Provider 实例
   */
  getProvider(providerId: string): LLMProvider {
    // 检查是否已存在实例
    const cached = this.providers.get(providerId)
    if (cached) {
      return cached
    }

    // 获取配置和 Provider 类
    const config = this.providerConfigs.get(providerId)
    const ProviderClass = this.providerClasses.get(providerId)

    // 检查是否已注册
    if (!ProviderClass) {
      throw new RoxyError(
        ErrorCode.CONFIG_INVALID,
        `Provider not registered: ${providerId}`,
        undefined,
        { providerId },
      )
    }

    // 检查是否已配置
    if (!config) {
      throw new RoxyError(
        ErrorCode.CONFIG_NOT_FOUND,
        `Provider not configured: ${providerId}`,
        undefined,
        { providerId },
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
   * @param providersConfig 配置对象
   */
  initializeFromConfig(providersConfig: Record<string, ProviderConfig>): void {
    for (const [providerId, config] of Object.entries(providersConfig)) {
      if (this.providerClasses.has(providerId)) {
        this.configureProvider(providerId, config)
      } else {
        log('warn', `Provider not registered, skipping: ${providerId}`, 'providerManager')
      }
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
