import { CronJob } from 'cron'
import { v4 as uuidv4 } from 'uuid'
import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'
import * as fs from 'fs'
import * as path from 'path'

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

export interface CronCallbacks {
  onTrigger?: (sessionId: string, channelId: string, content: string) => void
}

/**
 * Cron service for scheduling reminders and recurring tasks
 */
export class CronService {
  private jobs: Map<string, CronJobDefinition> = new Map()
  private cronJobs: Map<string, CronJob> = new Map()
  private workspace: string
  private callbacks: CronCallbacks
  private storagePath: string
  /** 执行上下文锁，防止 cron 任务执行时递归创建新的 cron 任务 */
  private executingContexts: Set<string> = new Set()

  constructor(workspace: string, callbacks?: CronCallbacks) {
    this.workspace = workspace
    this.callbacks = callbacks || {}
    this.storagePath = path.join(workspace, 'cron-jobs.json')
    this.loadJobs()
  }

  /**
   * 设置执行上下文锁
   * @param jobId - 任务 ID
   * @returns 如果已成功锁定返回 true，否则返回 false（防止重复执行）
   */
  setExecutingContext(jobId: string): boolean {
    if (this.executingContexts.has(jobId)) {
      return false
    }
    this.executingContexts.add(jobId)
    return true
  }

  /**
   * 释放执行上下文锁
   */
  releaseExecutingContext(jobId: string): void {
    this.executingContexts.delete(jobId)
  }

  /**
   * 检查是否在执行上下文中
   */
  isExecutingContext(jobId: string): boolean {
    return this.executingContexts.has(jobId)
  }

  /**
   * Load jobs from storage
   */
  private loadJobs(): void {
    try {
      if (!fs.existsSync(this.storagePath)) {
        log('info', 'No existing cron jobs file found', 'CronService')
        return
      }

      const data = fs.readFileSync(this.storagePath, 'utf-8')
      const jobsData: Array<
        CronJobDefinition & {
          createdAt: string
          lastExecution?: string
          nextExecution?: string
        }
      > = JSON.parse(data)

      for (const jobData of jobsData) {
        const job: CronJobDefinition = {
          ...jobData,
          createdAt: new Date(jobData.createdAt),
          lastExecution: jobData.lastExecution ? new Date(jobData.lastExecution) : undefined,
          nextExecution: jobData.nextExecution ? new Date(jobData.nextExecution) : undefined,
        }

        // Restore job
        this.jobs.set(job.id, job)

        // Recreate cron job if active and not one-time
        if (job.active && job.type !== CronJobType.ONE_TIME) {
          const cronJob = this.createCronJobFromExisting(job)
          this.cronJobs.set(job.id, cronJob)
        }

        log('info', `Restored cron job: ${job.id}`, 'CronService')
      }

      log('success', `Loaded ${jobsData.length} cron job(s) from storage`, 'CronService')
    } catch (error) {
      logError(
        error instanceof Error
          ? new RoxyError(ErrorCode.SYSTEM_ERROR, 'Failed to load cron jobs', error)
          : new RoxyError(ErrorCode.SYSTEM_ERROR, 'Failed to load cron jobs'),
        'error',
        'CronService',
      )
    }
  }

  /**
   * Save jobs to storage
   */
  private saveJobs(): void {
    try {
      const jobsData = Array.from(this.jobs.values()).map((job) => ({
        ...job,
        createdAt: job.createdAt.toISOString(),
        lastExecution: job.lastExecution?.toISOString(),
        nextExecution: job.nextExecution?.toISOString(),
      }))

      fs.writeFileSync(this.storagePath, JSON.stringify(jobsData, null, 2), 'utf-8')
      log('debug', `Saved ${jobsData.length} cron job(s) to storage`, 'CronService')
    } catch (error) {
      logError(
        error instanceof Error
          ? new RoxyError(ErrorCode.SYSTEM_ERROR, 'Failed to save cron jobs', error)
          : new RoxyError(ErrorCode.SYSTEM_ERROR, 'Failed to save cron jobs'),
        'error',
        'CronService',
      )
    }
  }

