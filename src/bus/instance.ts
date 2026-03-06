import mitt, { Handler } from 'mitt'
import type { EventMap } from './events'

/**
 * EventBus - 事件驱动架构核心
 *
 * 功能：
 * - 发布/订阅模式 - 支持多类型事件
 * - 类型安全 - 使用 TypeScript 泛型
 */
export class EventBus {
  // 事件发射器
  private emitter = mitt<EventMap>()

  // ========== 事件系统 ==========

  /**
   * 订阅事件
   */
  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.emitter.on(event, handler)
  }

  /**
   * 取消订阅
   */
  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.emitter.off(event, handler)
  }

  /**
   * 发布事件
   */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.emitter.emit(event, data)
  }

  /**
   * 发布用户消息事件
   */
  publishUserMessage(data: Omit<EventMap['user:message'], 'timestamp'>): void {
    this.emit('user:message', { ...data, timestamp: new Date() })
  }

  /**
   * 发布 Agent 响应事件
   */
  publishAgentResponse(data: Omit<EventMap['agent:response'], 'timestamp'>): void {
    this.emit('agent:response', { ...data, timestamp: new Date() })
  }

  /**
   * 发布 Agent 流式输出事件
   */
  publishAgentStream(data: Omit<EventMap['agent:stream'], 'timestamp'>): void {
    this.emit('agent:stream', { ...data, timestamp: new Date() })
  }

  /**
   * 发布 Agent 工具调用事件
   */
  publishAgentToolCall(data: Omit<EventMap['agent:tool_call'], 'timestamp'>): void {
    this.emit('agent:tool_call', { ...data, timestamp: new Date() })
  }

  /**
   * 发布 Agent 工具调用结果事件
   */
  publishAgentToolResult(data: Omit<EventMap['agent:tool_result'], 'timestamp'>): void {
    this.emit('agent:tool_result', { ...data, timestamp: new Date() })
  }

  /**
   * 发布 Agent 任务执行事件
   */
  publishAgentExecute(data: EventMap['agent:execute']): void {
    this.emit('agent:execute', data)
  }

  /**
   * 发布 Agent 任务完成事件
   */
  publishAgentTaskComplete(data: Omit<EventMap['agent:task:complete'], 'timestamp'>): void {
    this.emit('agent:task:complete', { ...data, timestamp: new Date() })
  }

  /**
   * 发布 Agent 任务失败事件
   */
  publishAgentTaskFailed(data: Omit<EventMap['agent:task:failed'], 'timestamp'>): void {
    this.emit('agent:task:failed', { ...data, timestamp: new Date() })
  }

  /**
   * 发布 Agent 生成事件
   */
  publishAgentSpawn(data: EventMap['agent:spawn']): void {
    this.emit('agent:spawn', data)
  }

  /**
   * 发布 Agent 委托事件
   */
  publishAgentDelegate(data: EventMap['agent:delegate']): void {
    this.emit('agent:delegate', data)
  }

  /**
   * 发布 SubAgent 任务开始事件
   */
  publishSubAgentStart(data: Omit<EventMap['subagent:start'], 'timestamp'>): void {
    this.emit('subagent:start', { ...data, timestamp: new Date() })
  }

  /**
   * 发布 SubAgent 任务完成事件
   */
  publishSubAgentComplete(data: Omit<EventMap['subagent:complete'], 'timestamp'>): void {
    this.emit('subagent:complete', { ...data, timestamp: new Date() })
  }

  /**
   * 发布会话保存事件
   */
  publishSessionSave(data: EventMap['session:save']): void {
    this.emit('session:save', data)
  }

  /**
   * 发布错误事件
   */
  publishError(data: EventMap['error']): void {
    this.emit('error', data)
  }
}

// 单例实例
let eventBusInstance: EventBus | null = null

/**
 * 获取 EventBus 单例
 */
export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    eventBusInstance = new EventBus()
  }
  return eventBusInstance
}

// 别名导出
export const bus = getEventBus()

// 别名导出
export const eventBus = getEventBus()
