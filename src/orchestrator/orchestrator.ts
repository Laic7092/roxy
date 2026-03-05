import type { EventBus } from '../bus/instance'
import type { AgentFactory } from '../agent/factory'
import type { AgentTeam, AgentTask, DelegationRequest, TeamMember } from '../agent/types'
import { TaskStatus, AgentRole } from '../agent/types'
import { v4 as uuidv4 } from 'uuid'
import { log, logError } from '../utils/error-handler'
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
 * - 接收用户消息，决策使用哪个 Agent 处理
 * - 管理 Agent Teams
 * - 支持 SubAgent 委托
 * - 任务状态跟踪
 */
export class AgentOrchestrator {
  private deps: OrchestratorDeps
  private teams: Map<string, AgentTeam> = new Map()
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

    // 监听 Agent 委托请求
    this.deps.eventBus.on('agent:delegate', async (event) => {
      await this.handleDelegationRequest(event)
    })

    // 监听 Team 广播
    this.deps.eventBus.on('team:broadcast', async (event) => {
      await this.handleTeamBroadcast(event)
    })
  }

  /**
   * 处理用户消息
   */
  private async handleUserMessage(event: any): Promise<void> {
    const { channelId, sessionId, content } = event

    try {
      // 决策：使用哪个 Agent 处理
      const agentId = await this.selectAgent(content)

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
   * 选择 Agent（简单实现：默认使用主 Agent）
   *
   * TODO: 实现智能路由逻辑
   * - 根据内容类型路由（代码问题 → CodeAgent，文档问题 → DocAgent）
   * - 根据负载路由
   * - 根据用户偏好路由
   */
  private async selectAgent(content: string): Promise<string> {
    // TODO: 实现智能路由
    // 现在简单返回默认 Agent
    return this.defaultAgentId
  }

  /**
   * 处理 SubAgent 委托请求
   */
  private async handleDelegationRequest(event: any): Promise<void> {
    const { parentId, parentAgentId, delegation } = event

    try {
      // 创建 SubAgent 任务
      const subTask: AgentTask = {
        id: uuidv4(),
        parentId: delegation.parentId,
        agentId: `sub-${delegation.agentType}`,
        content: delegation.subTask,
        sessionId: event.sessionId,
        channelId: event.channelId,
        status: TaskStatus.PENDING,
        createdAt: new Date(),
      }

      // 保存任务
      this.tasks.set(subTask.id, subTask)

      // 发布任务执行事件
      this.deps.eventBus.publishAgentExecute({ task: subTask })

      log('info', `SubTask ${subTask.id} delegated from ${parentAgentId}`, 'Orchestrator')
    } catch (error) {
      logError(
        error instanceof RoxyError
          ? error
          : new RoxyError(
              ErrorCode.SYSTEM_ERROR,
              'Failed to handle delegation request',
              error instanceof Error ? error : undefined,
            ),
        'error',
        'Orchestrator',
      )
    }
  }

  /**
   * 处理 Team 广播
   */
  private async handleTeamBroadcast(event: any): Promise<void> {
    const { teamId, task, parallel } = event

    const team = this.teams.get(teamId)
    if (!team) {
      logError(
        new RoxyError(ErrorCode.SYSTEM_ERROR, `Team ${teamId} not found`),
        'warn',
        'Orchestrator',
      )
      return
    }

    // 分发给团队成员
    if (parallel) {
      // 并行执行
      await Promise.all(team.members.map((member) => this.broadcastToMember(team, member, task)))
    } else {
      // 串行执行
      for (const member of team.members) {
        await this.broadcastToMember(team, member, task)
      }
    }
  }

  /**
   * 广播给团队成员
   */
  private async broadcastToMember(
    team: AgentTeam,
    member: TeamMember,
    task: string,
  ): Promise<void> {
    const memberTask: AgentTask = {
      id: uuidv4(),
      agentId: member.agentId,
      content: task,
      sessionId: `team-${team.id}`,
      channelId: `team-${team.id}`,
      status: TaskStatus.PENDING,
      createdAt: new Date(),
      context: { teamId: team.id, memberRole: member.role },
    }

    this.tasks.set(memberTask.id, memberTask)
    this.deps.eventBus.publishAgentExecute({ task: memberTask })

    log('info', `Task ${memberTask.id} broadcast to ${member.agentId}`, 'Orchestrator')
  }

  /**
   * 创建 Team
   */
  async createTeam(team: AgentTeam): Promise<void> {
    // 确保 Team Leader 存在
    await this.deps.agentFactory.createAgent({
      id: team.lead,
      role: AgentRole.TEAM_LEAD,
    })

    // 创建团队成员
    for (const member of team.members) {
      await this.deps.agentFactory.createAgent({
        id: member.agentId,
        role: AgentRole.SUB,
        systemPrompt: member.systemPrompt,
      })
    }

    // 保存 Team
    this.teams.set(team.id, team)

    log('info', `Team ${team.name} created with ${team.members.length} members`, 'Orchestrator')
  }

  /**
   * 获取 Team
   */
  getTeam(teamId: string): AgentTeam | undefined {
    return this.teams.get(teamId)
  }

  /**
   * 获取所有 Teams
   */
  getAllTeams(): AgentTeam[] {
    return Array.from(this.teams.values())
  }

  /**
   * 删除 Team
   */
  async deleteTeam(teamId: string): Promise<boolean> {
    const team = this.teams.get(teamId)
    if (team) {
      this.teams.delete(teamId)
      log('info', `Team ${team.name} deleted`, 'Orchestrator')
      return true
    }
    return false
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
    this.teams.clear()
    this.tasks.clear()
  }
}
