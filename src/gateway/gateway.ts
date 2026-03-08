import { Bus, getBus } from '../bus/instance'
import { SessionManager } from '../session/manager'
import { ToolExecutor } from '../tools/ToolExecutor'
import { AgentLoop } from '../agent/loop'
import { ContextMng } from '../agent/context'
import { providerManager, OllamaProvider, LiteLLMProvider } from '../provider'
import type { AgentConfig } from '../agent/types'
import { AgentRole } from '../agent/types'
import type {
  GatewayConfig,
  GatewayDeps,
  GatewayInput,
  GatewayOutput,
  GatewayEventHandler,
} from './types'
import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'
import { v4 as uuidv4 } from 'uuid'
import { loadConfig, initAll, syncWorkspaceTemplates } from '../config/manager'
import { SubAgentManager } from '../agent/subAgent'
import { CronService } from '../services/CronService'
import { HeartbeatService } from '../services/HeartbeatService'
import { ChannelManager } from '../channels/manager'
import { CLIChannel } from '../channels/cli.channel'
import chalk from 'chalk'

/**
 * Roxy Gateway - 统一服务入口
 *
 * 职责：
 * - 组装所有核心模块
 * - 提供统一的 API 接口
 * - 管理模块生命周期
 */
export class RoxyGateway {
  private readonly bus: Bus
  private readonly sessionManager: SessionManager
  private readonly toolExecutor: ToolExecutor
  private channelManager: ChannelManager | null = null
  private provider: LiteLLMProvider | null = null
  private subAgentManager: SubAgentManager | null = null
  private cronService: CronService | null = null
  private heartbeatService: HeartbeatService | null = null

  private readonly agents: Map<string, AgentLoop> = new Map()

  private readonly config: GatewayConfig
  private _running = false
  private eventHandlers: Map<string, Set<GatewayEventHandler>> = new Map()

  private readonly defaultAgentId = 'main-agent'

  constructor(deps: GatewayDeps) {
    this.config = deps.config
    this.bus = getBus()
    this.sessionManager = new SessionManager(deps.config.sessionDir)
    this.toolExecutor = new ToolExecutor(deps.config.workspace)
    this.channelManager = new ChannelManager(this.bus)
    this.setupEventSubscriptions()
  }

  private setupEventSubscriptions(): void {
    this.bus.on('agent:response', (event) => {
      this.dispatchOutput({
        type: 'response',
        channelId: event.channelId,
        sessionId: event.sessionId,
        data: { content: event.content, toolCalls: event.toolCalls },
      })
    })

    this.bus.on('agent:stream', (event) => {
      this.dispatchOutput({
        type: 'stream',
        channelId: event.channelId,
        sessionId: event.sessionId,
        data: { chunk: event.chunk },
      })
    })

    this.bus.on('agent:tool_call', (event) => {
      this.dispatchOutput({
        type: 'tool_call',
        channelId: event.channelId,
        sessionId: event.sessionId,
        data: { name: event.toolName, args: event.toolArgs, toolCallId: event.toolCallId },
      })
    })

    this.bus.on('agent:tool_result', (event) => {
      this.dispatchOutput({
        type: 'tool_result',
        channelId: event.channelId,
        sessionId: event.sessionId,
        data: { name: event.toolName, result: event.toolResult, toolCallId: event.toolCallId },
      })
    })

    this.bus.on('error', (event) => {
      this.dispatchOutput({
        type: 'error',
        channelId: event.channelId || 'unknown',
        sessionId: event.sessionId,
        data: { error: event.error instanceof Error ? event.error.message : String(event.error) },
      })
    })

    this.bus.on('subagent:start', (event) => {
      this.dispatchOutput({
        type: 'subagent_start',
        channelId: event.parentChannelId,
        sessionId: event.parentSessionId,
        data: {
          taskId: event.taskId,
          label: event.label,
          task: event.task,
        },
      })
    })

    this.bus.on('subagent:complete', (event) => {
      this.dispatchOutput({
        type: 'subagent_complete',
        channelId: event.parentChannelId,
        sessionId: event.parentSessionId,
        data: {
          taskId: event.taskId,
          label: event.label,
          result: event.result,
          success: event.success,
          error: event.error,
        },
      })
    })

    this.bus.on('user:message', async (event) => {
      await this.handleUserMessage(event)
    })

    this.bus.on('cron:trigger', async (event) => {
      await this.handleCronTrigger(event)
    })

    this.bus.on('heartbeat:beat', (event) => {
      this.dispatchOutput({
        type: 'heartbeat',
        channelId: 'system',
        sessionId: 'system',
        data: {
          count: event.count,
          timestamp: event.timestamp,
          uptime: event.uptime,
          interval: event.interval,
        },
      })
    })
  }

