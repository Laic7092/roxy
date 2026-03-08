import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'
import type { IChannel, ChannelMessage } from './types'
import type { Bus } from '../bus/instance'

/**
 * Channel 工厂函数
 */
export type ChannelFactory = () => IChannel | Promise<IChannel>

/**
 * ChannelManager - 统一管理所有通信渠道
 *
 * 职责：
 * - 注册和管理所有 Channel
 * - 启动/停止所有 Channel
 * - 路由消息到对应 Channel
 * - 提供启用的 Channel 列表
 */
export class ChannelManager {
  private channels: Map<string, IChannel> = new Map()
  private factories: Map<string, ChannelFactory> = new Map()
  private enabledChannelIds: Set<string> = new Set()
  private bus: Bus

  constructor(bus: Bus) {
    this.bus = bus
  }

  /**
   * 注册一个 Channel
   */
  register(id: string, factory: ChannelFactory, enabled = true): void {
    if (this.factories.has(id)) {
      log('warn', `Channel already registered: ${id}`, 'ChannelManager')
      return
    }

    this.factories.set(id, factory)
    if (enabled) {
      this.enabledChannelIds.add(id)
    }

    log('debug', `Channel registered: ${id} (enabled: ${enabled})`, 'ChannelManager')
  }

  /**
   * 获取或创建 Channel
   */
  async getChannel(id: string): Promise<IChannel | null> {
    // 先检查已创建的 Channel
    const existing = this.channels.get(id)
    if (existing) {
      return existing
    }

    // 检查是否启用
    if (!this.enabledChannelIds.has(id)) {
      return null
    }

    // 使用工厂创建
    const factory = this.factories.get(id)
    if (!factory) {
      log('warn', `Channel factory not found: ${id}`, 'ChannelManager')
      return null
    }

    try {
      const channel = await factory()
      this.channels.set(id, channel)
      log('info', `Channel created: ${id}`, 'ChannelManager')
      return channel
    } catch (error) {
      logError(
        new RoxyError(
          ErrorCode.CHANNEL_CONNECTION_FAILED,
          `Failed to create channel: ${id}`,
          error instanceof Error ? error : undefined,
        ),
        'error',
        'ChannelManager',
      )
      return null
    }
  }

  /**
   * 启动所有 Channel
   */
  async startAll(): Promise<void> {
    const enabledIds = Array.from(this.enabledChannelIds)

    for (const id of enabledIds) {
      try {
        const channel = await this.getChannel(id)
        if (channel && !channel.isRunning) {
          await channel.start()
          log('success', `Channel started: ${id}`, 'ChannelManager')
        }
      } catch (error) {
        logError(
          new RoxyError(
            ErrorCode.CHANNEL_CONNECTION_FAILED,
            `Failed to start channel: ${id}`,
            error instanceof Error ? error : undefined,
          ),
          'error',
          'ChannelManager',
        )
      }
    }

    log('info', `Started ${this.channels.size} channel(s)`, 'ChannelManager')
  }

  /**
   * 停止所有 Channel
   */
  async stopAll(): Promise<void> {
    for (const [id, channel] of this.channels.entries()) {
      try {
        if (channel.isRunning) {
          await channel.stop()
          log('info', `Channel stopped: ${id}`, 'ChannelManager')
        }
      } catch (error) {
        logError(
          new RoxyError(
            ErrorCode.CHANNEL_CONNECTION_FAILED,
            `Failed to stop channel: ${id}`,
            error instanceof Error ? error : undefined,
          ),
          'error',
          'ChannelManager',
        )
      }
    }

    this.channels.clear()
    log('info', 'All channels stopped', 'ChannelManager')
  }

  /**
   * 启用 Channel
   */
  async enable(id: string): Promise<boolean> {
    if (this.enabledChannelIds.has(id)) {
      log('warn', `Channel already enabled: ${id}`, 'ChannelManager')
      return false
    }

    this.enabledChannelIds.add(id)
    const channel = await this.getChannel(id)
    if (channel && !channel.isRunning) {
      await channel.start()
      log('success', `Channel enabled and started: ${id}`, 'ChannelManager')
      return true
    }

    return false
  }

  /**
   * 禁用 Channel
   */
  async disable(id: string): Promise<boolean> {
    if (!this.enabledChannelIds.has(id)) {
      return false
    }

    this.enabledChannelIds.delete(id)
    const channel = this.channels.get(id)
    if (channel && channel.isRunning) {
      await channel.stop()
      log('info', `Channel disabled and stopped: ${id}`, 'ChannelManager')
      return true
    }

    return false
  }

  /**
   * 获取所有启用的 Channel ID 列表
   */
  get enabledChannels(): string[] {
    return Array.from(this.enabledChannelIds)
  }

  /**
   * 获取所有已创建的 Channel
   */
  get allChannels(): Map<string, IChannel> {
    return new Map(this.channels)
  }

  /**
   * 发送消息到指定 Channel
   */
  async sendToChannel(channelId: string, message: ChannelMessage): Promise<void> {
    const channel = await this.getChannel(channelId)
    if (!channel) {
      log('warn', `Cannot send to channel: ${id} - channel not found`, 'ChannelManager')
      return
    }

    await channel.receive(message)
  }

  /**
   * 广播消息到所有启用的 Channel
   */
  async broadcast(message: ChannelMessage): Promise<void> {
    const enabledIds = this.enabledChannels

    await Promise.all(
      enabledIds.map(async (id) => {
        try {
          await this.sendToChannel(id, message)
        } catch (error) {
          logError(
            new RoxyError(
              ErrorCode.CHANNEL_CONNECTION_FAILED,
              `Failed to broadcast to channel: ${id}`,
              error instanceof Error ? error : undefined,
            ),
            'warn',
            'ChannelManager',
          )
        }
      }),
    )
  }

  /**
   * 获取 Channel 状态
   */
  getStatus(): {
    totalRegistered: number
    totalEnabled: number
    totalRunning: number
    channels: Array<{
      id: string
      enabled: boolean
      running: boolean
      hasSession: boolean
    }>
  } {
    const channels = []

    for (const [id] of this.factories.entries()) {
      const channel = this.channels.get(id)
      channels.push({
        id,
        enabled: this.enabledChannelIds.has(id),
        running: channel?.isRunning ?? false,
        hasSession: !!channel?.sessionIdValue,
      })
    }

    return {
      totalRegistered: this.factories.size,
      totalEnabled: this.enabledChannelIds.size,
      totalRunning: Array.from(this.channels.values()).filter((c) => c.isRunning).length,
      channels,
    }
  }
}
