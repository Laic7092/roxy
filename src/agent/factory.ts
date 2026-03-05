import type { AgentConfig, AgentRole } from './types'
import type { LiteLLMProvider } from '../provider/llm'
import type { ToolExecutor } from '../tools/ToolExecutor'
import type { EventBus } from '../bus/instance'
import type { SessionManager } from '../session/manager'
import { AgentLoop } from './loop'
import { ContextMng } from './context'
import { v4 as uuidv4 } from 'uuid'

/**
 * Agent 工厂依赖
 */
export interface AgentFactoryDeps {
  eventBus: EventBus
  provider: LiteLLMProvider
  toolExecutor: ToolExecutor
  sessionManager: SessionManager
  workspace: string
}

/**
 * AgentFactory - 创建和管理 Agent 实例
 *
 * 职责：
 * - 根据配置创建 Agent 实例
 * - 管理 Agent 生命周期
 * - 支持 SubAgent 动态创建
 */
export class AgentFactory {
  private agents: Map<string, AgentLoop> = new Map()
  private deps: AgentFactoryDeps

  constructor(deps: AgentFactoryDeps) {
    this.deps = deps
  }

  /**
   * 创建 Agent 实例
   */
  async createAgent(config: AgentConfig): Promise<AgentLoop> {
    // 如果已存在，直接返回
    const existing = this.agents.get(config.id)
    if (existing) {
      return existing
    }

    // 创建 Context
    const ctx = new ContextMng(this.deps.workspace, true)

    // 创建 Agent
    const agent = new AgentLoop({
      config,
      provider: this.deps.provider,
      toolExecutor: this.deps.toolExecutor,
      eventBus: this.deps.eventBus,
      context: ctx,
      sessionManager: this.deps.sessionManager,
    })

    // 保存引用
    this.agents.set(config.id, agent)

    return agent
  }

  /**
   * 创建 SubAgent
   *
   * @param parentId 父 Agent ID
   * @param specialty SubAgent 专长类型
   * @param systemPrompt 专用系统提示词（可选）
   */
  async createSubAgent(
    parentId: string,
    specialty: string,
    systemPrompt?: string,
  ): Promise<AgentLoop> {
    const subAgentId = `sub-${specialty}-${uuidv4().slice(0, 8)}`

    const config: AgentConfig = {
      id: subAgentId,
      role: AgentRole.SUB,
      systemPrompt,
    }

    return this.createAgent(config)
  }

  /**
   * 获取已存在的 Agent
   */
  getAgent(agentId: string): AgentLoop | undefined {
    return this.agents.get(agentId)
  }

  /**
   * 获取所有 Agent
   */
  getAllAgents(): Map<string, AgentLoop> {
    return new Map(this.agents)
  }

  /**
   * 销毁 Agent
   */
  async destroyAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId)
    if (agent) {
      // 取消事件订阅
      // TODO: 清理事件订阅

      // 从 Map 中移除
      this.agents.delete(agentId)
      return true
    }
    return false
  }

  /**
   * 销毁所有 Agent
   */
  async destroyAllAgents(): Promise<void> {
    for (const agentId of this.agents.keys()) {
      await this.destroyAgent(agentId)
    }
  }
}
