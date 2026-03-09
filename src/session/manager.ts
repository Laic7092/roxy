import { readFile, writeFile, mkdir, unlink, copyFile, opendir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError, log } from '../utils/error-handler'

export type Role = 'system' | 'user' | 'assistant' | 'tool'

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

export interface SessionMetadata {
  channel?: string
  chatId?: string
  [key: string]: any
}

/**
 * Session - 会话数据容器
 *
 * 职责：
 * - 存储会话消息列表
 * - 支持增量合并（last_consolidated）
 * - 提供消息添加和访问方法
 */
export class Session {
  messages: SessionMessage[] = []
  createdAt: Date
  updatedAt: Date
  metadata: SessionMetadata = {}
  lastConsolidated = 0

  constructor(public key: string) {
    const now = new Date()
    this.createdAt = now
    this.updatedAt = now
  }

  /**
   * 添加消息
   */
  addMessage(role: 'tool', content: string, toolCallId: string): void
  addMessage(role: 'assistant', content: string, toolCalls?: any): void
  addMessage(role: 'system' | 'user', content: string): void
  addMessage(role: Role, content: string, meta?: any): void {
    const msg: any = {
      role,
      content: content || '',
      timestamp: new Date().toISOString(),
    }

    if (role === 'tool') {
      if (!meta) {
        throw new Error('Tool messages require a tool_call_id')
      }
      msg.tool_call_id = meta
    } else if (role === 'assistant' && meta) {
      msg.tool_calls = meta
    }

    this.messages.push(msg as SessionMessage)
    this.updatedAt = new Date()
  }

  /**
   * 获取历史消息（未合并的部分），对齐到 user turn
   */
  getHistory(
    max = 500,
  ): Pick<SessionMessage, 'role' | 'content' | 'tool_calls' | 'tool_call_id'>[] {
    const unconsolidated = this.messages.slice(this.lastConsolidated)
    let sliced = unconsolidated.slice(-max)

    // 删除开头的非 user 消息，避免孤立的 tool_result
    for (let i = 0; i < sliced.length; i++) {
      if (sliced[i].role === 'user') {
        sliced = sliced.slice(i)
        break
      }
    }

    return sliced.map((m) => {
      const entry: any = { role: m.role, content: (m as any).content || '' }
      if ('tool_calls' in m && m.tool_calls) entry.tool_calls = m.tool_calls
      if ('tool_call_id' in m && m.tool_call_id) entry.tool_call_id = m.tool_call_id
      return entry
    })
  }

  /**
   * 清空会话
   */
  clear(): void {
    this.messages = []
    this.lastConsolidated = 0
    this.updatedAt = new Date()
  }
}

/**
 * SessionManager - 会话管理
 *
 * 职责：
 * - 加载/保存会话到磁盘（JSONL 格式）
 * - 内存缓存优化
 * - 损坏数据备份和恢复
 * - 支持 metadata 行存储
 */
export class SessionManager {
  private dir: string
  private cache: Map<string, Session> = new Map()

  constructor(sessionDir?: string) {
    this.dir = sessionDir || join(homedir(), '.roxy', 'sessions')
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
  }

  /**
   * 将 session key 编码为安全的文件名
   */
  private encodeKey(key: string): string {
    return key.replace(/[/:]/g, '_') + '.jsonl'
  }

  /**
   * 验证消息格式
   */
  private validateMessage(message: any): boolean {
    if (!message || typeof message !== 'object') return false
    if (!message.role || typeof message.role !== 'string') return false
    if (message.content === undefined || message.content === null) return false
    return true
  }