  /**
   * Create cron job from existing job definition (for restoration)
   */
  private createCronJobFromExisting(job: CronJobDefinition): CronJob {
    const onTick = async () => {
      try {
        job.executionCount++
        job.lastExecution = new Date()
        this.saveJobs()

        if (this.cronJobs.has(job.id)) {
          const cronJob = this.cronJobs.get(job.id)!
          try {
            const nextDates = cronJob.nextDates?.()
            if (nextDates && nextDates[0]) {
              job.nextExecution =
                typeof nextDates[0].toDate === 'function' ? nextDates[0].toDate() : nextDates[0]
            }
          } catch (_e) {
            // Ignore if nextDates is not available
          }
        }

        if (job.type === CronJobType.REMINDER || job.type === CronJobType.TASK) {
          const prefix = job.type === CronJobType.REMINDER ? '⏰ Reminder: ' : '[Scheduled Task] '
          const content = `${prefix}${job.message}`
          this.callbacks.onTrigger?.(job.sessionId, job.channelId, content)
        }

        if (job.type === CronJobType.ONE_TIME) {
          await this.removeJob(job.id)
        }

        log('success', `Cron job executed: ${job.id}`, 'CronService', {
          executionCount: job.executionCount,
        })
      } catch (error) {
        logError(
          error instanceof Error
            ? new RoxyError(ErrorCode.SYSTEM_ERROR, `Cron job execution failed: ${job.id}`, error)
            : new RoxyError(ErrorCode.SYSTEM_ERROR, `Cron job execution failed: ${job.id}`),
          'error',
          'CronService',
        )
      }
    }

    if (job.at) {
      const fireTime = new Date(job.at)
      return CronJob.from({
        cronTime: fireTime,
        onTick,
        start: true,
        timeZone: job.timezone,
      })
    } else if (job.intervalSeconds) {
      const intervalMs = job.intervalSeconds * 1000
      let intervalId: NodeJS.Timeout = setInterval(onTick, intervalMs)
      let isRunning = true
      return {
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
      } as any
    } else if (job.cronExpr) {
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

    // Persist to storage
    this.saveJobs()

    log('info', `Cron job created: ${jobId}`, 'CronService', {
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
              job.nextExecution =
                typeof nextDates[0].toDate === 'function' ? nextDates[0].toDate() : nextDates[0]
            }
          } catch (_e) {
            // Ignore if nextDates is not available
            // eslint-disable-next-line no-unused-vars
          }
        }

        // Execute based on job type - 通过回调触发，而非直接发布事件
        if (job.type === CronJobType.REMINDER || job.type === CronJobType.TASK) {
          const prefix = job.type === CronJobType.REMINDER ? '⏰ Reminder: ' : '[Scheduled Task] '
          const content = `${prefix}${job.message}`

          // 通过回调通知 Gateway 发布事件
          this.callbacks.onTrigger?.(job.sessionId, job.channelId, content)
        }

        // Auto-delete one-time jobs
        if (job.type === CronJobType.ONE_TIME) {
          await this.removeJob(job.id)
        }

        log('success', `Cron job executed: ${job.id}`, 'CronService', {
          executionCount: job.executionCount,
        })
      } catch (error) {
        logError(
          error instanceof Error
            ? new RoxyError(ErrorCode.SYSTEM_ERROR, `Cron job execution failed: ${job.id}`, error)
            : new RoxyError(ErrorCode.SYSTEM_ERROR, `Cron job execution failed: ${job.id}`),
          'error',
          'CronService',
        )
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
      log('warn', `Cron job not found: ${jobId}`, 'CronService')
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

    // Persist to storage
    this.saveJobs()

    log('info', `Cron job removed: ${jobId}`, 'CronService')
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
      log('warn', `Cron job not found: ${jobId}`, 'CronService')
      return false
    }

    const cronJob = this.cronJobs.get(jobId)
    if (cronJob) {
      cronJob.stop()
      job.active = false
      this.saveJobs()
      log('info', `Cron job paused: ${jobId}`, 'CronService')
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
      log('warn', `Cron job not found: ${jobId}`, 'CronService')
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

      this.saveJobs()
      log('info', `Cron job resumed: ${jobId}`, 'CronService')
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

    log('info', 'All cron jobs cleared', 'CronService')
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
    const timezoneMatch = lower.match(
      /\b(vancouver|pacific|pst|pdt|new york|eastern|est|edt|chicago|central|cst|cdt|denver|mountain|mst|mdt|los angeles|san francisco|london|gmt|utc|tokyo|jst|beijing|shanghai)\s+(?:time|timezone)\b/i,
    )
    let timezone: string | undefined

    if (timezoneMatch) {
      const tzName = timezoneMatch[1].toLowerCase()
      // Map common timezone names to IANA format
      const tzMap: Record<string, string> = {
        vancouver: 'America/Vancouver',
        pacific: 'America/Vancouver',
        pst: 'America/Vancouver',
        pdt: 'America/Vancouver',
        'new york': 'America/New_York',
        eastern: 'America/New_York',
        est: 'America/New_York',
        edt: 'America/New_York',
        chicago: 'America/Chicago',
        central: 'America/Chicago',
        cdt: 'America/Chicago',
        denver: 'America/Denver',
        mountain: 'America/Denver',
        mst: 'America/Denver',
        mdt: 'America/Denver',
        'los angeles': 'America/Los_Angeles',
        'san francisco': 'America/Los_Angeles',
        london: 'Europe/London',
        gmt: 'Europe/London',
        utc: 'UTC',
        tokyo: 'Asia/Tokyo',
        jst: 'Asia/Tokyo',
        beijing: 'Asia/Shanghai',
        cst: 'Asia/Shanghai',
        shanghai: 'Asia/Shanghai',
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
