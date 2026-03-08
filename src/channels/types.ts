/**
 * Channel 输出消息类型
 */
export interface ChannelMessage {
  type:
    | 'response'
    | 'stream'
    | 'tool_call'
    | 'tool_result'
    | 'error'
    | 'connected'
    | 'session_created'
    | 'session_switched'
    | 'sessions_list'
  content?: any
  data?: any
  sessionId?: string
  channelId?: string
}

/**
 * Channel 输入处理器
 */
export type ChannelInputHandler = (content: string) => void | Promise<void>

/**
 * Channel 输出处理器
 */
export type ChannelOutputHandler = (message: ChannelMessage) => void | Promise<void>

/**
 * Channel 接口 - 纯粹的 I/O 通道
 *
 * 职责：
 * - 只负责 send/receive msg
 * - 不处理业务逻辑
 * - 不直接依赖 EventBus
 */
export interface IChannel {
  /**
   * 通道唯一标识
   */
  readonly id: string

  /**
   * 当前会话 ID
   */
  readonly sessionId: string | null

  /**
   * 是否正在运行
   */
  readonly isRunning: boolean

  /**
   * 启动通道
   */
  start(): Promise<void>

  /**
   * 停止通道
   */
  stop(): Promise<void>

  /**
   * 发送消息到 Gateway (Input)
   */
  send(content: string): void

  /**
   * 接收来自 Gateway 的消息 (Output)
   */
  receive(message: ChannelMessage): Promise<void>

  /**
   * 设置输入处理器
   */
  setInputHandler(handler: ChannelInputHandler): void

  /**
   * 设置输出处理器
   */
  setOutputHandler(handler: ChannelOutputHandler): void

  /**
   * 创建新会话
   */
  createSession(): Promise<string>

  /**
   * 切换到指定会话
   */
  switchSession(sessionId: string): Promise<void>
}
