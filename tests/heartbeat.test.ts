import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { HeartbeatService } from '../src/services/HeartbeatService'
import { join } from 'path'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

// Mock LLMProvider
class MockProvider {
  chatResult: any = { choices: [{ message: { tool_calls: [] } }] }

  async chat(params: any) {
    return this.chatResult
  }
}

describe('HeartbeatService', () => {
  let heartbeatService: HeartbeatService
  let mockProvider: MockProvider
  let tempWorkspace: string

  beforeEach(() => {
    tempWorkspace = mkdtempSync(join(tmpdir(), 'heartbeat-test-'))
    mockProvider = new MockProvider()
    heartbeatService = new HeartbeatService(
      tempWorkspace,
      mockProvider as any,
      'test-model',
      {},
      { enabled: false }, // 默认不自动启动
    )
  })

  afterEach(() => {
    heartbeatService.stop()
    try {
      rmSync(tempWorkspace, { recursive: true, force: true })
    } catch {}
  })

  it('should create heartbeat service', () => {
    expect(heartbeatService.isRunning).toBe(false)
  })

  it('should start and stop heartbeat service', async () => {
    heartbeatService = new HeartbeatService(
      tempWorkspace,
      mockProvider as any,
      'test-model',
      {},
      { enabled: true, intervalSeconds: 60 },
    )

    await heartbeatService.start()
    expect(heartbeatService.isRunning).toBe(true)

    heartbeatService.stop()
    expect(heartbeatService.isRunning).toBe(false)
  })

  it('should return null when HEARTBEAT.md missing', async () => {
    const result = await heartbeatService.triggerNow()
    expect(result).toBeNull()
  })

  it('should read HEARTBEAT.md content', async () => {
    const heartbeatFile = join(tempWorkspace, 'HEARTBEAT.md')
    writeFileSync(heartbeatFile, '# Active Tasks\n- Task 1\n- Task 2')

    // Mock LLM to return skip
    mockProvider.chatResult = {
      choices: [{ message: { tool_calls: [] } }],
    }

    const result = await heartbeatService.triggerNow()
    expect(result).toBeNull() // skip = null
  })

  it('should execute tasks when LLM returns run', async () => {
    const heartbeatFile = join(tempWorkspace, 'HEARTBEAT.md')
    writeFileSync(heartbeatFile, '# Active Tasks\n- Task 1')

    let executedTasks = ''

    heartbeatService = new HeartbeatService(
      tempWorkspace,
      mockProvider as any,
      'test-model',
      {
        onExecute: async (tasks: string) => {
          executedTasks = tasks
          return 'Task completed'
        },
      },
      { enabled: false },
    )

    // Mock LLM to return run
    mockProvider.chatResult = {
      choices: [{
        message: {
          tool_calls: [{
            function: {
              arguments: JSON.stringify({ action: 'run', tasks: 'Do something' }),
            },
          }],
        },
      }],
    }

    const result = await heartbeatService.triggerNow()
    expect(result).toBe('Task completed')
    expect(executedTasks).toBe('Do something')
  })

  it('should respect enabled flag', async () => {
    heartbeatService = new HeartbeatService(
      tempWorkspace,
      mockProvider as any,
      'test-model',
      {},
      { enabled: false },
    )

    await heartbeatService.start()
    expect(heartbeatService.isRunning).toBe(false) // disabled = not running
  })
})
