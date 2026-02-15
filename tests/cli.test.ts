import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'

// 将 spawn 包装成 promise 版本
function runCliCommand(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [`dist/cli/index.mjs`, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code })
    })

    child.on('error', (err) => {
      reject(err)
    })
  })
}

describe('CLI Application', () => {
  it('should display help information', async () => {
    const result = await runCliCommand(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: roxy [options] [command]')
    expect(result.stdout).toContain('onboard')
    expect(result.stdout).toContain('agent')
  })

  it('should handle onboard command', async () => {
    const result = await runCliCommand(['onboard'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Roxy onboarding process')
  })

  it('should handle agent command options', async () => {
    // 使用 --help 选项来测试 agent 命令是否正确加载
    const result = await runCliCommand(['agent', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Start an interactive conversation')
    expect(result.stdout).toContain('--session')
    expect(result.stdout).toContain('--clear')
  })
})
