import mitt, { Handler } from 'mitt'
import type { EventMap } from './events'

/**
 * Bus - 纯粹的事件总线
 *
 * 职责：
 * - 只负责事件的发布和订阅
 * - 不处理业务逻辑
 * - 不封装业务方法
 * - 提供类型安全
 */
export class Bus {
  private emitter = mitt<EventMap>()

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.emitter.on(event, handler)
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.emitter.off(event, handler)
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.emitter.emit(event, data)
  }
}

// 单例实例
let busInstance: Bus | null = null

/**
 * 获取 Bus 单例
 */
export function getBus(): Bus {
  if (!busInstance) {
    busInstance = new Bus()
  }
  return busInstance
}

// 默认导出单例
export const bus = getBus()
