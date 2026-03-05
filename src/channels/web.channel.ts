import { WebSocket } from 'ws'
import { BaseChannel } from './base'
import type { EventBus } from '../bus/instance'
import type { Session } from '../session/manager'
import type { SessionManager } from '../session/manager'
import { ResourceManager } from '../utils/resource-manager'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError } from '../utils/error-handler'

/**
 * WEB Channel - WebSocket 通道
 * 每个 WebSocket 连接对应一个 WebChannel 实例
 *
 * 职责：
 * - 只负责 I/O
 * - 发布用户消息事件
 * - 监听并显示 Agent 响应
 */
export class WebChannel extends BaseChannel {
  readonly id: string

  private ws: WebSocket
  private messageQueue: any[] = []

  // Session 管理
  private session: Session | null = null
  private sessionManager: SessionManager | null = null

  // 资源管理器
  private resourceManager = new ResourceManager()

  constructor(ws: WebSocket, eventBus: EventBus, sessionId?: string) {
    super(eventBus)
    this.id = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    this.ws = ws
    this.sessionId = sessionId || this.id
  }

  /**
   * 初始化 Session
   */
  async initialize(sessionManager: SessionManager): Promise<void> {
    this.sessionManager = sessionManager
    this.session = await sessionManager.getOrCreate(this.sessionId!)
  }

  async start(): Promise<void> {
    if (this._running) return

    this._running = true

    try {
      // 注册 WebSocket 关闭资源
      this.resourceManager.register('websocket', async () => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close()
        }
      })

      // 注册消息队列清理
      this.resourceManager.register('messageQueue', async () => {
        this.messageQueue = []
      })

      // 订阅事件
      this.subscribeEvents()

      // 发送连接成功消息
      this.sendToClient({
        type: 'connected',
        channelId: this.id,
        sessionId: this.sessionId,
      })
    } catch (error) {
      const roxyError = error instanceof RoxyError
        ? error
        : new RoxyError(
            ErrorCode.CHANNEL_CONNECTION_FAILED,
            'Failed to start Web channel',
            error instanceof Error ? error : undefined
          )
      logError(roxyError, 'error', 'WebChannel')
      throw roxyError
    }
  }

  async stop(): Promise<void> {
    this._running = false
    try {
      await this.resourceManager.cleanupAll()
    } catch (error) {
      logError(
        error instanceof RoxyError ? error : new RoxyError(
          ErrorCode.RESOURCE_CLEANUP_FAILED,
          'Failed to cleanup Web channel resources',
          error instanceof Error ? error : undefined
        ),
        'warn',
        'WebChannel'
      )
    }
  }

  /**
   * 订阅事件
   */
  private subscribeEvents(): void {
    // 监听 Agent 流式输出
    this.eventBus.on('agent:stream', (event) => {
      if (event.channelId === this.id) {
        this.sendToClient({ type: 'stream', content: event.chunk })
      }
    })

    // 监听 Agent 响应
    this.eventBus.on('agent:response', (event) => {
      if (event.channelId === this.id) {
        this.sendToClient({ type: 'response', content: event.content })
      }
    })

    // 监听工具调用
    this.eventBus.on('agent:tool_call', (event) => {
      if (event.channelId === this.id) {
        this.sendToClient({
          type: 'tool_call',
          name: event.toolName,
          args: event.toolArgs,
        })
      }
    })

    // 监听工具结果
    this.eventBus.on('agent:tool_result', (event) => {
      if (event.channelId === this.id) {
        this.sendToClient({
          type: 'tool_result',
          name: event.toolName,
          result: event.toolResult,
        })
      }
    })

    // 监听错误
    this.eventBus.on('error', (event) => {
      if (event.channelId === this.id) {
        this.sendToClient({
          type: 'error',
          content: event.error instanceof Error ? event.error.message : String(event.error),
        })
      }
    })
  }

  /**
   * 显示消息
   */
  async display(msg: any): Promise<void> {
    this.sendToClient(msg)
  }

  /**
   * 处理接收到的 WebSocket 消息
   */
  async handleMessage(data: string): Promise<void> {
    try {
      const parsed = JSON.parse(data)

      switch (parsed.type) {
        case 'message':
          // 发布用户消息事件
          await this.handleInput(parsed.content)
          break

        case 'create_session':
          this.sessionId = await this.createSession()
          // 重新初始化 Session
          this.session = null
          if (this.sessionManager) {
            this.session = await this.sessionManager.getOrCreate(this.sessionId)
          }
          this.sendToClient({
            type: 'session_created',
            sessionId: this.sessionId,
          })
          break

        case 'switch_session':
          await this.switchSession(parsed.sessionId)
          // 重新加载 Session
          if (this.sessionManager) {
            this.session = await this.sessionManager.getOrCreate(parsed.sessionId)
          }
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
   * 发送消息到客户端
   */
  private sendToClient(data: any): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      this.messageQueue.push(data)
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
