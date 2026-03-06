/**
 * Spawn Tool - 创建后台 SubAgent 任务
 *
 * 允许主 Agent spawn 子任务在后台执行
 */

import type { SubAgentManager } from '../agent/subAgent'

// 全局 SubAgentManager 单例（由应用启动时设置）
let subAgentManager: SubAgentManager | null = null

/**
 * 设置 SubAgentManager 单例
 */
export function setSubAgentManager(manager: SubAgentManager): void {
  subAgentManager = manager
}

/**
 * 执行上下文接口
 */
export interface SpawnContext {
  channelId: string
  sessionId: string
}

/**
 * 执行 spawn 操作
 * 通过闭包接收上下文，避免全局状态
 */
function createSpawnExecutor(context: SpawnContext) {
  return async function executeSpawn(
    args: { task: string; label?: string },
    _workspace: string,
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!subAgentManager) {
      return { success: false, error: 'SubAgentManager not initialized' }
    }

    try {
      const { task, label } = args
      const result = await subAgentManager.spawn(
        task,
        label,
        context.channelId,
        context.sessionId,
      )
      return { success: true, message: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}

/**
 * 导出工具定义（使用工厂函数创建带上下文的执行器）
 */
export function createSpawnTools(context: SpawnContext) {
  return [
    {
      name: 'spawn',
      description:
        'Spawn a subagent to handle a task in the background. ' +
        'Use this for complex or time-consuming tasks that can run independently. ' +
        'The subagent will complete the task and report back when done.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The task for the subagent to complete',
          },
          label: {
            type: 'string',
            description: 'Optional short label for the task (for display)',
          },
        },
        required: ['task'],
      },
      execute: createSpawnExecutor(context),
    },
  ]
}

/**
 * 默认工具导出（用于自动注册，但需要配合 setExecContext 使用）
 * @deprecated 使用 createSpawnTools 代替
 */
let currentContext: SpawnContext | null = null

export function setExecContext(context: SpawnContext): void {
  currentContext = context
}

export const spawnTools = [
  {
    name: 'spawn',
    description:
      'Spawn a subagent to handle a task in the background. ' +
      'Use this for complex or time-consuming tasks that can run independently. ' +
      'The subagent will complete the task and report back when done.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task for the subagent to complete',
        },
        label: {
          type: 'string',
          description: 'Optional short label for the task (for display)',
        },
      },
      required: ['task'],
    },
    execute: async (
      args: { task: string; label?: string },
      _workspace: string,
    ): Promise<{ success: boolean; message?: string; error?: string }> => {
      if (!subAgentManager || !currentContext) {
        return { success: false, error: 'SubAgentManager or context not initialized' }
      }
      try {
        const { task, label } = args
        const result = await subAgentManager.spawn(
          task,
          label,
          currentContext.channelId,
          currentContext.sessionId,
        )
        return { success: true, message: result }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    },
  },
]

/**
 * SpawnTool 类（向后兼容）
 */
export class SpawnTool {
  private manager: SubAgentManager
  private channelId: string
  private sessionId: string

  constructor(options: { manager: SubAgentManager; channelId?: string; sessionId?: string }) {
    this.manager = options.manager
    this.channelId = options.channelId || 'cli'
    this.sessionId = options.sessionId || 'cli:default'
  }

  setContext(channelId: string, sessionId: string): void {
    this.channelId = channelId
    this.sessionId = sessionId
  }

  getDefinition(): any {
    return {
      type: 'function',
      function: {
        name: 'spawn_subagent',
        description:
          'Spawn a subagent to handle a task in the background. ' +
          'Use this for complex or time-consuming tasks that can run independently. ' +
          'The subagent will complete the task and report back when done.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The task for the subagent to complete',
            },
            label: {
              type: 'string',
              description: 'Optional short label for the task (for display)',
            },
          },
          required: ['task'],
        },
      },
    }
  }

  async execute(args: { task: string; label?: string }): Promise<string> {
    const { task, label } = args
    return await this.manager.spawn(task, label, this.sessionId, this.channelId)
  }
}
