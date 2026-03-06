import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CronService, CronJobType } from '../src/cron/CronService'
import { EventBus } from '../src/bus/instance'

describe('CronService', () => {
  let cronService: CronService
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    cronService = new CronService('test-workspace', eventBus)
  })

  afterEach(async () => {
    await cronService.clearAll()
  })

  it('should create a cron job with interval', async () => {
    const job = await cronService.addJob('Test reminder', 'test-session', 'test-channel', {
      intervalSeconds: 60,
      type: CronJobType.REMINDER,
    })

    expect(job.id).toBeDefined()
    expect(job.type).toBe(CronJobType.REMINDER)
    expect(job.message).toBe('Test reminder')
    expect(job.intervalSeconds).toBe(60)
    expect(job.active).toBe(true)
  })

  it('should create a cron job with cron expression', async () => {
    const job = await cronService.addJob('Daily standup', 'test-session', 'test-channel', {
      cronExpr: '0 9 * * *',
      type: CronJobType.TASK,
      timezone: 'America/Vancouver',
    })

    expect(job.id).toBeDefined()
    expect(job.type).toBe(CronJobType.TASK)
    expect(job.cronExpr).toBe('0 9 * * *')
    expect(job.timezone).toBe('America/Vancouver')
  })

  it('should list jobs', async () => {
    await cronService.addJob('Job 1', 'session-1', 'channel-1', { intervalSeconds: 60 })
    await cronService.addJob('Job 2', 'session-2', 'channel-2', { intervalSeconds: 120 })

    const allJobs = await cronService.listJobs()
    expect(allJobs.length).toBe(2)

    const session1Jobs = await cronService.listJobs('session-1')
    expect(session1Jobs.length).toBe(1)
    expect(session1Jobs[0].message).toBe('Job 1')
  })

  it('should remove a job', async () => {
    const job = await cronService.addJob('Test', 'session', 'channel', { intervalSeconds: 60 })
    const removed = await cronService.removeJob(job.id)

    expect(removed).toBe(true)
    const jobs = await cronService.listJobs()
    expect(jobs.length).toBe(0)
  })

  it('should pause and resume a job', async () => {
    const job = await cronService.addJob('Test', 'session', 'channel', { intervalSeconds: 60 })

    // Pause
    const paused = await cronService.pauseJob(job.id)
    expect(paused).toBe(true)
    expect(job.active).toBe(false)

    // Resume
    const resumed = await cronService.resumeJob(job.id)
    expect(resumed).toBe(true)
    expect(job.active).toBe(true)
  })

  it('should get stats', async () => {
    await cronService.addJob('Reminder', 'session', 'channel', {
      intervalSeconds: 60,
      type: CronJobType.REMINDER,
    })
    await cronService.addJob('Task', 'session', 'channel', {
      intervalSeconds: 120,
      type: CronJobType.TASK,
    })

    const stats = cronService.getStats()
    expect(stats.totalJobs).toBe(2)
    expect(stats.activeJobs).toBe(2)
    expect(stats.byType[CronJobType.REMINDER]).toBe(1)
    expect(stats.byType[CronJobType.TASK]).toBe(1)
  })

  it('should parse interval strings', () => {
    expect(CronService.parseInterval('20 seconds')).toBe(20)
    expect(CronService.parseInterval('5 minutes')).toBe(300)
    expect(CronService.parseInterval('2 hours')).toBe(7200)
    expect(CronService.parseInterval('1 day')).toBe(86400)
    expect(CronService.parseInterval('1 week')).toBe(604800)
  })

  it('should parse time expressions', () => {
    const result1 = CronService.parseTimeExpression('every day at 8am')
    expect(result1.cronExpr).toBe('0 8 * * *')

    const result2 = CronService.parseTimeExpression('weekdays at 5pm')
    expect(result2.cronExpr).toBe('0 17 * * 1-5')

    const result3 = CronService.parseTimeExpression('9am Vancouver time daily')
    expect(result3.cronExpr).toBe('0 9 * * *')
    expect(result3.timezone).toBe('America/Vancouver')
  })
})
