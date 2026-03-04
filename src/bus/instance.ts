import mitt from 'mitt'
import type { InboundMessage, OutboundMessage, BusEvents } from './types'

/**
 * 异步队列包装器
 */
class AsyncQueue<T> {
  private items: T[] = []
  private resolveWait: ((value: T) => void) | null = null

  async push(item: T): Promise<void> {
    if (this.resolveWait) {
      const resolve = this.resolveWait
      this.resolveWait = null
      resolve(item)
    } else {
      this.items.push(item)
    }
  }

  async pop(): Promise<T> {
    if (this.items.length > 0) {
      return this.items.shift()!
    }
    return new Promise<T>((resolve) => {
      this.resolveWait = resolve
    })
  }

  get size(): number {
    return this.items.length
  }
}

/**
 * MessageBus - 双队列模式
 * - inbound: Channel → Agent
 * - outbound: Agent → Channel
 */
export class MessageBus {
  private inbound: AsyncQueue<InboundMessage> = new AsyncQueue()
  private outbound: AsyncQueue<OutboundMessage> = new AsyncQueue()
  private emitter = mitt<BusEvents>()

  // ========== 入站消息（Channel → Agent）==========

  async publishInbound(msg: InboundMessage): Promise<void> {
    await this.inbound.push(msg)
  }

  async consumeInbound(): Promise<InboundMessage> {
    return await this.inbound.pop()
  }

  get inboundSize(): number {
    return this.inbound.size
  }

  // ========== 出站消息（Agent → Channel）==========

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    await this.outbound.push(msg)
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    return await this.outbound.pop()
  }

  get outboundSize(): number {
    return this.outbound.size
  }

  // ========== 事件订阅（用于 Channel 状态等）==========

  on<K extends keyof BusEvents>(event: K, handler: (data: BusEvents[K]) => void): void {
    this.emitter.on(event, handler)
  }

  off<K extends keyof BusEvents>(event: K, handler: (data: BusEvents[K]) => void): void {
    this.emitter.off(event, handler)
  }

  emit<K extends keyof BusEvents>(event: K, data: BusEvents[K]): void {
    this.emitter.emit(event, data)
  }
}

// 单例实例
let busInstance: MessageBus | null = null

/**
 * 获取 MessageBus 单例
 */
export function getBus(): MessageBus {
  if (!busInstance) {
    busInstance = new MessageBus()
  }
  return busInstance
}

// 保持向后兼容的导出
export const bus = getBus()