  private async handleCronTrigger(event: any): Promise<void> {
    const { channelId, sessionId, content } = event

    try {
      const agentId = this.defaultAgentId
      const taskId = uuidv4()

      log('info', `Cron task triggered: ${content.substring(0, 50)}...`, 'RoxyGateway')

      // 发布任务执行事件，标记为 cron 执行上下文
      this.bus.emit('agent:execute', {
        taskId,
        agentId,
        channelId,
        sessionId,
        content,
        isCronExecution: true,
      })
    } catch (error) {
      logError(
        error instanceof RoxyError
          ? error
          : new RoxyError(
              ErrorCode.SYSTEM_ERROR,
              'Failed to handle cron trigger',
              error instanceof Error ? error : undefined,
            ),
        'error',
        'RoxyGateway',
      )

      this.bus.emit('error', {
        channelId,
        sessionId,
        error,
        timestamp: new Date(),
      })
    }
  }

  private async handleUserMessage(event: any): Promise<void> {
    const { channelId, sessionId, content } = event

    try {
      const agentId = this.defaultAgentId
      const taskId = uuidv4()

      // 发布任务执行事件（使用新的 RunContext 格式）
      this.bus.emit('agent:execute', {
        taskId,
        agentId,
        channelId,
        sessionId,
        content,
      })
    } catch (error) {
      logError(
        error instanceof RoxyError
          ? error
          : new RoxyError(
              ErrorCode.SYSTEM_ERROR,
              'Failed to handle user message',
              error instanceof Error ? error : undefined,
            ),
        'error',
        'RoxyGateway',
      )

      this.bus.emit('error', {
        channelId,
        sessionId,
        error,
        timestamp: new Date(),
      })
    }
  }

  private dispatchOutput(output: GatewayOutput): void {
    const handlers = this.eventHandlers.get(output.channelId)
    if (handlers) {
      for (const handler of handlers) {
        handler(output)
      }
    }
  }

  on(channelId: string, handler: GatewayEventHandler): void {
    if (!this.eventHandlers.has(channelId)) {
      this.eventHandlers.set(channelId, new Set())
    }
    this.eventHandlers.get(channelId)!.add(handler)
  }

