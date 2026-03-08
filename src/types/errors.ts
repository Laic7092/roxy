/**
 * Roxy 错误类型定义
 *
 * 提供统一的错误分类和错误对象，便于错误处理和监控
 */

/**
 * 错误代码枚举
 */
export enum ErrorCode {
  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  HTTP_ERROR = 'HTTP_ERROR',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  LLM_TIMEOUT = 'LLM_TIMEOUT',

  // 配置错误
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  CONFIG_INVALID = 'CONFIG_INVALID',

  // 会话错误
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_CORRUPTED = 'SESSION_CORRUPTED',

  // 工具错误
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
  TOOL_ARGUMENT_INVALID = 'TOOL_ARGUMENT_INVALID',
  TOOL_ARGUMENT_PARSE_ERROR = 'TOOL_ARGUMENT_PARSE_ERROR',

  // LLM 错误
  LLM_API_ERROR = 'LLM_API_ERROR',
  LLM_RATE_LIMITED = 'LLM_RATE_LIMITED',
  LLM_RESPONSE_INVALID = 'LLM_RESPONSE_INVALID',

  // 系统错误
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
  MEMORY_LIMIT_EXCEEDED = 'MEMORY_LIMIT_EXCEEDED',
  RESOURCE_CLEANUP_FAILED = 'RESOURCE_CLEANUP_FAILED',

  // 迭代和超时错误
  ITERATION_LIMIT_EXCEEDED = 'ITERATION_LIMIT_EXCEEDED',
  TIMEOUT = 'TIMEOUT',

  // 解析错误
  JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',
  SSE_PARSE_ERROR = 'SSE_PARSE_ERROR',

  // 通道错误
  CHANNEL_NOT_INITIALIZED = 'CHANNEL_NOT_INITIALIZED',
  CHANNEL_CONNECTION_FAILED = 'CHANNEL_CONNECTION_FAILED',

  // 通用错误
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',

  // 重试相关
  RETRY_ATTEMPT = 'RETRY_ATTEMPT',
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',
}

/**
 * Roxy 统一错误类
 *
 * 用于包装所有错误，提供错误代码、原因和元数据
 */
export class RoxyError extends Error {
  /**
   * @param code 错误代码
   * @param message 错误消息
   * @param cause 原始错误（可选）
   * @param metadata 附加元数据（可选）
   */
  constructor(
    public code: ErrorCode,
    message: string,
    public cause?: Error,
    public metadata?: Record<string, any>,
  ) {
    super(message)
    this.name = 'RoxyError'

    // 捕获堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RoxyError)
    }
  }

  /**
   * 转换为 JSON 格式，便于日志记录和 API 响应
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      stack: this.stack,
      cause: this.cause?.message,
      metadata: this.metadata,
    }
  }

  /**
   * 从未知错误创建 RoxyError
   */
  static from(
    error: unknown,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    context?: string,
  ): RoxyError {
    if (error instanceof RoxyError) {
      return error
    }

    if (error instanceof Error) {
      return new RoxyError(code, context ? `${context}: ${error.message}` : error.message, error)
    }

    return new RoxyError(
      code,
      context ? `${context}: ${String(error)}` : String(error),
      undefined,
      { originalError: error },
    )
  }

  /**
   * 创建网络错误
   */
  static network(message: string, cause?: Error): RoxyError {
    return new RoxyError(ErrorCode.NETWORK_ERROR, message, cause)
  }

  /**
   * 创建 HTTP 错误
   */
  static http(status: number, message?: string, cause?: Error): RoxyError {
    const msg = message || `HTTP error! status: ${status}`
    return new RoxyError(ErrorCode.HTTP_ERROR, msg, cause, { statusCode: status })
  }

  /**
   * 创建工具错误
   */
  static tool(toolName: string, message: string, cause?: Error): RoxyError {
    return new RoxyError(ErrorCode.TOOL_EXECUTION_FAILED, `Tool '${toolName}': ${message}`, cause, {
      toolName,
    })
  }

  /**
   * 创建会话错误
   */
  static session(sessionId: string, message: string, cause?: Error): RoxyError {
    return new RoxyError(ErrorCode.SESSION_NOT_FOUND, `Session '${sessionId}': ${message}`, cause, {
      sessionId,
    })
  }

  /**
   * 创建 LLM API 错误
   */
  static llm(message: string, cause?: Error, metadata?: Record<string, any>): RoxyError {
    return new RoxyError(ErrorCode.LLM_API_ERROR, message, cause, metadata)
  }
}

/**
 * 判断错误是否为致命错误（不可恢复）
 */
export function isFatalError(error: Error): boolean {
  if (error instanceof RoxyError) {
    const fatalCodes: ErrorCode[] = [
      ErrorCode.CONFIG_INVALID,
      ErrorCode.TOOL_ARGUMENT_INVALID,
      ErrorCode.LLM_RESPONSE_INVALID,
      ErrorCode.RESOURCE_EXHAUSTED,
      ErrorCode.MEMORY_LIMIT_EXCEEDED,
    ]
    return fatalCodes.includes(error.code)
  }

  return false
}
