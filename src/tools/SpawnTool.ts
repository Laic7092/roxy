/**
 * Spawn Tool - 创建后台 SubAgent 任务
 *
 * 允许主 Agent spawn 子任务在后台执行
 */

import type { SubAgentManager } from '../agent/subAgent'

// 全局 SubAgentManager 引用（由外部设置）
let subAgentManager: SubAgentManager | null = null

// 全局上下文（由 ToolExecutor 在执行时设置）
let execContext: { channelId?: string; sessionId?: string } | null = null

/**
 * 设置 SubAgentManager 实例
 */
export function setSubAgentManager(manager: SubAgentManager): void {
  subAgentManager = manager
}

/**
 * 设置执行上下文（由 ToolExecutor 调用）
 */
export function setExecContext(context: { channelId?: string; sessionId?: string }): void {
  execContext = context
}

/**
 * 执行 spawn 操作
 */
async function executeSpawn(
  args: { task: string; label?: string },
  workspace: string,
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!subAgentManager) {
    return { success: false, error: 'SubAgentManager not initialized' }
  }

  try {
    const { task, label } = args
    // 使用执行上下文 spawn SubAgent
    const result = await subAgentManager.spawn(
      task,
      label,
      execContext?.channelId,
      execContext?.sessionId,
    )
    return { success: true, message: result }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * 导出工具定义，以便自动注册
 */
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
    execute: executeSpawn,
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
