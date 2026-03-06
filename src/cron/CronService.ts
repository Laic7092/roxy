import { CronJob } from 'cron'
import { v4 as uuidv4 } from 'uuid'
import { EventBus } from '../bus/instance'
import { createLogger, LogLevel } from '../utils/logger'

/**
 * Cron job types
 */
export enum CronJobType {
  /** Reminder - sends message directly to user */
  REMINDER = 'reminder',
  /** Task - agent executes the message as a task */
  TASK = 'task',
  /** One-time - runs once at specific time, then auto-deletes */
  ONE_TIME = 'one_time',
}

/**
 * Cron job definition
 */
export interface CronJobDefinition {
  /** Unique job ID */
  id: string
  /** Job type */
  type: CronJobType
  /** Message/reminder content */
  message: string
  /** Session ID to send the message to */
  sessionId: string
  /** Channel ID for display */
  channelId: string
  /** Cron expression (for recurring jobs) */
  cronExpr?: string
  /** Interval in seconds (alternative to cron expression) */
  intervalSeconds?: number
  /** Specific datetime for one-time jobs (ISO format) */
  at?: string
  /** Timezone (IANA format, e.g., 'America/Vancouver') */
  timezone?: string
  /** Whether the job is active */
  active: boolean
  /** Number of times executed */
  executionCount: number
  /** Last execution time */
  lastExecution?: Date
  /** Next execution time */
  nextExecution?: Date
  /** Created timestamp */
  createdAt: Date
}

/**
 * Cron service for scheduling reminders and recurring tasks
 */
export class CronService {
  private jobs: Map<string, CronJobDefinition> = new Map()
  private cronJobs: Map<string, CronJob> = new Map()
  private eventBus: EventBus
  private logger: ReturnType<typeof createLogger>
  private workspace: string

  constructor(workspace: string, eventBus: EventBus) {
    this.workspace = workspace
    this.eventBus = eventBus
    this.logger = createLogger(workspace, {
      logToConsole: true,
      enabledLevels: [LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.SUCCESS],
    })
  }

  /**
   * Add a new cron job
   */
  async addJob(
    message: string,
    sessionId: string,
    channelId: string,
    options: {
      type?: CronJobType
      cronExpr?: string
      intervalSeconds?: number
      at?: string
      timezone?: string
    } = {},
  ): Promise<CronJobDefinition> {
    const jobId = uuidv4()
    const { type = CronJobType.REMINDER, timezone } = options

    // Validate input
    if (!options.cronExpr && !options.intervalSeconds && !options.at) {
      throw new Error('Must provide either cronExpr, intervalSeconds, or at')
    }

    // Create job definition
    const job: CronJobDefinition = {
      id: jobId,
      type,
      message,
      sessionId,
      channelId,
      cronExpr: options.cronExpr,
      intervalSeconds: options.intervalSeconds,
      at: options.at,
      timezone,
      active: true,
      executionCount: 0,
      createdAt: new Date(),
    }

    // Create and start the cron job
    const cronJob = await this.createCronJob(job)
    this.cronJobs.set(jobId, cronJob)
    this.jobs.set(jobId, job)

    await this.logger.info(`Cron job created: ${jobId}`, {
      type: job.type,
      message: job.message.substring(0, 50),
      cronExpr: job.cronExpr,
      intervalSeconds: job.intervalSeconds,
      at: job.at,
    })

    return job
  }