  off(channelId: string, handler: GatewayEventHandler): void {
    const handlers = this.eventHandlers.get(channelId)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  async receive(input: GatewayInput): Promise<void> {
    log('debug', `Gateway received message from ${input.channelId}`, 'RoxyGateway')

    this.bus.emit('user:message', {
      channelId: input.channelId,
      sessionId: input.sessionId,
      content: input.content,
      timestamp: new Date(),
    })
  }

  async initialize(): Promise<void> {
    log('info', 'Initializing Roxy Gateway...', 'RoxyGateway')

    // 初始化和同步工作区模板
    await initAll(false)
    await syncWorkspaceTemplates()

    await this.toolExecutor.initialize()

    // 注册所有 Providers
    await this.registerAllProviders()

    // 注册 Channel
    this.registerChannels()

    // 创建 CronService（全局单例，由 Gateway 管理）
    this.cronService = new CronService(this.config.workspace, {
      onTrigger: (sessionId, channelId, content) => {
        this.bus.emit('cron:trigger', {
          sessionId,
          channelId,
          content,
          timestamp: new Date(),
        })
      },
    })

    // 创建 HeartbeatService（需要 provider 和回调）
    // 等 provider 创建后再初始化

    // 注册 CronTool（使用注入的 CronService 实例）
    const { createCronTools } = await import('../tools/CronTool')
    const cronTools = createCronTools(this.cronService, this.bus)
    this.toolExecutor.registerTools([...cronTools])

    await this.registerAllTools()

    // 从 providerManager 获取默认 provider
    const providerConfig = await this.loadProviderConfig()
    this.provider = providerManager.getProvider(providerConfig.providerId)

    // 创建 HeartbeatService（需要 provider 和回调）
    this.heartbeatService = new HeartbeatService(
      this.config.workspace,
      this.provider,
      providerConfig.model,
      {
        onExecute: async (tasks: string) => {
          // 执行任务：发布到事件总线，让 Agent 处理
          return new Promise((resolve) => {
            const taskId = uuidv4()
            const channelId = 'heartbeat'
            const sessionId = 'heartbeat-session'

            // 监听响应
            const handler = (event: any) => {
              if (event.sessionId === sessionId && event.taskId === taskId) {
                this.bus.off('agent:response', handler)
                resolve(event.content)
              }
            }
            this.bus.on('agent:response', handler)

            // 发布任务
            this.bus.emit('agent:execute', {
              taskId,
              agentId: this.defaultAgentId,
              channelId,
              sessionId,
              content: tasks,
            })

            // 超时处理
            setTimeout(
              () => {
                this.bus.off('agent:response', handler)
                resolve('Task execution timeout')
              },
              5 * 60 * 1000,
            )
          })
        },
        onNotify: async (response: string, target) => {
          // 通知结果到指定渠道
          if (target && this.channelManager) {
            try {
              await this.channelManager.sendToChannel(target.channelId, {
                type: 'response',
                channelId: target.channelId,
                sessionId: target.sessionId,
                content: response,
              })
            } catch (error) {
              logError(
                new RoxyError(
                  ErrorCode.CHANNEL_CONNECTION_FAILED,
                  'Failed to deliver heartbeat notification',
                  error instanceof Error ? error : undefined,
                ),
                'warn',
                'HeartbeatService',
              )
            }
          }
        },
      },
      {
        enabled: this.config.heartbeat?.enabled ?? true,
        intervalSeconds: this.config.heartbeat?.interval ?? 1800, // 默认 30 分钟
      },
      {
        sessionManager: this.sessionManager,
        channelManager: this.channelManager || undefined,
      },
    )

    // 创建 SubAgentManager
    this.subAgentManager = new SubAgentManager({
      provider: this.provider,
      bus: this.bus,
      toolExecutor: this.toolExecutor,
      workspace: this.config.workspace,
    })

    // 注册 SpawnTool（需要 SubAgentManager）
    await this.registerSpawnTool()

    await this.createAgent({
      id: this.defaultAgentId,
      role: AgentRole.MAIN,
    })

    // 启动心跳服务
    await this.heartbeatService.start()

    // 显示启动状态
    this.printStartupStatus()

    this._running = true
    log('info', 'Roxy Gateway initialized', 'RoxyGateway')
  }

  /**
   * 注册所有渠道
   */
  private registerChannels(): void {
    if (!this.channelManager) return

    // 注册 CLI 渠道
    this.channelManager.register(
      'cli',
      () => {
        const channel = new CLIChannel('cli:default')
        channel.setInputHandler((content) => {
          this.receive({
            channelId: 'cli',
            sessionId: channel.sessionIdValue || 'cli:default',
            content,
          })
        })
        return channel
      },
      true,
    )

    log('info', 'Channels registered', 'ChannelManager')
  }

  /**
   * 打印启动状态
   */
  private printStartupStatus(): void {
    console.log()
    console.log(chalk.green.bold('✓ Roxy Gateway initialized'))
    console.log()

    // 渠道状态
    if (this.channelManager) {
      const enabledChannels = this.channelManager.enabledChannels
      if (enabledChannels.length > 0) {
        console.log(
          chalk.green('✓') + ` Channels enabled: ${chalk.cyan(enabledChannels.join(', '))}`,
        )
      } else {
        console.log(chalk.yellow('⚠ Warning: No channels enabled'))
      }
    }

    // Cron 状态
    if (this.cronService) {
      const cronStats = this.cronService.getStats()
      if (cronStats.totalJobs > 0) {
        console.log(chalk.green('✓') + ` Cron: ${chalk.cyan(cronStats.totalJobs)} scheduled job(s)`)
      }
    }

    // 心跳状态
    if (this.heartbeatService) {
      const hbCfg = this.config.heartbeat
      const interval = hbCfg?.interval ?? 1800
      const intervalStr = interval >= 60 ? `${(interval / 60).toFixed(0)}min` : `${interval}s`
      const status = this.heartbeatService.isRunning
        ? chalk.green('running')
        : chalk.gray('stopped')
      console.log(chalk.green('✓') + ` Heartbeat: every ${chalk.cyan(intervalStr)} (${status})`)
    }

    console.log()
  }

  /**
   * 一次性注册所有工具
   */
  private async registerAllTools(): Promise<void> {
    const { fileSystemTools } = await import('../tools/FileSystemTools')
    const { commandTools } = await import('../tools/CommandTools')

    // 基础工具
    this.toolExecutor.registerTools([...fileSystemTools, ...commandTools])

    // SpawnTool 需要 SubAgentManager，等创建后再注册
    log('info', `Registered ${this.toolExecutor.getToolCount()} tool(s)`, 'RoxyGateway')
  }

  /**
   * 注册 SpawnTool（需要 SubAgentManager）
   */
  private async registerSpawnTool(): Promise<void> {
    if (!this.subAgentManager) {
      log('warn', 'SubAgentManager not initialized, skipping SpawnTool registration', 'RoxyGateway')
      return
    }

    const { createSpawnTools } = await import('../tools/SpawnTool')
    const spawnTools = createSpawnTools(this.subAgentManager)
    this.toolExecutor.registerTools([...spawnTools])

    log('debug', 'Registered SpawnTool', 'RoxyGateway')
  }

  /**
   * 注册所有 Providers
   */
  private async registerAllProviders(): Promise<void> {
    // 注册内置 Providers
    providerManager.registerProvider('ollama', OllamaProvider)
    providerManager.registerProvider('litellm', LiteLLMProvider)

    // 从配置加载并配置 Providers
    try {
      const config = await loadConfig()
      const providersConfig: Record<string, any> = {}

      // 获取默认 model 对应的 provider
      const defaultModel = config.agents.defaults.model
      const defaultProviderId = defaultModel.split('/')[0]

      // 配置所有在配置文件中定义的 providers
      for (const [providerId, providerCfg] of Object.entries(config.providers)) {
        providersConfig[providerId] = {
          ...providerCfg,
          model: defaultProviderId === providerId ? defaultModel.split('/')[1] : providerCfg.model,
        }
      }

      providerManager.initializeFromConfig(providersConfig)
      log('info', `Providers initialized: ${providerManager.getConfiguredProviders().join(', ')}`, 'RoxyGateway')
    } catch (error) {
      logError(
        new RoxyError(
          ErrorCode.CONFIG_INVALID,
          'Failed to load provider config',
          error instanceof Error ? error : undefined,
        ),
        'error',
        'RoxyGateway',
      )
      throw error
    }
  }

  private async loadProviderConfig(): Promise<{ providerId: string; model: string }> {
    try {
      const config = await loadConfig()
      const providerId = config.agents.defaults.model.split('/')[0]
      const modelName = config.agents.defaults.model.split('/')[1]

      return { providerId, model: modelName }
    } catch (error) {
      logError(
        new RoxyError(
          ErrorCode.CONFIG_ERROR,
          'Failed to load provider config',
          error instanceof Error ? error : undefined,
        ),
        'error',
        'RoxyGateway',
      )
      throw error
    }
  }

  private async createAgent(config: AgentConfig): Promise<AgentLoop> {
    const existing = this.agents.get(config.id)
    if (existing) {
      return existing
    }

    if (!this.provider) {
      throw new RoxyError(ErrorCode.SYSTEM_ERROR, 'Provider not initialized')
    }

    // 从全局配置加载 think 设置
    const globalConfig = await loadConfig()
    const agentConfig: AgentConfig = {
      ...config,
      think: config.think ?? globalConfig.agents.defaults.think ?? false,
    }

    const ctx = new ContextMng(this.config.workspace, true)

    const agent = new AgentLoop({
      config: agentConfig,
      provider: this.provider,
      toolExecutor: this.toolExecutor,
      bus: this.bus,
      context: ctx,
      sessionManager: this.sessionManager,
    })

    this.agents.set(config.id, agent)
    log('debug', `Agent created: ${config.id}`, 'RoxyGateway')
    return agent
  }

  async start(): Promise<void> {
    if (this._running) {
      log('warn', 'Gateway is already running', 'RoxyGateway')
      return
    }

    await this.initialize()
    log('info', 'Roxy Gateway started', 'RoxyGateway')
  }

  async stop(): Promise<void> {
    if (!this._running) {
      return
    }

    log('info', 'Stopping Roxy Gateway...', 'RoxyGateway')

    await this.destroyAllAgents()
    this.eventHandlers.clear()

    // 停止所有渠道
    if (this.channelManager) {
      await this.channelManager.stopAll()
    }

    this._running = false
    log('info', 'Roxy Gateway stopped', 'RoxyGateway')
  }

  private async destroyAllAgents(): Promise<void> {
    for (const agentId of this.agents.keys()) {
      await this.destroyAgent(agentId)
    }

    // 清除 CronService
    if (this.cronService) {
      await this.cronService.clearAll()
      this.cronService = null
    }

    // 停止 HeartbeatService
    if (this.heartbeatService) {
      this.heartbeatService.stop()
      this.heartbeatService = null
    }

    // 清除 ChannelManager
    if (this.channelManager) {
      this.channelManager = null
    }
  }

  private async destroyAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId)
    if (agent) {
      this.agents.delete(agentId)
      log('debug', `Agent destroyed: ${agentId}`, 'RoxyGateway')
      return true
    }
    return false
  }

  get isRunning(): boolean {
    return this._running
  }

  getBus(): Bus {
    return this.bus
  }

  getSessionManager(): SessionManager {
    return this.sessionManager
  }

  getToolExecutor(): ToolExecutor {
    return this.toolExecutor
  }

  getProvider(): LiteLLMProvider | null {
    return this.provider
  }

  getHeartbeatService(): HeartbeatService | null {
    return this.heartbeatService
  }

  getChannelManager(): ChannelManager | null {
    return this.channelManager
  }

  getCronService(): CronService | null {
    return this.cronService
  }
}
