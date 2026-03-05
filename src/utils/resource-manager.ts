/**
 * Roxy 资源管理器
 *
 * 用于安全地管理和清理资源，确保资源正确释放
 */

import { RoxyError, ErrorCode } from '../types/errors'
import { logError, log } from './error-handler'

/**
 * 资源清理函数类型
 */
export type CleanupFn = () => Promise<void> | void

/**
 * 资源项
 */
interface ResourceItem {
  type: string
  cleanup: CleanupFn
  registeredAt: Date
}

/**
 * 资源清理结果
 */
export interface CleanupResult {
  success: boolean
  failedResources: Array<{
    type: string
    error: Error
  }>
}

/**
 * 资源管理器类
 *
 * 用于注册和管理需要清理的资源，确保在关闭或错误时正确释放资源
 */
export class ResourceManager {
  private resources: ResourceItem[] = []
  private isCleaningUp = false

  /**
   * 注册资源
   *
   * @param type 资源类型标识
   * @param cleanup 清理函数
   */
  register(type: string, cleanup: CleanupFn): void {
    if (this.isCleaningUp) {
      log('warn', `Cannot register resource '${type}' while cleaning up`, 'ResourceManager')
      return
    }

    this.resources.push({
      type,
      cleanup,
      registeredAt: new Date(),
    })

    log('debug', `Resource registered: ${type}`, 'ResourceManager')
  }

  /**
   * 注销资源
   *
   * @param type 资源类型标识
   */
  unregister(type: string): void {
    const index = this.resources.findIndex((r) => r.type === type)
    if (index !== -1) {
      this.resources.splice(index, 1)
      log('debug', `Resource unregistered: ${type}`, 'ResourceManager')
    }
  }

  /**
   * 清理所有资源
   *
   * 按注册顺序的逆序清理资源（后进先出）
   */
  async cleanupAll(): Promise<CleanupResult> {
    if (this.isCleaningUp) {
      log('warn', 'Cleanup already in progress', 'ResourceManager')
      return { success: true, failedResources: [] }
    }

    this.isCleaningUp = true
    const failedResources: Array<{ type: string; error: Error }> = []

    log('info', `Cleaning up ${this.resources.length} resource(s)...`, 'ResourceManager')

    // 逆序清理资源
    for (const resource of this.resources.reverse()) {
      try {
        await resource.cleanup()
        log('debug', `Resource cleaned up: ${resource.type}`, 'ResourceManager')
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        failedResources.push({
          type: resource.type,
          error: err,
        })
        logError(
          new RoxyError(
            ErrorCode.RESOURCE_CLEANUP_FAILED,
            `Failed to cleanup resource '${resource.type}'`,
            err,
          ),
          'warn',
          'ResourceManager',
        )
      }
    }

    // 清空资源列表
    this.resources = []
    this.isCleaningUp = false

    const result: CleanupResult = {
      success: failedResources.length === 0,
      failedResources,
    }

    if (result.success) {
      log('success', 'All resources cleaned up successfully', 'ResourceManager')
    } else {
      log('warn', `Cleanup completed with ${failedResources.length} failure(s)`, 'ResourceManager')
    }

    return result
  }

  /**
   * 获取已注册资源数量
   */
  getResourceCount(): number {
    return this.resources.length
  }

  /**
   * 获取所有已注册的资源类型
   */
  getResourceTypes(): string[] {
    return this.resources.map((r) => r.type)
  }

  /**
   * 检查是否正在清理中
   */
  getIsCleaningUp(): boolean {
    return this.isCleaningUp
  }

  /**
   * 清空所有资源（不清理）
   *
   * 用于特殊情况，当资源已被外部清理时
   */
  clear(): void {
    this.resources = []
    this.isCleaningUp = false
    log('debug', 'All resources cleared without cleanup', 'ResourceManager')
  }
}

/**
 * 带超时的资源清理装饰器
 *
 * @param cleanup 原始清理函数
 * @param timeoutMs 超时时间（毫秒）
 */
export function withCleanupTimeout(cleanup: CleanupFn, timeoutMs: number = 5000): CleanupFn {
  return async () => {
    return Promise.race([
      cleanup(),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          reject(
            new RoxyError(ErrorCode.TIMEOUT, `Resource cleanup timed out after ${timeoutMs}ms`),
          )
        }, timeoutMs),
      ),
    ])
  }
}

/**
 * 安全的资源清理包装器
 *
 * 即使清理函数抛出错误也不会中断流程
 *
 * @param cleanup 清理函数
 * @param resourceType 资源类型（用于日志）
 */
export function safeCleanup(cleanup: CleanupFn, resourceType: string): CleanupFn {
  return async () => {
    try {
      await cleanup()
    } catch (error) {
      logError(
        new RoxyError(
          ErrorCode.RESOURCE_CLEANUP_FAILED,
          `Failed to cleanup ${resourceType}`,
          error instanceof Error ? error : undefined,
        ),
        'warn',
        'ResourceManager',
      )
      // 吞没错误，继续清理其他资源
    }
  }
}
