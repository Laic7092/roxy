/**
 * Spawn Tool - 创建后台 SubAgent 任务
 */

import type { SubAgentManager } from '../agent/subAgent'

/**
 * 创建 SpawnTool（工厂函数）
 */
export function createSpawnTools(manager: SubAgentManager) {
  return [
    {
      name: 'spawn',
      description:
        'Spawn a subagent to handle a task in the background.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The task for the subagent to complete',
          },
          label: {
            type: 'string',
            description: 'Optional short label for the task',
          },
        },
        required: ['task'],
      },
      execute: async (
        args: { task: string; label?: string },
        _workspace: string,
        context?: { channelId: string; sessionId: string },
      ): Promise<string> => {
        const { task, label } = args
        const sessionId = context?.sessionId || 'unknown'
        const channelId = context?.channelId || 'unknown'
        const result = await manager.spawn(task, label, channelId, sessionId)
        return result
      },
    },
  ]
}
