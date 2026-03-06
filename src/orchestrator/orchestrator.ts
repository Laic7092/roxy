import type { EventBus } from '../bus/instance'
import type { AgentFactory } from '../agent/factory'
import type { AgentTask } from '../agent/types'
import { TaskStatus, AgentRole } from '../agent/types'
import { v4 as uuidv4 } from 'uuid'
import { logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'

/**
 * AgentOrchestrator 依赖
 */
export interface OrchestratorDeps {
  eventBus: EventBus
  agentFactory: AgentFactory
  sessionManager: SessionManager
}

/**
 * AgentOrchestrator - Agent 编排器
 *
 * 职责：
 * - 接收用户消息，路由到适当的 Agent
 * - 任务状态跟踪
 */
export class AgentOrchestrator {
  private deps: OrchestratorDeps
  private tasks: Map<string, AgentTask> = new Map()

  // 默认 Agent 配置
  private defaultAgentId = 'main-agent'

  constructor(deps: OrchestratorDeps) {
    this.deps = deps

    // 订阅事件
    this.setupEventHandlers()
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers() {
    // 监听用户消息
    this.deps.eventBus.on('user:message', async (event) => {
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

      // 发布任务执行事件
      this.deps.eventBus.publishAgentExecute({ task })
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
        'Orchestrator',
      )

      // 发布错误事件
      this.deps.eventBus.publishError({
        channelId,
        sessionId,
        error,
        timestamp: new Date(),
      })
    }
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId)
  }

  /**
   * 获取会话的所有任务
   */
  getSessionTasks(sessionId: string): AgentTask[] {
    return Array.from(this.tasks.values()).filter((task) => task.sessionId === sessionId)
  }

  /**
   * 初始化默认 Agent
   */
  async initializeDefaultAgent(): Promise<void> {
    await this.deps.agentFactory.createAgent({
      id: this.defaultAgentId,
      role: AgentRole.MAIN,
    })
  }

  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    await this.deps.agentFactory.destroyAllAgents()
    this.tasks.clear()
  }
}