  /**
   * 备份损坏的文件
   */
  private async backupCorruptedFile(file: string, key: string): Promise<void> {
    try {
      const backupFile = `${file}.corrupted.${Date.now()}.bak`
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
    const cached = this.cache.get(key)
    if (cached) return cached

    const session = await this._load(key)
    if (session === null) {
      const newSession = new Session(key)
      this.cache.set(key, newSession)
      return newSession
    }

    this.cache.set(key, session)
    return session
  }

  /**
   * 从磁盘加载会话
   */
  private async _load(key: string): Promise<Session | null> {
    const file = join(this.dir, this.encodeKey(key))

    try {
      const content = await readFile(file, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      const messages: SessionMessage[] = []
      let metadata: SessionMetadata = {}
      let createdAt: Date | null = null
      let lastConsolidated = 0
      let corruptedLines = 0

      for (const line of lines) {
        try {
          const data = JSON.parse(line)

          // 检查是否是 metadata 行
          if (data._type === 'metadata') {
            metadata = data.metadata || {}
            if (data.created_at) {
              createdAt = new Date(data.created_at)
            }
            lastConsolidated = data.last_consolidated || 0
          } else if (this.validateMessage(data)) {
            messages.push(data as SessionMessage)
          } else {
            corruptedLines++
            logError(
              new RoxyError(
                ErrorCode.SESSION_CORRUPTED,
                `Invalid message format in session ${key}`,
                undefined,
                { line, data },
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
      session.messages = messages
      session.metadata = metadata
      session.lastConsolidated = lastConsolidated
      if (createdAt) session.createdAt = createdAt

      if (messages.length) {
        const lastMsg = messages[messages.length - 1]
        if ('timestamp' in lastMsg && lastMsg.timestamp) {
          session.updatedAt = new Date(lastMsg.timestamp)
        }
      }

      if (corruptedLines > 0) {
        log(
          'warn',
          `Found ${corruptedLines} corrupted message(s) in session ${key}`,
          'SessionManager',
        )
        await this.backupCorruptedFile(file, key)
        await this.save(session)
      }

      return session
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null
      }

      const roxyError = new RoxyError(
        ErrorCode.SESSION_NOT_FOUND,
        `Failed to load session ${key}`,
        error instanceof Error ? error : undefined,
      )
      logError(roxyError, 'warn', 'SessionManager')
      return null
    }
  }

  /**
   * 保存会话到磁盘
   */
  async save(session: Session): Promise<void> {
    try {
      await this.ensureDir()
      const file = join(this.dir, this.encodeKey(session.key))

      const lines: string[] = []

      // 写入 metadata 行
      lines.push(
        JSON.stringify({
          _type: 'metadata',
          key: session.key,
          created_at: session.createdAt.toISOString(),
          updated_at: session.updatedAt.toISOString(),
          metadata: session.metadata,
          last_consolidated: session.lastConsolidated,
        }),
      )

      // 写入消息
      for (const msg of session.messages) {
        lines.push(JSON.stringify(msg))
      }

      await writeFile(file, lines.join('\n'), 'utf-8')
      this.cache.set(session.key, session)
      log('debug', `Session ${session.key} saved successfully`, 'SessionManager')
    } catch (error) {
      const roxyError = new RoxyError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to save session ${session.key}`,
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
      this.cache.delete(key)
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
   * 获取会话（从缓存）
   */
  getSession(key: string): Session | undefined {
    return this.cache.get(key)
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * 列出所有会话
   */
  async listSessions(): Promise<
    Array<{ key: string; createdAt: string; updatedAt: string; path: string }>
  > {
    const sessions: Array<{ key: string; createdAt: string; updatedAt: string; path: string }> = []

    try {
      await this.ensureDir()
      const dir = await opendir(this.dir)

      for await (const dirent of dir) {
        if (dirent.isFile() && dirent.name.endsWith('.jsonl')) {
          try {
            const filePath = join(this.dir, dirent.name)
            const fileContent = await readFile(filePath, 'utf-8')
            const firstLine = fileContent.trim().split('\n')[0]

            if (firstLine) {
              const data = JSON.parse(firstLine)
              if (data._type === 'metadata') {
                sessions.push({
                  key: data.key || dirent.name.replace('.jsonl', ''),
                  createdAt: data.created_at,
                  updatedAt: data.updated_at,
                  path: filePath,
                })
              }
            }
          } catch {
            continue
          }
        }
      }
    } catch {
      // 忽略错误
    }

    return sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }
}
