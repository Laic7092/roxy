/**
 * Roxy 错误处理工具函数
 * 
 * 提供统一的错误处理、日志记录和转换功能
 */

import { RoxyError, ErrorCode, isRecoverableError } from '../types/errors'

/**
 * 日志记录级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success'

/**
 * 日志条目结构
 */
export interface LogEntry {
  timestamp: string
  level: LogLevel
  code?: string
  message: string
  context?: string
  stack?: string
  cause?: string
  metadata?: Record<string, any>
}

/**
 * 统一的日志记录函数
 */
export function log(level: LogLevel, message: string, context?: string, metadata?: Record<string, any>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
    metadata,
  }

  const prefix = getLevelPrefix(level)
  const contextStr = context ? `[${context}] ` : ''

  switch (level) {
    case 'debug':
      if (process.env.DEBUG) {
        console.debug(`${prefix} ${contextStr}${message}`, metadata || '')
      }
      break
    case 'info':
      console.info(`${prefix} ${contextStr}${message}`, metadata || '')
      break
    case 'warn':
      console.warn(`${prefix} ${contextStr}${message}`, metadata || '')
      break
    case 'error':
      console.error(`${prefix} ${contextStr}${message}`, metadata || '')
      break
    case 'success':
      console.log(`${prefix} ${contextStr}${message}`, metadata || '')
      break
  }
}

/**
 * 获取日志级别前缀图标
 */
function getLevelPrefix(level: LogLevel): string {
  const prefixes: Record<LogLevel, string> = {
    debug: '🔍 [DEBUG]',
    info: 'ℹ️  [INFO]',
    warn: '⚠️  [WARN]',
    error: '❌ [ERROR]',
    success: '✅ [SUCCESS]',
  }
  return prefixes[level]
}

/**
 * 记录 RoxyError 错误
 */
export function logError(error: RoxyError, level: LogLevel = 'error', context?: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    code: error.code,
    message: error.message,
    context,
    stack: error.stack,
    cause: error.cause?.message,
    metadata: error.metadata,
  }

  const prefix = getLevelPrefix(level)
  const contextStr = context ? `[${context}] ` : ''

  const output = {
    timestamp: entry.timestamp,
    code: entry.code,
    level: entry.level,
    context: entry.context,
    message: entry.message,
    cause: entry.cause,
    metadata: entry.metadata,
  }

  if (level === 'error') {
    console.error(`${prefix} ${contextStr}${error.message}`)
    if (error.cause) {
      console.error(`  Caused by: ${error.cause.message}`)
    }
    if (error.metadata && Object.keys(error.metadata).length > 0) {
      console.error(`  Metadata:`, JSON.stringify(output, null, 2))
    }
  } else {
    console.warn(`${prefix} ${contextStr}${error.message}`)
    if (error.metadata && Object.keys(error.metadata).length > 0) {
      console.warn(`  Metadata:`, JSON.stringify(output, null, 2))
    }
  }
}

/**
 * 将未知错误转换为 RoxyError
 * 
 * @param error 未知错误
 * @param context 错误发生的上下文
 * @param defaultCode 默认错误代码
 */
export function handleError(error: unknown, context: string, defaultCode: ErrorCode = ErrorCode.SYSTEM_ERROR): RoxyError {
  if (error instanceof RoxyError) {
    // 已经是 RoxyError，直接返回
    return error
  }

  if (error instanceof Error) {
    // 是普通 Error，包装为 RoxyError
    return new RoxyError(
      defaultCode,
      `${context}: ${error.message}`,
      error
    )
  }

  // 是其他类型，创建新的 RoxyError
  return new RoxyError(
    defaultCode,
    `${context}: ${String(error)}`,
    undefined,
    { originalError: error }
  )
}

/**
 * 处理错误并记录日志
 * 
 * @param error 未知错误
 * @param context 错误发生的上下文
 * @param level 日志级别
 * @param defaultCode 默认错误代码
 */
export function handleAndLogError(
  error: unknown,
  context: string,
  level: LogLevel = 'error',
  defaultCode: ErrorCode = ErrorCode.SYSTEM_ERROR
): RoxyError {
  const roxyError = handleError(error, context, defaultCode)
  logError(roxyError, level, context)
  return roxyError
}

