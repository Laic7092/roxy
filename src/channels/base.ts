import type { MessageBus } from '../bus/instance'
import type { InboundMessage, OutboundMessage } from '../bus/types'

/**
 * Channel 抽象基类
 *
 * 所有通道（CLI、WEB 等）都应继承此类，实现具体的输入输出逻辑
 */
export abstract class BaseChannel {
  /**
   * 通道唯一标识
   */
  abstract readonly id: string

  /**
   * 是否正在运行
   */
  protected _running = false

  /**
   * 当前会话 ID
   */
  protected sessionId: string | null = null

  /**
   * MessageBus 实例
   */
  protected bus: MessageBus

  constructor(bus: MessageBus) {
    this.bus = bus
  }

  /**
   * 启动通道
   */
  abstract start(): Promise<void>

  /**
   * 停止通道
   */
  abstract stop(): Promise<void>

  /**
   * 发送消息到通道
   */
  abstract send(msg: OutboundMessage): Promise<void>

  /**
   * 处理用户输入 - 发布到 BUS
   */
  protected async handleInput(content: string, sessionId?: string): Promise<void> {
    await this.bus.publishInbound({
      channelId: this.id,
      content,
      sessionId,
      timestamp: new Date(),
    })
  }

  /**
   * 创建新会话
   */
  async createSession(): Promise<string> {
    const newSessionId = `${this.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    this.sessionId = newSessionId
    return newSessionId
  }

  /**
   * 切换到指定会话
   */
  async switchSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId
  }

  /**
   * 获取当前会话 ID
   */
  getSessionId(): string | null {
    return this.sessionId
  }

  /**
   * 是否正在运行
   */
  get isRunning(): boolean {
    return this._running
  }
}
