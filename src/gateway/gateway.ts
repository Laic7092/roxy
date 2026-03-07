import { EventBus } from '../bus/instance'
import { SessionManager } from '../session/manager'
import { ToolExecutor } from '../tools/ToolExecutor'
import { AgentLoop } from '../agent/loop'
import { ContextMng } from '../agent/context'
import { LiteLLMProvider } from '../provider/llm'
import type { AgentConfig, AgentTask } from '../agent/types'
import { TaskStatus, AgentRole } from '../agent/types'
import type { GatewayConfig, GatewayDeps, GatewayInput, GatewayOutput, GatewayEventHandler } from './types'
import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'
import { v4 as uuidv4 } from 'uuid'
import { loadConfig } from '../config/manager'

/**
 * Roxy Gateway - 统一服务入口
 *
 * 职责：
 * - 组装所有核心模块
 * - 提供统一的 API 接口
 * - 管理模块生命周期
 * - 直接管理 Agent（无需 Factory/Orchestrator）
 *
 * 架构原则：
 * - Channel: 只负责 send/receive msg
 * - EventBus: 只负责 inbound/outbound msg (纯粹的事件总线)
 * - AgentLoop: 高内聚低耦合，依赖注入
 * - Gateway: 引入所有模块，作为服务入口
 */
export class RoxyGateway {
  // 核心组件
  private readonly eventBus: EventBus
  private readonly sessionManager: SessionManager
  private readonly toolExecutor: ToolExecutor
  private provider: LiteLLMProvider | null = null

  // Agent 管理
  private readonly agents: Map<string, AgentLoop> = new Map()
  private readonly tasks: Map<string, AgentTask> = new Map()

  // 配置
  private readonly config: GatewayConfig

  // 运行状态
  private _running = false
  private eventHandlers: Map<string, Set<GatewayEventHandler>> = new Map()

  // 默认 Agent ID
  private readonly defaultAgentId = 'main-agent'

  constructor(deps: GatewayDeps) {
    this.config = deps.config

    // 1. 创建 EventBus (纯粹的事件总线)
    this.eventBus = new EventBus()

    // 2. 创建 SessionManager
    this.sessionManager = new SessionManager(deps.config.sessionDir)

    // 3. 创建 ToolExecutor
    this.toolExecutor = new ToolExecutor(deps.config.workspace)

    // 4. 设置事件订阅
    this.setupEventSubscriptions()
  }

