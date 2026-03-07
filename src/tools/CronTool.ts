import { CronService, CronJobType, type CronCallbacks } from '../cron/CronService'
import type { Bus } from '../bus/instance'

/**
 * CronTool 执行上下文
 */
export interface CronContext {
  sessionId: string
  channelId: string
  workspace: string
  bus: Bus
}

/**
 * 创建 CronTool 实例（工厂函数）
 */
export function createCronTools(context: CronContext) {
  // 创建回调：通过 Gateway 发布 user:message 事件
  const callbacks: CronCallbacks = {
    onTrigger: (sessionId, channelId, content) => {
      context.bus.emit('user:message', {
        channelId,
        sessionId,
        content,
        timestamp: new Date(),
      })
    },
  }

  const cronService = new CronService(context.workspace, callbacks)

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
      ) => {
        const action = args.action?.toLowerCase() || 'add'

        switch (action) {
          case 'add': {
            if (!args.message) {
              return { success: false, error: 'Message is required for adding a job' }
            }

            if (!args.every_seconds && !args.cron_expr && !args.at) {
              return {
                success: false,
                error: 'Must provide either every_seconds, cron_expr, or at',
              }
            }

            const jobType = parseJobType(args.message, args.type)
            const job = await cronService.addJob(args.message, context.sessionId, context.channelId, {
              type: jobType,
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
                message: `Scheduled ${job.type}: "${truncate(args.message, 50)}"`,
              },
            }
          }

          case 'list': {
            const jobs = await cronService.listJobs()
            if (jobs.length === 0) {
              return { success: true, result: { jobs: [], message: 'No scheduled jobs' } }
            }

            return {
              success: true,
              result: {
                jobs: jobs.map((job) => ({
                  id: job.id,
                  type: job.type,
                  message: truncate(job.message, 50),
                  active: job.active,
                  execution_count: job.executionCount,
                  last_execution: job.lastExecution?.toISOString(),
                  next_execution: job.nextExecution?.toISOString(),
                  cron_expr: job.cronExpr,
                  interval_seconds: job.intervalSeconds,
                  timezone: job.timezone,
                })),
              },
            }
          }

          case 'remove': {
            if (!args.job_id) {
              return { success: false, error: 'job_id is required for removal' }
            }
            const removed = await cronService.removeJob(args.job_id)
            return removed
              ? { success: true, result: { message: `Job ${args.job_id} removed` } }
              : { success: false, error: `Job ${args.job_id} not found` }
          }

          case 'pause': {
            if (!args.job_id) {
              return { success: false, error: 'job_id is required for pausing' }
            }
            const paused = await cronService.pauseJob(args.job_id)
            return paused
              ? { success: true, result: { message: `Job ${args.job_id} paused` } }
              : { success: false, error: `Job ${args.job_id} not found` }
          }

          case 'resume': {
            if (!args.job_id) {
              return { success: false, error: 'job_id is required for resuming' }
            }
            const resumed = await cronService.resumeJob(args.job_id)
            return resumed
              ? { success: true, result: { message: `Job ${args.job_id} resumed` } }
              : { success: false, error: `Job ${args.job_id} not found` }
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
