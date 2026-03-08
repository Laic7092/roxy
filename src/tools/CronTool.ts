import { CronService, CronJobType, type CronCallbacks } from '../cron/CronService'
import type { Bus } from '../bus/instance'

/**
 * 创建 CronTool（工厂函数）
 * 
 * @param cronService - CronService 实例（由 Gateway 注入）
 * @param bus - 事件总线（用于回调）
 */
export function createCronTools(cronService: CronService, bus: Bus) {
  return [
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
            description: 'Message content for the reminder or task (required for "add" action)',
          },
          everySeconds: {
            type: 'number',
            description: 'Interval in seconds (e.g., 600 for every 10 minutes)',
            minimum: 1,
          },
          cronExpr: {
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
          jobId: {
            type: 'string',
            description: 'Job ID for remove/pause/resume actions (required for those actions)',
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
          everySeconds?: number
          cronExpr?: string
          at?: string
          tz?: string
          jobId?: string
          type?: string
        },
        _workspace: string,
        context?: { channelId: string; sessionId: string },
      ) => {
        const action = args.action?.toLowerCase() || 'add'

        // 使用执行时的上下文，而非注册时的上下文
        const sessionId = context?.sessionId || 'unknown'
        const channelId = context?.channelId || 'unknown'

        switch (action) {
          case 'add': {
            if (!args.message) {
              return { success: false, error: 'Message is required for adding a job' }
            }

            if (!args.everySeconds && !args.cronExpr && !args.at) {
              return {
                success: false,
                error: 'Must provide either everySeconds, cronExpr, or at',
              }
            }

            const jobType = parseJobType(args.message, args.type)
            const job = await cronService.addJob(args.message, sessionId, channelId, {
              type: jobType,
              cronExpr: args.cronExpr,
              intervalSeconds: args.everySeconds,
              at: args.at,
              timezone: args.tz,
            })

            return {
              success: true,
              jobId: job.id,
              type: job.type,
              nextExecution: job.nextExecution?.toISOString(),
              message: `Scheduled ${job.type}: "${truncate(args.message, 50)}"`,
            }
          }

          case 'list': {
            const jobs = await cronService.listJobs()
            if (jobs.length === 0) {
              return { success: true, message: 'No scheduled jobs' }
            }

            return {
              success: true,
              jobs: jobs.map((job) => ({
                id: job.id,
                type: job.type,
                message: truncate(job.message, 50),
                active: job.active,
                executionCount: job.executionCount,
                lastExecution: job.lastExecution?.toISOString(),
                nextExecution: job.nextExecution?.toISOString(),
                cronExpr: job.cronExpr,
                intervalSeconds: job.intervalSeconds,
                timezone: job.timezone,
              })),
            }
          }

          case 'remove': {
            if (!args.jobId) {
              return { success: false, error: 'jobId is required for removal' }
            }
            const removed = await cronService.removeJob(args.jobId)
            return removed
              ? { success: true, message: `Job ${args.jobId} removed` }
              : { success: false, error: `Job ${args.jobId} not found` }
          }

          case 'pause': {
            if (!args.jobId) {
              return { success: false, error: 'jobId is required for pausing' }
            }
            const paused = await cronService.pauseJob(args.jobId)
            return paused
              ? { success: true, message: `Job ${args.jobId} paused` }
              : { success: false, error: `Job ${args.jobId} not found` }
          }

          case 'resume': {
            if (!args.jobId) {
              return { success: false, error: 'jobId is required for resuming' }
            }
            const resumed = await cronService.resumeJob(args.jobId)
            return resumed
              ? { success: true, message: `Job ${args.jobId} resumed` }
              : { success: false, error: `Job ${args.jobId} not found` }
          }

          default:
            return { success: false, error: `Unknown action: ${action}` }
        }
      },
    },
  ]
}

/**
 * 解析任务类型
 */
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

/**
 * 截断字符串
 */
function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '...' : str
}

/**
 * 导出 CronService 类型供外部使用
 */
export type { CronService }