/**
 * 安全地执行异步函数，捕获并转换错误
 * 
 * @param fn 要执行的异步函数
 * @param context 错误发生的上下文
 * @param defaultCode 默认错误代码
 * @returns Promise<[T, null] | [null, RoxyError]>
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  context: string,
  defaultCode: ErrorCode = ErrorCode.SYSTEM_ERROR
): Promise<[T, null] | [null, RoxyError]> {
  try {
    const result = await fn()
    return [result, null]
  } catch (error) {
    const roxyError = handleError(error, context, defaultCode)
    return [null, roxyError]
  }
}

/**
 * 创建错误恢复包装器
 * 
 * 自动重试可恢复的错误
 * 
 * @param fn 要执行的异步函数
 * @param context 错误发生的上下文
 * @param maxRetries 最大重试次数
 * @param baseDelay 基础延迟时间（毫秒）
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // 检查是否应该重试
      if (!isRecoverableError(lastError) || attempt === maxRetries) {
        break
      }

      // 计算指数退避延迟
      const backoffMs = Math.min(baseDelay * Math.pow(2, attempt - 1), 10000)
      
      log(
        'warn',
        `${context} failed, retrying (attempt ${attempt}/${maxRetries}) after ${backoffMs}ms`,
        undefined,
        { error: lastError.message }
      )

      await sleep(backoffMs)
    }
  }

  // 所有重试都失败
  throw handleError(
    lastError,
    context,
    ErrorCode.MAX_RETRIES_EXCEEDED
  )
}

/**
 * 带超时的异步操作
 * 
 * @param promise 要执行的 Promise
 * @param timeoutMs 超时时间（毫秒）
 * @param context 错误发生的上下文
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  context: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        reject(new RoxyError(
          ErrorCode.TIMEOUT,
          `${context}: Operation timed out after ${timeoutMs}ms`
        ))
      }, timeoutMs)
    ),
  ])
}

/**
 * 睡眠指定时间
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 格式化错误消息，便于用户理解
 */
export function formatErrorMessage(error: RoxyError): string {
  switch (error.code) {
    case ErrorCode.NETWORK_ERROR:
      return '网络连接错误，请检查网络连接'
    case ErrorCode.HTTP_ERROR:
      return `服务器错误：${error.message}`
    case ErrorCode.CONNECTION_TIMEOUT:
    case ErrorCode.LLM_TIMEOUT:
    case ErrorCode.TIMEOUT:
      return '请求超时，请稍后重试'
    case ErrorCode.LLM_RATE_LIMITED:
      return '请求过于频繁，请稍后重试'
    case ErrorCode.TOOL_NOT_FOUND:
      return `工具未找到：${error.metadata?.toolName || 'unknown'}`
    case ErrorCode.TOOL_EXECUTION_FAILED:
      return `工具执行失败：${error.message}`
    case ErrorCode.TOOL_ARGUMENT_INVALID:
      return '参数无效，请检查输入'
    case ErrorCode.SESSION_NOT_FOUND:
      return '会话未找到'
    case ErrorCode.SESSION_CORRUPTED:
      return '会话数据损坏，已创建新会话'
    case ErrorCode.CONFIG_NOT_FOUND:
      return '配置文件未找到，请运行 onboarding'
    case ErrorCode.CONFIG_INVALID:
      return '配置文件格式错误，请检查配置'
    case ErrorCode.LLM_API_ERROR:
      return 'AI 服务错误，请稍后重试'
    case ErrorCode.ITERATION_LIMIT_EXCEEDED:
      return '处理次数过多，请简化您的请求'
    case ErrorCode.MAX_RETRIES_EXCEEDED:
      return '多次重试失败，请稍后重试'
    default:
      return error.message
  }
}

/**
 * 创建错误跟踪器
 * 
 * 用于收集和统计错误信息
 */
export class ErrorTracker {
  private errors: Map<ErrorCode, number> = new Map()
  private recentErrors: Array<{ timestamp: Date; error: RoxyError }> = []
  private maxRecentErrors = 100

  /**
   * 跟踪错误
   */
  track(error: RoxyError): void {
    // 更新统计
    const count = this.errors.get(error.code) || 0
    this.errors.set(error.code, count + 1)

    // 记录最近错误
    this.recentErrors.push({
      timestamp: new Date(),
      error,
    })

    // 保持最近错误列表大小
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors.shift()
    }
  }

  /**
   * 获取错误统计
   */
  getStats(): Record<string, any> {
    return {
      totalErrors: Array.from(this.errors.values()).reduce((a, b) => a + b, 0),
      errorCounts: Object.fromEntries(this.errors),
      recentErrorCount: this.recentErrors.length,
    }
  }

  /**
   * 获取最近错误列表
   */
  getRecentErrors(limit: number = 10): Array<{ timestamp: Date; error: RoxyError }> {
    return this.recentErrors.slice(-limit)
  }

  /**
   * 检查错误率是否过高
   */
  isErrorRateHigh(threshold: number = 10): boolean {
    const lastMinute = this.recentErrors.filter(
      e => Date.now() - e.timestamp.getTime() < 60000
    )
    return lastMinute.length > threshold
  }

  /**
   * 清除统计
   */
  clear(): void {
    this.errors.clear()
    this.recentErrors = []
  }
}

// 导出全局错误跟踪器实例
export const globalErrorTracker = new ErrorTracker()
