/**
 * Spawn Tool - 创建后台 SubAgent 任务
 *
 * 允许主 Agent spawn 子任务在后台执行
 */

import type { SubAgentManager } from '../agent/subAgent'

/**
 * 创建 SpawnTool（工厂函数）
 * 工具执行时从上下文中获取 sessionId/channelId
 */
export function createSpawnTools(manager: SubAgentManager) {
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
      execute: async (
        args: { task: string; label?: string },
        _workspace: string,
        context?: { channelId: string; sessionId: string },
      ) => {
        try {
          const { task, label } = args
          const sessionId = context?.sessionId || 'unknown'
          const channelId = context?.channelId || 'unknown'
          const result = await manager.spawn(task, label, channelId, sessionId)
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
