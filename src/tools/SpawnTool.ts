/**
 * Spawn Tool - 创建后台 SubAgent 任务
 *
 * 允许主 Agent spawn 子任务在后台执行
 */

import type { SubAgentManager } from '../agent/subAgent'

/**
 * SpawnTool 执行上下文
 */
export interface SpawnContext {
  channelId: string
  sessionId: string
}

/**
 * 创建 SpawnTool 实例（工厂函数）
 */
export function createSpawnTools(manager: SubAgentManager, context: SpawnContext) {
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
      execute: async (args: { task: string; label?: string }) => {
        try {
          const { task, label } = args
          const result = await manager.spawn(task, label, context.channelId, context.sessionId)
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
}