  /**
   * Create a cron job from definition
   */
  private async createCronJob(job: CronJobDefinition): Promise<CronJob> {
    const onTick = async () => {
      try {
        // Update execution stats
        job.executionCount++
        job.lastExecution = new Date()

        // Update next execution time
        if (this.cronJobs.has(job.id)) {
          const cronJob = this.cronJobs.get(job.id)!
          try {
            const nextDates = cronJob.nextDates?.()
            if (nextDates && nextDates[0]) {
              job.nextExecution = typeof nextDates[0].toDate === 'function' 
                ? nextDates[0].toDate() 
                : nextDates[0]
            }
          } catch (_e) {
            // Ignore if nextDates is not available
          }
        }

        // Execute based on job type
        // Both REMINDER and TASK types publish user:message to trigger proper agent flow
        // This ensures session consistency and proper event handling
        if (job.type === CronJobType.REMINDER || job.type === CronJobType.TASK) {
          const prefix = job.type === CronJobType.REMINDER ? '⏰ Reminder: ' : '[Scheduled Task] '
          this.eventBus.publishUserMessage({
            channelId: job.channelId,
            sessionId: job.sessionId,
            content: `${prefix}${job.message}`,
          })
        }

        // Auto-delete one-time jobs
        if (job.type === CronJobType.ONE_TIME) {
          await this.removeJob(job.id)
        }

        await this.logger.success(`Cron job executed: ${job.id}`, {
          executionCount: job.executionCount,
        })
      } catch (error) {
        await this.logger.error(`Cron job execution failed: ${job.id}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Create cron job based on type
    if (job.at) {
      // One-time job
      const fireTime = new Date(job.at)
      return CronJob.from({
        cronTime: fireTime,
        onTick,
        start: true,
        timeZone: job.timezone,
      })
    } else if (job.intervalSeconds) {
      // Interval-based job - use setInterval
      const intervalMs = job.intervalSeconds * 1000
      let intervalId: NodeJS.Timeout = setInterval(onTick, intervalMs)
      
      // Wrap in CronJob-like interface
      let isRunning = true
      const wrappedJob: any = {
        stop: () => {
          clearInterval(intervalId)
          isRunning = false
        },
        start: () => {
          if (!isRunning) {
            intervalId = setInterval(onTick, intervalMs)
            isRunning = true
          }
        },
        nextDates: () => [new Date(Date.now() + intervalMs)],
      }
      return wrappedJob
    } else if (job.cronExpr) {
      // Cron expression-based job
      return CronJob.from({
        cronTime: job.cronExpr,
        onTick,
        start: true,
        timeZone: job.timezone,
      })
    } else {
      throw new Error('Invalid job configuration')
    }
  }

  /**
   * Remove a cron job
   */
  async removeJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job) {
      await this.logger.warn(`Cron job not found: ${jobId}`)
      return false
    }

    // Stop and remove cron job
    const cronJob = this.cronJobs.get(jobId)
    if (cronJob) {
      cronJob.stop()
      this.cronJobs.delete(jobId)
    }

    // Remove job definition
    this.jobs.delete(jobId)

    await this.logger.info(`Cron job removed: ${jobId}`)
    return true
  }

  /**
   * List all cron jobs
   */
  async listJobs(sessionId?: string): Promise<CronJobDefinition[]> {
    const allJobs = Array.from(this.jobs.values())

    if (sessionId) {
      return allJobs.filter((job) => job.sessionId === sessionId)
    }

    return allJobs
  }

  /**
   * Get a specific cron job
   */
  getJob(jobId: string): CronJobDefinition | undefined {
    return this.jobs.get(jobId)
  }

  /**
   * Pause a cron job
   */
  async pauseJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job) {
      await this.logger.warn(`Cron job not found: ${jobId}`)
      return false
    }

    const cronJob = this.cronJobs.get(jobId)
    if (cronJob) {
      cronJob.stop()
      job.active = false
      await this.logger.info(`Cron job paused: ${jobId}`)
      return true
    }

    return false
  }

  /**
   * Resume a paused cron job
   */
  async resumeJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job) {
      await this.logger.warn(`Cron job not found: ${jobId}`)
      return false
    }

    const cronJob = this.cronJobs.get(jobId)
    if (cronJob) {
      // Try to call start() if it exists
      if (typeof cronJob.start === 'function') {
        cronJob.start()
      }
      job.active = true
      
      // Try to get next execution time if available
      try {
        if (typeof cronJob.nextDates === 'function') {
          const nextDates = cronJob.nextDates()
          if (nextDates && nextDates[0] && typeof nextDates[0].toDate === 'function') {
            job.nextExecution = nextDates[0].toDate()
          } else if (nextDates && nextDates[0]) {
            job.nextExecution = nextDates[0]
          }
        }
      } catch (_e) {
        // Ignore if nextDates is not available
      }
      
      await this.logger.info(`Cron job resumed: ${jobId}`)
      return true
    }

    return false
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalJobs: number
    activeJobs: number
    pausedJobs: number
    byType: Record<CronJobType, number>
  } {
    const allJobs = Array.from(this.jobs.values())
    const byType: Record<CronJobType, number> = {
      [CronJobType.REMINDER]: 0,
      [CronJobType.TASK]: 0,
      [CronJobType.ONE_TIME]: 0,
    }

    for (const job of allJobs) {
      byType[job.type]++
    }

    return {
      totalJobs: allJobs.length,
      activeJobs: allJobs.filter((j) => j.active).length,
      pausedJobs: allJobs.filter((j) => !j.active).length,
      byType,
    }
  }

  /**
   * Clear all jobs (for cleanup)
   */
  async clearAll(): Promise<void> {
    for (const jobId of this.cronJobs.keys()) {
      const cronJob = this.cronJobs.get(jobId)
      if (cronJob) {
        cronJob.stop()
      }
    }

    this.cronJobs.clear()
    this.jobs.clear()

    await this.logger.info('All cron jobs cleared')
  }

  /**
   * Convert human-readable interval to seconds
   */
  static parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)\s*(second|minute|hour|day|week)s?$/i)
    if (!match) {
      throw new Error(`Invalid interval format: ${interval}`)
    }

    const [, value, unit] = match
    const num = parseInt(value, 10)

    switch (unit.toLowerCase()) {
      case 'second':
        return num
      case 'minute':
        return num * 60
      case 'hour':
        return num * 3600
      case 'day':
        return num * 86400
      case 'week':
        return num * 604800
      default:
        throw new Error(`Unknown time unit: ${unit}`)
    }
  }

  /**
   * Convert human-readable time expression to cron expression
   */
  static parseTimeExpression(expression: string): { cronExpr: string; timezone?: string } {
    const lower = expression.toLowerCase()

    // Examples:
    // "every day at 8am" -> "0 8 * * *"
    // "weekdays at 5pm" -> "0 17 * * 1-5"
    // "9am Vancouver time daily" -> "0 9 * * *", timezone: "America/Vancouver"

    // Match timezone patterns like "Vancouver time", "Pacific timezone", "EST time"
    const timezoneMatch = lower.match(/\b(vancouver|pacific|pst|pdt|new york|eastern|est|edt|chicago|central|cst|cdt|denver|mountain|mst|mdt|los angeles|san francisco|london|gmt|utc|tokyo|jst|beijing|shanghai)\s+(?:time|timezone)\b/i)
    let timezone: string | undefined

    if (timezoneMatch) {
      const tzName = timezoneMatch[1].toLowerCase()
      // Map common timezone names to IANA format
      const tzMap: Record<string, string> = {
        'vancouver': 'America/Vancouver',
        'pacific': 'America/Vancouver',
        'pst': 'America/Vancouver',
        'pdt': 'America/Vancouver',
        'new york': 'America/New_York',
        'eastern': 'America/New_York',
        'est': 'America/New_York',
        'edt': 'America/New_York',
        'chicago': 'America/Chicago',
        'central': 'America/Chicago',
        'cdt': 'America/Chicago',
        'denver': 'America/Denver',
        'mountain': 'America/Denver',
        'mst': 'America/Denver',
        'mdt': 'America/Denver',
        'los angeles': 'America/Los_Angeles',
        'san francisco': 'America/Los_Angeles',
        'london': 'Europe/London',
        'gmt': 'Europe/London',
        'utc': 'UTC',
        'tokyo': 'Asia/Tokyo',
        'jst': 'Asia/Tokyo',
        'beijing': 'Asia/Shanghai',
        'cst': 'Asia/Shanghai',
        'shanghai': 'Asia/Shanghai',
      }
      timezone = tzMap[tzName] || tzName
    }

    // Parse time
    const timeMatch = expression.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
    if (!timeMatch) {
      throw new Error(`Could not parse time from: ${expression}`)
    }

    let hour = parseInt(timeMatch[1], 10)
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0
    const ampm = timeMatch[3]?.toLowerCase()

    if (ampm === 'pm' && hour !== 12) {
      hour += 12
    } else if (ampm === 'am' && hour === 12) {
      hour = 0
    }

    // Determine day pattern
    if (lower.includes('weekday')) {
      return { cronExpr: `${minute} ${hour} * * 1-5`, timezone }
    } else if (lower.includes('weekend')) {
      return { cronExpr: `${minute} ${hour} * * 0,6`, timezone }
    } else if (lower.includes('monday')) {
      return { cronExpr: `${minute} ${hour} * * 1`, timezone }
    } else if (lower.includes('tuesday')) {
      return { cronExpr: `${minute} ${hour} * * 2`, timezone }
    } else if (lower.includes('wednesday')) {
      return { cronExpr: `${minute} ${hour} * * 3`, timezone }
    } else if (lower.includes('thursday')) {
      return { cronExpr: `${minute} ${hour} * * 4`, timezone }
    } else if (lower.includes('friday')) {
      return { cronExpr: `${minute} ${hour} * * 5`, timezone }
    } else if (lower.includes('saturday')) {
      return { cronExpr: `${minute} ${hour} * * 6`, timezone }
    } else if (lower.includes('sunday')) {
      return { cronExpr: `${minute} ${hour} * * 0`, timezone }
    } else {
      // Daily
      return { cronExpr: `${minute} ${hour} * * *`, timezone }
    }
  }
}
