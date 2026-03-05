import type { EventBus } from '../bus/instance'

/**
 * Channel 抽象基类
 *
 * 所有通道（CLI、WEB 等）都应继承此类，实现具体的输入输出逻辑
 *
 * 职责：
 * - 只负责 I/O
 * - 发布用户消息事件
 * - 监听并显示 Agent 响应
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
   * EventBus 实例
   */
  protected eventBus: EventBus

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus
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
   * 显示消息到通道
   */
  abstract display(msg: any): Promise<void>

  /**
   * 处理用户输入 - 发布事件
   */
  protected async handleInput(content: string): Promise<void> {
    this.eventBus.publishUserMessage({
      channelId: this.id,
      sessionId: this.sessionId!,
      content,
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
