import { WebSocket } from 'ws'
import { BaseChannel } from './base'
import type { MessageBus } from '../bus/instance'
import type { OutboundMessage } from '../bus/types'
import type { AgentLoop } from '../agent/loop'
import type { Session } from '../session/manager'
import { ContextMng } from '../agent/context'

/**
 * WEB Channel - WebSocket 通道
 * 每个 WebSocket 连接对应一个 WebChannel 实例
 * 
 * 职责：
 * - 管理自己的 Session 和 Context
 * - 直接调用 AgentLoop.process() 处理消息
 * - 通过 Bus 发布 outbound 消息，供其他 Channel 监听
 */
export class WebChannel extends BaseChannel {
  readonly id: string

  private ws: WebSocket
  private messageQueue: OutboundMessage[] = []

  // 自己管理 Session 和 Context
  private session: Session | null = null
  private ctx: ContextMng | null = null
  private sessionManager: any = null

  // AgentLoop 引用（由外部注入）
  private agentLoop: AgentLoop | null = null

  constructor(ws: WebSocket, bus: MessageBus, sessionId?: string) {
    super(bus)
    this.id = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    this.ws = ws
    this.sessionId = sessionId || this.id
  }

  /**
   * 设置 AgentLoop 实例（依赖注入）
   */
  setAgentLoop(agentLoop: AgentLoop): void {
    this.agentLoop = agentLoop
  }

  /**
   * 初始化 Session 和 Context
   */
  async initialize(workspace: string, sessionManager: any): Promise<void> {
    this.sessionManager = sessionManager
    this.session = await sessionManager.getOrCreate(this.sessionId!)
    this.ctx = new ContextMng(workspace, true)
  }

  async start(): Promise<void> {
    if (this._running) return

    this._running = true

    // 发送连接成功消息
    this.sendToClient({
      type: 'connected',
      channelId: this.id,
      sessionId: this.sessionId,
    })

    // 开始消费出站消息
    this.consumeOutboundMessages()
  }

  async stop(): Promise<void> {
    this._running = false
    this.ws.close()
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      this.messageQueue.push(msg)
    }
  }

  /**
   * 处理接收到的 WebSocket 消息
   */
  async handleMessage(data: string): Promise<void> {
    try {
      const parsed = JSON.parse(data)

      switch (parsed.type) {
        case 'message':
          // 发布到 Bus（用于通知其他 Channel）
          await this.handleInput(parsed.content, this.sessionId || undefined)
          // 直接调用 AgentLoop 处理
          await this.processMessage(parsed.content)
          break

        case 'create_session':
          this.sessionId = await this.createSession()
          // 重新初始化 Session 和 Context
          if (this.session) {
            await this.session.save()
          }
          this.session = null
          this.ctx = null
          this.sendToClient({
            type: 'session_created',
            sessionId: this.sessionId,
          })
          break

        case 'switch_session':
          await this.switchSession(parsed.sessionId)
          // 重新初始化 Session 和 Context
          this.session = null
          this.ctx = null
          this.sendToClient({
            type: 'session_switched',
            sessionId: parsed.sessionId,
          })
          break

        case 'get_sessions':
          // TODO: 从 SessionManager 获取会话列表
          this.sendToClient({
            type: 'sessions_list',
            sessions: [],
          })
          break

        case 'delete_session':
          // TODO: 通过 SessionManager 删除会话
          break
      }
    } catch (error) {
      this.sendToClient({
        type: 'error',
        content: `Error processing message: ${error}`,
      })
    }
  }

  /**
   * 处理消息
   */
  private async processMessage(content: string): Promise<void> {
    if (!this.agentLoop || !this.session || !this.ctx) {
      await this.publish('error', 'Agent not initialized')
      return
    }

    try {
      // 发布 typing 状态
      await this.publish('typing', 'Thinking...')

      // 调用 AgentLoop 处理
      await this.agentLoop.process(content, this.session, this.ctx, {
        onStream: (chunk) => {
          this.publish('stream', chunk)
        },
        onToolCall: (name, args) => {
          this.publish('tool_call', { name, args })
        },
        onToolResult: (name, result) => {
          this.publish('tool_result', { name, result })
        },
      })

      // 保存 session 到磁盘
      await this.sessionManager.save(this.session)
    } catch (error) {
      await this.publish('error', error instanceof Error ? error.message : 'Unknown error')
    }
  }

  /**
   * 发布消息到 Bus
   */
  private async publish(type: OutboundMessage['type'], content: any): Promise<void> {
    await this.bus.publishOutbound({
      channelId: this.id,
      type,
      content,
    })
  }

  /**
   * 消费出站消息队列（仅处理发给自己的消息）
   */
  private async consumeOutboundMessages(): Promise<void> {
    while (this._running) {
      try {
        const msg = await this.bus.consumeOutbound()
        if (msg.channelId === this.id) {
          await this.send(msg)
        }
      } catch (error) {
        console.error('Error consuming outbound message:', error)
      }
    }
  }

  /**
   * 发送消息到客户端
   */
  private sendToClient(data: any): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  /**
   * 设置 WebSocket 消息处理器
   */
  setupMessageHandler(): void {
    this.ws.on('message', async (data) => {
      await this.handleMessage(data.toString())
    })

    this.ws.on('close', async () => {
      console.log('Client disconnected:', this.id)
      await this.stop()
    })

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error)
    })
  }
}
