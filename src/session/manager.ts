import { readFile, writeFile, mkdir, unlink, copyFile } from 'fs/promises'
import { join } from 'path'
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
  key: string
  messages: SessionMessage[] = []
  updatedAt: Date

  constructor(public id: string) {
    this.key = id
    this.updatedAt = new Date()
  }

  addMessage(role: 'tool', content: string, tool_call_id: string): void
  addMessage(role: 'assistant', content: string, tool_calls: any): void
  addMessage(role: Exclude<Role, 'tool'>, content: string): void
  addMessage(role: Role, content: string, tool_call_id?: string) {
    if (role === 'tool') {
      if (!tool_call_id) {
        throw new Error('Tool messages require a tool_call_id')
      }

      const toolMessage: ToolMessage = {
        role,
        content,
        tool_call_id,
      }

      this.messages.push(toolMessage)
    } else if (role === 'assistant' && tool_call_id) {
      const message: Message = {
        role,
        content,
        tool_calls: tool_call_id,
        timestamp: new Date().toISOString(),
      }

      this.messages.push(message)
    } else {
      const message: Message = {
        role,
        content,
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

export class SessionManager {
  private dir: string

  constructor(sessionDir?: string) {
    this.dir = sessionDir || join(require('os').homedir(), '.roxy', 'sessions')
  }

  private async ensureDir() {
    await mkdir(this.dir, { recursive: true })
  }

  private encodeKey(key: string) {
    return key.replace(/[^a-z0-9]/gi, '_') + '.jsonl'
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
          error instanceof Error ? error : undefined
        ),
        'warn',
        'SessionManager'
      )
    }
  }

  async getOrCreate(key: string): Promise<Session> {
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
                { line, message }
              ),
              'warn',
              'SessionManager'
            )
          }
        } catch (e) {
          corruptedLines++
          logError(
            new RoxyError(
              ErrorCode.SESSION_CORRUPTED,
              `Failed to parse message in session ${key}`,
              e instanceof Error ? e : undefined,
              { line }
            ),
            'warn',
            'SessionManager'
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
        log('warn', `Found ${corruptedLines} corrupted message(s) in session ${key}`, 'SessionManager')
        await this.backupCorruptedFile(file, key)
        // 保存修复后的数据
        await this.save(session)
      }

      return session

    } catch (error) {
      // 文件不存在
      if ((error as any).code === 'ENOENT') {
        return new Session(key)
      }

      // 其他错误，记录并返回新会话
      const roxyError = new RoxyError(
        ErrorCode.SESSION_NOT_FOUND,
        `Failed to load session ${key}`,
        error instanceof Error ? error : undefined
      )
      logError(roxyError, 'warn', 'SessionManager')

      return new Session(key)
    }
  }

  async save(session: Session): Promise<void> {
    try {
      await this.ensureDir()
      const file = join(this.dir, this.encodeKey(session.key))
      const lines = session.messages.map((m) => JSON.stringify(m))
      await writeFile(file, lines.join('\n'), 'utf-8')
      log('debug', `Session ${session.key} saved successfully`, 'SessionManager')
    } catch (error) {
      const roxyError = new RoxyError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to save session ${session.key}`,
        error instanceof Error ? error : undefined
      )
      logError(roxyError, 'error', 'SessionManager')
      throw roxyError
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await unlink(join(this.dir, this.encodeKey(key)))
      log('debug', `Session ${key} deleted successfully`, 'SessionManager')
      return true
    } catch (error) {
      const roxyError = new RoxyError(
        ErrorCode.SESSION_NOT_FOUND,
        `Failed to delete session ${key}`,
        error instanceof Error ? error : undefined
      )
      logError(roxyError, 'warn', 'SessionManager')
      return false
    }
  }
}
