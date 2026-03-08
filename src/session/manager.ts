import { readFile, writeFile, mkdir, unlink, copyFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError, log } from '../utils/error-handler'

export interface Message {
  role: Role
  content: string
  timestamp?: string
  tool_calls?: any
}

export interface ToolMessage {
  role: 'tool'
  content: string
  tool_call_id: string
}

export type SessionMessage = Message | ToolMessage

export class Session {
  messages: SessionMessage[] = []
  updatedAt: Date

  constructor(public id: string) {
    this.updatedAt = new Date()
  }

  addMessage(role: 'tool', content: string, tool_call_id: string): void
  addMessage(role: 'assistant', content: string, tool_calls: any): void
  addMessage(role: Exclude<Role, 'tool'>, content: string): void
  addMessage(role: Role, content: string, meta?: any) {
    if (role === 'tool') {
      if (!meta) {
        throw new Error('Tool messages require a tool_call_id')
      }

      const toolMessage: ToolMessage = {
        role,
        content,
        tool_call_id: meta,
      }

      this.messages.push(toolMessage)
    } else if (role === 'assistant' && meta) {
      const message: Message = {
        role,
        content,
        tool_calls: meta,
        timestamp: new Date().toISOString(),
      }

      this.messages.push(message)
    } else {
      const message: Message = {
        role,
        content: content || '',
        timestamp: new Date().toISOString(),
      }

      this.messages.push(message)
    }

    this.updatedAt = new Date()
  }

  getHistory(max = 50) {
    const recent = this.messages.slice(-max)
    return recent.map(({ role, content }) => ({ role, content }))
  }

  clear() {
    this.messages = []
    this.updatedAt = new Date()
  }
}

/**
 * SessionManager - 会话管理
 *
 * 职责：
 * - 加载/保存会话到磁盘
 * - 不提供事件订阅，由 Loop 调用
 */
export class SessionManager {
  private dir: string

  // 内存缓存
  private sessions: Map<string, Session> = new Map()

  constructor(sessionDir?: string) {
    this.dir = sessionDir || join(homedir(), '.roxy', 'sessions')
  }

  private async ensureDir() {
    await mkdir(this.dir, { recursive: true })
  }

  /**
   * 将 sessionId 编码为安全的文件名
   * 只替换路径分隔符和特殊字符
   */
  private encodeKey(sessionId: string): string {
    // 简单替换：将 : 和 / 替换为 -
    return sessionId.replace(/[/:]/g, '-') + '.jsonl'
  }

  /**
   * 验证消息格式是否有效
   */
  private validateMessage(message: any): boolean {
    if (!message || typeof message !== 'object') {
      return false
    }
    if (!message.role || typeof message.role !== 'string') {
      return false
    }
    if (message.content === undefined || message.content === null) {
      return false
    }
    return true
  }

  /**
   * 备份损坏的文件
   */
  private async backupCorruptedFile(file: string, key: string): Promise<void> {
    try {
      const backupFile = file + `.corrupted.${Date.now()}.bak`
      await copyFile(file, backupFile)
      log('warn', `Backed up corrupted session file to ${backupFile}`, 'SessionManager', { key })
    } catch (error) {
      logError(
        new RoxyError(
          ErrorCode.SYSTEM_ERROR,
          `Failed to backup corrupted session file`,
          error instanceof Error ? error : undefined,
        ),
        'warn',
        'SessionManager',
      )
    }
  }

  /**
   * 获取或创建会话
   */
  async getOrCreate(key: string): Promise<Session> {
    // 先检查缓存
    const cached = this.sessions.get(key)
    if (cached) {
      return cached
    }

    const file = join(this.dir, this.encodeKey(key))
    try {
      const content = await readFile(file, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      // 验证和修复会话数据
      const validatedMessages: SessionMessage[] = []
      let corruptedLines = 0

      for (const line of lines) {
        try {
          const message = JSON.parse(line)

          // 验证消息格式
          if (this.validateMessage(message)) {
            validatedMessages.push(message)
          } else {
            corruptedLines++
            logError(
              new RoxyError(
                ErrorCode.SESSION_CORRUPTED,
                `Invalid message format in session ${key}`,
                undefined,
                { line, message },
              ),
              'warn',
              'SessionManager',
            )
          }
        } catch (e) {
          corruptedLines++
          logError(
            new RoxyError(
              ErrorCode.SESSION_CORRUPTED,
              `Failed to parse message in session ${key}`,
              e instanceof Error ? e : undefined,
              { line },
            ),
            'warn',
            'SessionManager',
          )
        }
      }

      const session = new Session(key)
      session.messages = validatedMessages

      if (session.messages.length) {
        const lastMsg = session.messages[session.messages.length - 1]
        if ('timestamp' in lastMsg && lastMsg.timestamp) {
          session.updatedAt = new Date(lastMsg.timestamp)
        }
      }

      // 如果有损坏的数据，备份原文件
      if (corruptedLines > 0) {
        log(
          'warn',
          `Found ${corruptedLines} corrupted message(s) in session ${key}`,
          'SessionManager',
        )
        await this.backupCorruptedFile(file, key)
        // 保存修复后的数据
        await this.save(key)
      }

      // 缓存
      this.sessions.set(key, session)

      return session
    } catch (error) {
      // 文件不存在
      if ((error as any).code === 'ENOENT') {
        const session = new Session(key)
        // 缓存
        this.sessions.set(key, session)
        return session
      }

      // 其他错误，记录并返回新会话
      const roxyError = new RoxyError(
        ErrorCode.SESSION_NOT_FOUND,
        `Failed to load session ${key}`,
        error instanceof Error ? error : undefined,
      )
      logError(roxyError, 'warn', 'SessionManager')

      const session = new Session(key)
      // 缓存
      this.sessions.set(key, session)
      return session
    }
  }

  /**
   * 保存会话到磁盘
   */
  async save(sessionId: string): Promise<void> {
    try {
      const session = this.sessions.get(sessionId)
      if (!session) {
        log('warn', `Session ${sessionId} not found in cache, skipping save`, 'SessionManager')
        return
      }

      await this.ensureDir()
      const file = join(this.dir, this.encodeKey(sessionId))
      const lines = session.messages.map((m) => JSON.stringify(m))
      await writeFile(file, lines.join('\n'), 'utf-8')
      log('debug', `Session ${sessionId} saved successfully`, 'SessionManager')
    } catch (error) {
      const roxyError = new RoxyError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to save session ${sessionId}`,
        error instanceof Error ? error : undefined,
      )
      logError(roxyError, 'error', 'SessionManager')
      throw roxyError
    }
  }

  /**
   * 删除会话
   */
  async delete(key: string): Promise<boolean> {
    try {
      await unlink(join(this.dir, this.encodeKey(key)))
      // 清除缓存
      this.sessions.delete(key)
      log('debug', `Session ${key} deleted successfully`, 'SessionManager')
      return true
    } catch (error) {
      const roxyError = new RoxyError(
        ErrorCode.SESSION_NOT_FOUND,
        `Failed to delete session ${key}`,
        error instanceof Error ? error : undefined,
      )
      logError(roxyError, 'warn', 'SessionManager')
      return false
    }
  }

  /**
   * 获取会话
   */
  getSession(key: string): Session | undefined {
    return this.sessions.get(key)
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.sessions.clear()
  }
}
