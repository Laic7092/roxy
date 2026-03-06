import { CronService, CronJobType } from '../cron/CronService'
import { EventBus } from '../bus/instance'

// Global cron service instances per workspace
const cronServices: Map<string, CronService> = new Map()

/**
 * Get or create cron service for workspace
 */
function getCronService(workspace: string, eventBus: EventBus): CronService {
  if (!cronServices.has(workspace)) {
    cronServices.set(workspace, new CronService(workspace, eventBus))
  }
  return cronServices.get(workspace)!
}

/**
 * Parse cron action from arguments
 */
function parseAction(action?: string): string {
  return action?.toLowerCase() || 'add'
}

/**
 * Parse job type from message or explicit type parameter
 */
function parseJobType(message: string, type?: string): CronJobType {
  if (type) {
    const typeLower = type.toLowerCase()
    if (typeLower === 'task') return CronJobType.TASK
    if (typeLower === 'one_time' || typeLower === 'onetime') return CronJobType.ONE_TIME
    if (typeLower === 'reminder') return CronJobType.REMINDER
  }

  // Infer from message content
  const lowerMessage = message.toLowerCase()
  if (lowerMessage.startsWith('remind') || lowerMessage.includes('reminder')) {
    return CronJobType.REMINDER
  }
  if (lowerMessage.includes('task') || lowerMessage.includes('check') || lowerMessage.includes('report')) {
    return CronJobType.TASK
  }
  return CronJobType.REMINDER
}

export const cronTools = [
  {
    name: 'cron',
    description:
      'Schedule reminders and recurring tasks. Supports three modes: reminder (direct message), task (agent executes), and one-time (runs once then deletes). Use cron expressions, intervals, or specific datetimes.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform: "add", "list", "remove", "pause", "resume"',
          enum: ['add', 'list', 'remove', 'pause', 'resume'],
        },
        message: {
          type: 'string',
          description: 'Message content for the reminder or task',
        },
        every_seconds: {
          type: 'number',
          description: 'Interval in seconds (e.g., 600 for every 10 minutes)',
          minimum: 1,
        },
        cron_expr: {
          type: 'string',
          description: 'Cron expression (e.g., "0 8 * * *" for daily at 8am)',
        },
        at: {
          type: 'string',
          description: 'ISO datetime string for one-time execution (e.g., "2025-03-06T14:30:00")',
        },
        tz: {
          type: 'string',
          description: 'Timezone in IANA format (e.g., "America/Vancouver")',
        },
        job_id: {
          type: 'string',
          description: 'Job ID for remove/pause/resume actions',
        },
        type: {
          type: 'string',
          description: 'Job type: "reminder" (default), "task", or "one_time"',
          enum: ['reminder', 'task', 'one_time'],
        },
      },
      required: ['action'],
    },
    execute: async (
      args: {
        action?: string
        message?: string
        every_seconds?: number
        cron_expr?: string
        at?: string
        tz?: string
        job_id?: string
        type?: string
      },
      workspace: string,
    ) => {
      try {
        // Get event bus (need to import dynamically to avoid circular dependency)
        const { getEventBus } = await import('../bus/instance')
        const eventBus = getEventBus()
        const cronService = getCronService(workspace, eventBus)
        const action = parseAction(args.action)

        switch (action) {
          case 'add': {
            if (!args.message) {
              return { success: false, error: 'Message is required for adding a job' }
            }

            // Validate scheduling parameters
            if (!args.every_seconds && !args.cron_expr && !args.at) {
              return {
                success: false,
                error: 'Must provide either every_seconds, cron_expr, or at',
              }
            }

            // Note: We need sessionId and channelId from context
            // For now, use placeholder values (will be overridden by AgentLoop context)
            const job = await cronService.addJob(args.message, 'cli:default', 'cli', {
              type: parseJobType(args.message, args.type),
              cronExpr: args.cron_expr,
              intervalSeconds: args.every_seconds,
              at: args.at,
              timezone: args.tz,
            })

            return {
              success: true,
              result: {
                job_id: job.id,
                type: job.type,
                next_execution: job.nextExecution?.toISOString(),
                message: `Scheduled ${job.type}: "${args.message.substring(0, 50)}${args.message.length > 50 ? '...' : ''}"`,
              },
            }
          }

          case 'list': {
            const jobs = await cronService.listJobs()
            if (jobs.length === 0) {
              return { success: true, result: { jobs: [], message: 'No scheduled jobs' } }
            }

            const jobList = jobs.map((job) => ({
              id: job.id,
              type: job.type,
              message: job.message.substring(0, 50) + (job.message.length > 50 ? '...' : ''),
              active: job.active,
              execution_count: job.executionCount,
              last_execution: job.lastExecution?.toISOString(),
              next_execution: job.nextExecution?.toISOString(),
              cron_expr: job.cronExpr,
              interval_seconds: job.intervalSeconds,
              timezone: job.timezone,
            }))

            return { success: true, result: { jobs: jobList } }
          }

          case 'remove': {
            if (!args.job_id) {
              return { success: false, error: 'job_id is required for removal' }
            }

            const removed = await cronService.removeJob(args.job_id)
            if (removed) {
              return { success: true, result: { message: `Job ${args.job_id} removed` } }
            }
            return { success: false, error: `Job ${args.job_id} not found` }
          }

          case 'pause': {
            if (!args.job_id) {
              return { success: false, error: 'job_id is required for pausing' }
            }

            const paused = await cronService.pauseJob(args.job_id)
            if (paused) {
              return { success: true, result: { message: `Job ${args.job_id} paused` } }
            }
            return { success: false, error: `Job ${args.job_id} not found` }
          }

          case 'resume': {
            if (!args.job_id) {
              return { success: false, error: 'job_id is required for resuming' }
            }

            const resumed = await cronService.resumeJob(args.job_id)
            if (resumed) {
              return { success: true, result: { message: `Job ${args.job_id} resumed` } }
            }
            return { success: false, error: `Job ${args.job_id} not found` }
          }

          default:
            return { success: false, error: `Unknown action: ${action}` }
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  },
]

/**
 * Export cron service for external access
 */
export function getCronServiceForWorkspace(workspace: string): CronService | undefined {
  return cronServices.get(workspace)
}

/**
 * Clear all cron services (for cleanup)
 */
export async function clearAllCronServices(): Promise<void> {
  for (const service of cronServices.values()) {
    await service.clearAll()
  }
  cronServices.clear()
}
