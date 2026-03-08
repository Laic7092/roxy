import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CronService, CronJobType } from '../src/services/CronService'
import * as fs from 'fs'
import * as path from 'path'

describe('CronService', () => {
  let cronService: CronService
  const testWorkspace = path.join(process.cwd(), 'test-workspace')

  beforeEach(() => {
    // Ensure test workspace exists
    if (!fs.existsSync(testWorkspace)) {
      fs.mkdirSync(testWorkspace, { recursive: true })
    }
    cronService = new CronService(testWorkspace, {
      onTrigger: () => {
        // Mock callback for tests
      },
    })
  })

  afterEach(async () => {
    await cronService.clearAll()
    // Clean up test files
    const storagePath = path.join(testWorkspace, 'cron-jobs.json')
    if (fs.existsSync(storagePath)) {
      fs.unlinkSync(storagePath)
    }
    fs.rmdirSync(testWorkspace)
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

    const paused = await cronService.pauseJob(job.id)
    expect(paused).toBe(true)
    expect(job.active).toBe(false)

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

  it('should persist jobs to storage', async () => {
    await cronService.addJob('Persistent job 1', 'session-1', 'channel-1', {
      intervalSeconds: 300,
      type: CronJobType.REMINDER,
    })

    await cronService.addJob('Persistent job 2', 'session-2', 'channel-2', {
      cronExpr: '0 8 * * *',
      type: CronJobType.TASK,
    })

    // Verify storage file exists
    const storagePath = path.join(testWorkspace, 'cron-jobs.json')
    expect(fs.existsSync(storagePath)).toBe(true)

    // Verify file content
    const savedData = JSON.parse(fs.readFileSync(storagePath, 'utf-8'))
    expect(savedData.length).toBe(2)
    expect(savedData[0].message).toBe('Persistent job 1')
    expect(savedData[1].message).toBe('Persistent job 2')
  })

  it('should restore jobs from storage on initialization', async () => {
    // Create first service and add jobs
    const job = await cronService.addJob('Restore test job', 'session-1', 'channel-1', {
      intervalSeconds: 600,
      type: CronJobType.REMINDER,
    })

    const jobId = job.id
    await cronService.clearAll()

    // Create second service - should restore from storage
    const cronService2 = new CronService(testWorkspace, {
      onTrigger: () => {},
    })

    const restoredJobs = await cronService2.listJobs()
    expect(restoredJobs.length).toBe(1)
    expect(restoredJobs[0].id).toBe(jobId)
    expect(restoredJobs[0].message).toBe('Restore test job')
    expect(restoredJobs[0].active).toBe(true)

    await cronService2.clearAll()
  })

  it('should persist job state changes (pause/resume)', async () => {
    const job = await cronService.addJob('State test', 'session', 'channel', {
      intervalSeconds: 60,
    })

    await cronService.pauseJob(job.id)

    // Verify paused state is persisted
    const storagePath = path.join(testWorkspace, 'cron-jobs.json')
    const savedData = JSON.parse(fs.readFileSync(storagePath, 'utf-8'))
    expect(savedData[0].active).toBe(false)

    await cronService.resumeJob(job.id)

    // Verify resumed state is persisted
    const updatedData = JSON.parse(fs.readFileSync(storagePath, 'utf-8'))
    expect(updatedData[0].active).toBe(true)
  })
})