  /**
   * 设置事件订阅
   */
  private setupEventSubscriptions(): void {
    // SessionManager 订阅事件实现自动保存
    this.sessionManager.setEventBus(this.eventBus)

    // Gateway 订阅所有输出事件，分发给注册的处理器
    this.eventBus.on('agent:response', (event) => {
      this.dispatchOutput({
        type: 'response',
        channelId: event.channelId,
        sessionId: event.sessionId,
        data: { content: event.content, toolCalls: event.toolCalls },
      })
    })

    this.eventBus.on('agent:stream', (event) => {
      this.dispatchOutput({
        type: 'stream',
        channelId: event.channelId,
        sessionId: event.sessionId,
        data: { chunk: event.chunk },
      })
    })

    this.eventBus.on('agent:tool_call', (event) => {
      this.dispatchOutput({
        type: 'tool_call',
        channelId: event.channelId,
        sessionId: event.sessionId,
        data: { name: event.toolName, args: event.toolArgs, toolCallId: event.toolCallId },
      })
    })

    this.eventBus.on('agent:tool_result', (event) => {
      this.dispatchOutput({
        type: 'tool_result',
        channelId: event.channelId,
        sessionId: event.sessionId,
        data: { name: event.toolName, result: event.toolResult, toolCallId: event.toolCallId },
      })
    })

    this.eventBus.on('error', (event) => {
      this.dispatchOutput({
        type: 'error',
        channelId: event.channelId || 'unknown',
        sessionId: event.sessionId,
        data: { error: event.error instanceof Error ? event.error.message : String(event.error) },
      })
    })

    // 监听 SubAgent 事件
    this.eventBus.on('subagent:start', (event) => {
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

    this.eventBus.on('subagent:complete', (event) => {
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

    // 监听用户消息，路由到 Agent
    this.eventBus.on('user:message', async (event) => {
      await this.handleUserMessage(event)
    })
  }

  /**
   * 处理用户消息
   */
  private async handleUserMessage(event: any): Promise<void> {
    const { channelId, sessionId, content } = event

    try {
      // 路由到默认 Agent
      const agentId = this.defaultAgentId

      // 创建任务
      const task: AgentTask = {
        id: uuidv4(),
        agentId,
        content,
        sessionId,
        channelId,
        status: TaskStatus.PENDING,
        createdAt: new Date(),
      }

      // 保存任务
      this.tasks.set(task.id, task)

      // 动态注册上下文相关工具（CronTool、SpawnTool）
      await this.registerContextualTools(channelId, sessionId)

      // 发布任务执行事件
      this.eventBus.publishAgentExecute({ task })
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

      // 发布错误事件
      this.eventBus.publishError({
        channelId,
        sessionId,
        error,
        timestamp: new Date(),
      })
    }
  }

  /**
   * 分发消息输出到注册的处理器
   */
  private dispatchOutput(output: GatewayOutput): void {
    const handlers = this.eventHandlers.get(output.channelId)
    if (handlers) {
      for (const handler of handlers) {
        handler(output)
      }
    }
  }

  /**
   * 注册事件处理器
   */
  on(channelId: string, handler: GatewayEventHandler): void {
    if (!this.eventHandlers.has(channelId)) {
      this.eventHandlers.set(channelId, new Set())
    }
    this.eventHandlers.get(channelId)!.add(handler)
  }

  /**
   * 注销事件处理器
   */
  off(channelId: string, handler: GatewayEventHandler): void {
    const handlers = this.eventHandlers.get(channelId)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  /**
   * 接收消息 (Channel → Gateway)
   */
  async receive(input: GatewayInput): Promise<void> {
    log('debug', `Gateway received message from ${input.channelId}`, 'RoxyGateway')

    // 发布用户消息事件到 EventBus
    this.eventBus.publishUserMessage({
      channelId: input.channelId,
      sessionId: input.sessionId,
      content: input.content,
    })
  }

  /**
   * 初始化 Gateway（异步）
   */
  async initialize(): Promise<void> {
    log('info', 'Initializing Roxy Gateway...', 'RoxyGateway')

    // 1. 初始化工具执行器
    await this.toolExecutor.initialize()

    // 2. 注册基础工具
    await this.registerBaseTools()

    // 3. 加载配置并创建 Provider
    const providerConfig = await this.loadProviderConfig()
    this.provider = new LiteLLMProvider(providerConfig)

    // 4. 创建默认 Agent
    await this.createAgent({
      id: this.defaultAgentId,
      role: AgentRole.MAIN,
    })

    this._running = true
    log('info', 'Roxy Gateway initialized', 'RoxyGateway')
  }

  /**
   * 注册基础工具（文件系统、命令执行、技能等）
   */
  private async registerBaseTools(): Promise<void> {
    // 导入基础工具
    const { fileSystemTools } = await import('../tools/FileSystemTools')
    const { commandTools } = await import('../tools/CommandTools')
    const { skillTools } = await import('../tools/SkillTools')

    // 注册工具
    this.toolExecutor.registerTools([...fileSystemTools, ...commandTools, ...skillTools])

    log('info', `Registered ${fileSystemTools.length + commandTools.length + skillTools.length} base tool(s)`, 'RoxyGateway')
  }

  /**
   * 注册需要上下文的工具（CronTool、SpawnTool）
   * 这些工具需要在每次处理用户消息时动态注册
   */
  async registerContextualTools(channelId: string, sessionId: string): Promise<void> {
    // 确保 Provider 已初始化
    if (!this.provider) {
      throw new RoxyError(ErrorCode.SYSTEM_ERROR, 'Provider not initialized')
    }

    // 清除旧的上下文工具（保留基础工具）
    // 基础工具：readFile, writeFile, listDir, getWorkspace, executeCommand, load_skill
    const baseTools = ['readFile', 'writeFile', 'listDir', 'getWorkspace', 'executeCommand', 'load_skill']
    for (const toolName of this.toolExecutor.getToolNames()) {
      if (!baseTools.includes(toolName)) {
        this.toolExecutor.unregisterTool(toolName)
      }
    }

    // 导入工具
    const { createCronTools } = await import('../tools/CronTool')
    const { createSpawnTools } = await import('../tools/SpawnTool')
    const { SubAgentManager } = await import('../agent/subAgent')

    // 创建 CronTool（需要 EventBus）
    const cronTools = createCronTools({
      sessionId,
      channelId,
      workspace: this.config.workspace,
      eventBus: this.eventBus,
    })

    // 创建 SubAgentManager 和 SpawnTool
    const subAgentManager = new SubAgentManager({
      provider: this.provider,
      eventBus: this.eventBus,
      sessionManager: this.sessionManager,
      toolExecutor: this.toolExecutor,
      workspace: this.config.workspace,
    })

    const spawnTools = createSpawnTools(subAgentManager, {
      channelId,
      sessionId,
    })

    // 注册工具
    this.toolExecutor.registerTools([...cronTools, ...spawnTools])

    log('debug', `Registered contextual tools for channel ${channelId} (total: ${this.toolExecutor.getToolCount()} tools)`, 'RoxyGateway')
  }

  /**
   * 加载 Provider 配置
   */
  private async loadProviderConfig(): Promise<any> {
    try {
      const config = await loadConfig()
      const providerName = config.agents.defaults.model.split('/')[0]
      const modelName = config.agents.defaults.model.split('/')[1]
      const { apiKey, baseURL } = config.providers[providerName]

      return {
        apiKey,
        baseURL,
        model: modelName,
      }
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

  /**
   * 创建 Agent
   */
  private async createAgent(config: AgentConfig): Promise<AgentLoop> {
    // 如果已存在，直接返回
    const existing = this.agents.get(config.id)
    if (existing) {
      return existing
    }

    // 确保 Provider 已初始化
    if (!this.provider) {
      throw new RoxyError(ErrorCode.SYSTEM_ERROR, 'Provider not initialized. Call initialize() first.')
    }

    // 创建 Context
    const ctx = new ContextMng(this.config.workspace, true)

    // 创建 Agent
    const agent = new AgentLoop({
      config,
      provider: this.provider,
      toolExecutor: this.toolExecutor,
      eventBus: this.eventBus,
      context: ctx,
      sessionManager: this.sessionManager,
    })

    // 保存引用
    this.agents.set(config.id, agent)

    log('debug', `Agent created: ${config.id}`, 'RoxyGateway')
    return agent
  }

  /**
   * 启动 Gateway
   */
  async start(): Promise<void> {
    if (this._running) {
      log('warn', 'Gateway is already running', 'RoxyGateway')
      return
    }

    await this.initialize()
    log('info', 'Roxy Gateway started', 'RoxyGateway')
  }

  /**
   * 停止 Gateway
   */
  async stop(): Promise<void> {
    if (!this._running) {
      return
    }

    log('info', 'Stopping Roxy Gateway...', 'RoxyGateway')

    // 清理所有 Agent
    await this.destroyAllAgents()

    // 清除任务
    this.tasks.clear()

    // 清除事件处理器
    this.eventHandlers.clear()

    this._running = false
    log('info', 'Roxy Gateway stopped', 'RoxyGateway')
  }

  /**
   * 销毁所有 Agent
   */
  private async destroyAllAgents(): Promise<void> {
    for (const agentId of this.agents.keys()) {
      await this.destroyAgent(agentId)
    }

    // 清理 Cron 服务
    try {
      const { clearAllCronServices } = await import('../tools/CronTool')
      await clearAllCronServices()
    } catch (error) {
      log('warn', `Failed to clear cron services: ${error}`, 'RoxyGateway')
    }
  }

  /**
   * 销毁 Agent
   */
  private async destroyAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId)
    if (agent) {
      this.agents.delete(agentId)
      log('debug', `Agent destroyed: ${agentId}`, 'RoxyGateway')
      return true
    }
    return false
  }

  /**
   * 获取运行状态
   */
  get isRunning(): boolean {
    return this._running
  }

  /**
   * 获取 EventBus 实例 (仅供内部使用)
   */
  getEventBus(): EventBus {
    return this.eventBus
  }

  /**
   * 获取 SessionManager 实例 (仅供内部使用)
   */
  getSessionManager(): SessionManager {
    return this.sessionManager
  }

  /**
   * 获取 ToolExecutor 实例 (仅供内部使用)
   */
  getToolExecutor(): ToolExecutor {
    return this.toolExecutor
  }

  /**
   * 获取 Provider 实例 (仅供内部使用)
   */
  getProvider(): LiteLLMProvider | null {
    return this.provider
  }
}
