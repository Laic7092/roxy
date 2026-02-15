import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'

export interface Message {
  role: Role
  content: string
  timestamp: string
  tool_calls: any
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

  async getOrCreate(key: string): Promise<Session> {
    const file = join(this.dir, this.encodeKey(key))
    try {
      const content = await readFile(file, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)
      const session = new Session(key)
      session.messages = lines.map((line) => JSON.parse(line))
      if (session.messages.length) {
        session.updatedAt = new Date(session.messages[session.messages.length - 1].timestamp)
      }
      return session
    } catch {
      return new Session(key)
    }
  }

  async save(session: Session): Promise<void> {
    await this.ensureDir()
    const file = join(this.dir, this.encodeKey(session.key))
    const lines = session.messages.map((m) => JSON.stringify(m))
    await writeFile(file, lines.join('\n'), 'utf-8')
  }

  async delete(key: string): Promise<boolean> {
    try {
      await unlink(join(this.dir, this.encodeKey(key)))
      return true
    } catch {
      return false
    }
  }
}
