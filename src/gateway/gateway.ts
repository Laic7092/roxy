import { Bus, getBus } from '../bus/instance'
import { SessionManager } from '../session/manager'
import { ToolExecutor } from '../tools/ToolExecutor'
import { AgentLoop } from '../agent/loop'
import { ContextMng } from '../agent/context'
import { LiteLLMProvider } from '../provider/llm'
import type { AgentConfig } from '../agent/types'
import { AgentRole } from '../agent/types'
import type { GatewayConfig, GatewayDeps, GatewayInput, GatewayOutput, GatewayEventHandler } from './types'
import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'
import { v4 as uuidv4 } from 'uuid'
import { loadConfig } from '../config/manager'
import { SubAgentManager } from '../agent/subAgent'

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
  private provider: LiteLLMProvider | null = null
  private subAgentManager: SubAgentManager | null = null

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
          : new RoxyError(ErrorCode.SYSTEM_ERROR, 'Failed to handle user message', error instanceof Error ? error : undefined),
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

    await this.toolExecutor.initialize()
    await this.registerAllTools()

    const providerConfig = await this.loadProviderConfig()
    this.provider = new LiteLLMProvider(providerConfig)

    // 创建 SubAgentManager
    this.subAgentManager = new SubAgentManager({
      provider: this.provider,
      sessionManager: this.sessionManager,
      toolExecutor: this.toolExecutor,
      workspace: this.config.workspace,
    }, {
      onSubAgentStart: (task) => {
        this.bus.emit('subagent:start', {
          taskId: task.id,
          label: task.label,
          task: task.task,
          parentChannelId: task.parentChannelId,
          parentSessionId: task.parentSessionId,
        })
      },
      onSubAgentComplete: (task, success) => {
        this.bus.emit('subagent:complete', {
          taskId: task.id,
          label: task.label,
          parentChannelId: task.parentChannelId,
          parentSessionId: task.parentSessionId,
          result: task.result || '',
          success,
          error: task.error,
          timestamp: new Date(),
        })
      },
    })

    // 注册 SpawnTool（需要 SubAgentManager）
    await this.registerSpawnTool()

    await this.createAgent({
      id: this.defaultAgentId,
      role: AgentRole.MAIN,
    })

    this._running = true
    log('info', 'Roxy Gateway initialized', 'RoxyGateway')
  }

  /**
   * 一次性注册所有工具
   */
  private async registerAllTools(): Promise<void> {
    const { fileSystemTools } = await import('../tools/FileSystemTools')
    const { commandTools } = await import('../tools/CommandTools')
    const { createCronTools } = await import('../tools/CronTool')

    // 基础工具
    this.toolExecutor.registerTools([...fileSystemTools, ...commandTools])

    // CronTool（全局单例，执行时获取上下文）
    const cronTools = createCronTools(this.config.workspace, this.bus)
    this.toolExecutor.registerTools([...cronTools])

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

  private async loadProviderConfig(): Promise<any> {
    try {
      const config = await loadConfig()
      const providerName = config.agents.defaults.model.split('/')[0]
      const modelName = config.agents.defaults.model.split('/')[1]
      const { apiKey, baseURL } = config.providers[providerName]

      return { apiKey, baseURL, model: modelName }
    } catch (error) {
      logError(
        new RoxyError(ErrorCode.CONFIG_ERROR, 'Failed to load provider config', error instanceof Error ? error : undefined),
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

    const ctx = new ContextMng(this.config.workspace, true)

    const agent = new AgentLoop({
      config,
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

    this._running = false
    log('info', 'Roxy Gateway stopped', 'RoxyGateway')
  }

  private async destroyAllAgents(): Promise<void> {
    for (const agentId of this.agents.keys()) {
      await this.destroyAgent(agentId)
    }

    try {
      const { clearAllCronServices } = await import('../tools/CronTool')
      await clearAllCronServices()
    } catch (error) {
      log('warn', `Failed to clear cron services: ${error}`, 'RoxyGateway')
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
}
