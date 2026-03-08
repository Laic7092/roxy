import { CronService, CronJobType } from '../services/CronService'
import type { Bus } from '../bus/instance'

/**
 * 创建 CronTool（工厂函数）
 */
export function createCronTools(cronService: CronService, _bus: Bus) {
  return [
    {
      name: 'cron',
      description:
        'Schedule reminders and recurring tasks. Supports three modes: reminder, task, and one-time.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Action: "add", "list", "remove", "pause", "resume"',
            enum: ['add', 'list', 'remove', 'pause', 'resume'],
          },
          message: {
            type: 'string',
            description: 'Message content (required for "add")',
          },
          everySeconds: {
            type: 'number',
            description: 'Interval in seconds',
            minimum: 1,
          },
          cronExpr: {
            type: 'string',
            description: 'Cron expression',
          },
          at: {
            type: 'string',
            description: 'ISO datetime for one-time execution',
          },
          tz: {
            type: 'string',
            description: 'Timezone (IANA format)',
          },
          jobId: {
            type: 'string',
            description: 'Job ID for remove/pause/resume',
          },
          type: {
            type: 'string',
            description: 'Job type: "reminder", "task", or "one_time"',
            enum: ['reminder', 'task', 'one_time'],
          },
        },
        required: ['action'],
      },
      execute: async (
        args: {
          action?: string
          message?: string
          everySeconds?: number
          cronExpr?: string
          at?: string
          tz?: string
          jobId?: string
          type?: string
        },
        _workspace: string,
        context?: { channelId: string; sessionId: string; isCronExecution?: boolean },
      ): Promise<string> => {
        const action = args.action?.toLowerCase() || 'add'
        const sessionId = context?.sessionId || 'unknown'
        const channelId = context?.channelId || 'unknown'
        const isCronExecution = context?.isCronExecution ?? false

        if (isCronExecution && action === 'add') {
          throw new Error('Cannot schedule new cron jobs during cron task execution')
        }

        switch (action) {
          case 'add': {
            if (!args.message) {
              throw new Error('Message is required for adding a job')
            }
            if (!args.everySeconds && !args.cronExpr && !args.at) {
              throw new Error('Must provide either everySeconds, cronExpr, or at')
            }

            const jobType = parseJobType(args.message, args.type)
            const job = await cronService.addJob(args.message, sessionId, channelId, {
              type: jobType,
              cronExpr: args.cronExpr,
              intervalSeconds: args.everySeconds,
              at: args.at,
              timezone: args.tz,
            })

            return `Scheduled ${job.type}: "${truncate(args.message, 50)}" (ID: ${job.id}, next: ${job.nextExecution?.toISOString()})`
          }

          case 'list': {
            const jobs = await cronService.listJobs()
            if (jobs.length === 0) {
              return 'No scheduled jobs'
            }
            return jobs
              .map(
                (job) =>
                  `[${job.id}] ${job.type}: "${truncate(job.message, 50)}" | active: ${job.active} | next: ${job.nextExecution?.toISOString() || 'N/A'}`,
              )
              .join('\n')
          }

          case 'remove': {
            if (!args.jobId) {
              throw new Error('jobId is required for removal')
            }
            const removed = await cronService.removeJob(args.jobId)
            if (!removed) {
              throw new Error(`Job ${args.jobId} not found`)
            }
            return `Job ${args.jobId} removed`
          }

          case 'pause': {
            if (!args.jobId) {
              throw new Error('jobId is required for pausing')
            }
            const paused = await cronService.pauseJob(args.jobId)
            if (!paused) {
              throw new Error(`Job ${args.jobId} not found`)
            }
            return `Job ${args.jobId} paused`
          }

          case 'resume': {
            if (!args.jobId) {
              throw new Error('jobId is required for resuming')
            }
            const resumed = await cronService.resumeJob(args.jobId)
            if (!resumed) {
              throw new Error(`Job ${args.jobId} not found`)
            }
            return `Job ${args.jobId} resumed`
          }

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      },
    },
  ]
}

function parseJobType(message: string, type?: string): CronJobType {
  if (type) {
    const t = type.toLowerCase()
    if (t === 'task') return CronJobType.TASK
    if (t === 'one_time' || t === 'onetime') return CronJobType.ONE_TIME
    if (t === 'reminder') return CronJobType.REMINDER
  }

  const lower = message.toLowerCase()
  if (lower.startsWith('remind') || lower.includes('reminder')) {
    return CronJobType.REMINDER
  }
  if (lower.includes('task') || lower.includes('check') || lower.includes('report')) {
    return CronJobType.TASK
  }
  return CronJobType.REMINDER
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '...' : str
}

export type { CronService }
