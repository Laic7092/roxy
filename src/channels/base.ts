import type { IChannel, ChannelMessage, ChannelInputHandler, ChannelOutputHandler } from './types'

/**
 * Channel 抽象基类
 *
 * 职责：
 * - 只负责 I/O
 * - 不处理业务逻辑
 * - 通过回调与 Gateway 通信
 */
export abstract class BaseChannel implements IChannel {
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
   * 输入处理器
   */
  protected inputHandler: ChannelInputHandler | null = null

  /**
   * 输出处理器
   */
  protected outputHandler: ChannelOutputHandler | null = null

  /**
   * 设置输入处理器
   */
  setInputHandler(handler: ChannelInputHandler): void {
    this.inputHandler = handler
  }

  /**
   * 设置输出处理器
   */
  setOutputHandler(handler: ChannelOutputHandler): void {
    this.outputHandler = handler
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
   * 发送消息到 Gateway (Input)
   */
  send(content: string): void {
    if (this.inputHandler) {
      this.inputHandler(content)
    }
  }

  /**
   * 接收来自 Gateway 的消息 (Output)
   */
  abstract receive(message: ChannelMessage): Promise<void>

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
  get sessionIdValue(): string | null {
    return this.sessionId
  }

  /**
   * 是否正在运行
   */
  get isRunning(): boolean {
    return this._running
  }
}
