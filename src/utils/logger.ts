/**
 * 统一日志记录器
 *
 * 将日志持久化到 workspace 目录，同时支持控制台输出
 */

import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import chalk from 'chalk'

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  SUCCESS = 'success',
}

/**
 * 日志条目结构
 */
export interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  metadata?: Record<string, any>
}

/**
 * 日志记录器类
 */
export class Logger {
  private workspacePath: string
  private logFilePath: string
  private enabledLevels: Set<LogLevel>
  private logToConsole: boolean

  constructor(workspacePath: string, options?: {
    logToConsole?: boolean
    enabledLevels?: LogLevel[]
  }) {
    this.workspacePath = workspacePath
    this.logFilePath = join(workspacePath, 'logs', 'tool-executor.log')
    this.logToConsole = options?.logToConsole ?? true
    this.enabledLevels = new Set(options?.enabledLevels ?? [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
      LogLevel.SUCCESS,
    ])
  }

  /**
   * 确保日志目录存在
   */
  private async ensureLogDir(): Promise<void> {
    const logDir = join(this.workspacePath, 'logs')
    await mkdir(logDir, { recursive: true })
  }

  /**
   * 格式化日志条目
   */
  private formatEntry(entry: LogEntry): string {
    const metadataStr = entry.metadata ? ` | ${JSON.stringify(entry.metadata)}` : ''
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}${metadataStr}\n`
  }

  /**
   * 写入日志到文件
   */
  private async writeToFile(entry: LogEntry): Promise<void> {
    try {
      await this.ensureLogDir()
      const line = this.formatEntry(entry)
      await appendFile(this.logFilePath, line, 'utf-8')
    } catch (error) {
      // 日志写入失败时不抛出错误，避免影响主流程
      if (this.logToConsole) {
        console.error('[Logger] Failed to write log file:', error)
      }
    }
  }

  /**
   * 输出到控制台
   */
  private writeToConsole(entry: LogEntry): void {
    if (!this.logToConsole) return

    const icon = this.getLevelIcon(entry.level)
    const colorFn = this.getLevelColor(entry.level)
    const message = colorFn(`${icon} [${entry.module}] ${entry.message}`)

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(message)
        break
      case LogLevel.INFO:
        console.info(message)
        break
      case LogLevel.WARN:
        console.warn(message)
        break
      case LogLevel.ERROR:
        console.error(message)
        break
      case LogLevel.SUCCESS:
        console.log(message)
        break
    }
  }

  /**
   * 获取日志级别图标
   */
  private getLevelIcon(level: LogLevel): string {
    const icons: Record<LogLevel, string> = {
      [LogLevel.DEBUG]: '🔍',
      [LogLevel.INFO]: 'ℹ️',
      [LogLevel.WARN]: '⚠️',
      [LogLevel.ERROR]: '❌',
      [LogLevel.SUCCESS]: '✅',
    }
    return icons[level]
  }

  /**
   * 获取日志级别颜色函数
   */
  private getLevelColor(level: LogLevel): (str: string) => string {
    const colors: Record<LogLevel, (str: string) => string> = {
      [LogLevel.DEBUG]: chalk.gray,
      [LogLevel.INFO]: chalk.blue,
      [LogLevel.WARN]: chalk.yellow,
      [LogLevel.ERROR]: chalk.red,
      [LogLevel.SUCCESS]: chalk.green,
    }
    return colors[level]
  }

  /**
   * 记录日志
   */
  async log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    if (!this.enabledLevels.has(level)) {
      return
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: 'ToolExecutor',
      message,
      metadata,
    }

    // 并行写入文件和输出到控制台
    await Promise.all([
      this.writeToFile(entry),
      Promise.resolve(this.writeToConsole(entry)),
    ])
  }

  /**
   * 快捷方法：DEBUG 级别
   */
  async debug(message: string, metadata?: Record<string, any>): Promise<void> {
    return this.log(LogLevel.DEBUG, message, metadata)
  }

  /**
   * 快捷方法：INFO 级别
   */
  async info(message: string, metadata?: Record<string, any>): Promise<void> {
    return this.log(LogLevel.INFO, message, metadata)
  }

  /**
   * 快捷方法：WARN 级别
   */
  async warn(message: string, metadata?: Record<string, any>): Promise<void> {
    return this.log(LogLevel.WARN, message, metadata)
  }

  /**
   * 快捷方法：ERROR 级别
   */
  async error(message: string, metadata?: Record<string, any>): Promise<void> {
    return this.log(LogLevel.ERROR, message, metadata)
  }

  /**
   * 快捷方法：SUCCESS 级别
   */
  async success(message: string, metadata?: Record<string, any>): Promise<void> {
    return this.log(LogLevel.SUCCESS, message, metadata)
  }

  /**
   * 设置日志级别过滤
   */
  setEnabledLevels(levels: LogLevel[]): void {
    this.enabledLevels = new Set(levels)
  }

  /**
   * 启用/禁用控制台输出
   */
  setConsoleOutput(enabled: boolean): void {
    this.logToConsole = enabled
  }
}

/**
 * 创建日志记录器实例
 */
export function createLogger(workspacePath: string, options?: {
  logToConsole?: boolean
  enabledLevels?: LogLevel[]
}): Logger {
  return new Logger(workspacePath, options)
}
