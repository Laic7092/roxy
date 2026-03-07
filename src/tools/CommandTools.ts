import { exec } from 'child_process'
import { resolve } from 'path'
import { access, appendFile, constants } from 'fs/promises'

// 命令黑名单（防止危险命令）
const COMMAND_BLACKLIST = [
  'rm',
  'rmdir',
  'del',
  'rd',
  'format',
  'fdisk',
  'mkfs',
  'dd',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'kill',
  'pkill',
  'killall',
  'sudo',
  'su',
  'chmod',
  'chown',
  'chattr',
  'passwd',
  'useradd',
  'userdel',
  'wget',
  'nc',
  'netcat',
  'telnet',
  'ssh',
  'scp',
  'rsync',
  'ftp',
  'sftp',
  'mount',
  'umount',
]

// 日志配置
const LOG_FILE_PATH = './command_logs.txt'

/**
 * 记录命令执行日志
 */
async function logCommandExecution(
  command: string,
  workspace: string,
  success: boolean,
  error?: string,
): Promise<void> {
  const timestamp = new Date().toISOString()
  const logEntry = `[${timestamp}] Command: "${command}" | Workspace: "${workspace}" | Success: ${success}${error ? ` | Error: ${error}` : ''}\n`

  try {
    await appendFile(LOG_FILE_PATH, logEntry, { encoding: 'utf8' })
  } catch (logError) {
    // 日志写入失败时不抛出错误，避免影响主流程
    // eslint-disable-next-line no-console
    console.error('Failed to write command log:', logError)
  }
}

/**
 * 检查命令是否在黑名单中
 */
function isBlacklistedCommand(command: string): boolean {
  const cmdName = command.trim().split(' ')[0].split('/').pop() || '' // 提取命令名称，处理路径
  return COMMAND_BLACKLIST.includes(cmdName)
}

/**
 * 检查路径是否指向敏感系统目录
 */
function isSensitivePath(path: string): boolean {
  const sensitivePaths = [
    '/etc',
    '/var',
    '/usr',
    '/root',
    '/proc',
    '/sys',
    '/boot',
    '/dev',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/opt',
    '/media',
    '/mnt',
  ]

  const normalizedPath = path.toLowerCase()
  return sensitivePaths.some(
    (sensitive) =>
      normalizedPath === sensitive ||
      normalizedPath.startsWith(sensitive + '/') ||
      normalizedPath.startsWith(sensitive + '\\'),
  )
}

/**
 * 执行命令（支持管道、重定向等shell特性）
 * @param command 要执行的完整命令字符串
 * @param workspace 工作空间路径
 * @param options 选项，如超时时间等
 * @returns 执行结果
 */
export async function executeCommand(
  command: string,
  workspace: string,
  options: {
    timeout?: number // 超时时间（毫秒）
    maxBuffer?: number // 最大缓冲区大小（字节）
    env?: Record<string, string> // 额外的环境变量
    shell?: string // 使用的shell，默认 /bin/sh
    allowBlacklisted?: boolean // 是否允许黑名单命令（谨慎使用）
  } = {},
): Promise<{
  success: boolean
  stdout?: string
  stderr?: string
  code?: number
  error?: string
  signal?: string
}> {
  try {
    // 1. 验证工作空间路径
    const resolvedWorkspace = resolve(workspace)

    // 2. 检查敏感目录
    if (isSensitivePath(resolvedWorkspace)) {
      const errorMsg = `Access denied: Cannot execute commands in sensitive system directory: ${resolvedWorkspace}`
      await logCommandExecution(command, workspace, false, errorMsg)
      return { success: false, error: errorMsg, code: 403 }
    }

    // 3. 检查工作空间是否存在
    try {
      await access(resolvedWorkspace, constants.F_OK)
    } catch {
      const errorMsg = `Workspace does not exist: ${resolvedWorkspace}`
      await logCommandExecution(command, workspace, false, errorMsg)
      return { success: false, error: errorMsg, code: 404 }
    }

    // 4. 黑名单检查（除非显式允许）
    if (!options.allowBlacklisted && isBlacklistedCommand(command)) {
      const errorMsg = `Command contains blacklisted command: ${command.split(' ')[0]}`
      await logCommandExecution(command, workspace, false, errorMsg)
      return { success: false, error: errorMsg, code: 403 }
    }

    // 5. 设置默认值
    const timeout = options.timeout || 30000 // 默认30秒
    const maxBuffer = options.maxBuffer || 10 * 1024 * 1024 // 默认10MB
    const shell = options.shell || '/bin/sh'

    // 6. 执行命令
    const { stdout, stderr, code, signal } = await new Promise<{
      stdout: string
      stderr: string
      code: number | null
      signal: NodeJS.Signals | null
    }>((resolve, reject) => {
      const childProcess = exec(
        command,
        {
          cwd: resolvedWorkspace,
          env: {
            ...process.env,
            PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
            ...options.env,
          },
          shell,
          timeout,
          maxBuffer,
          windowsHide: true, // Windows下隐藏子进程窗口
        },
        (error, stdout, stderr) => {
          if (error) {
            // 将错误信息与stderr合并
            reject({
              error,
              stdout,
              stderr: stderr || error.message,
              code:
                typeof error.code === 'number'
                  ? error.code
                  : error.code
                    ? parseInt(error.code as string)
                    : null,
              signal: error.signal as NodeJS.Signals | null,
            })
          } else {
            resolve({ stdout, stderr, code: 0, signal: null })
          }
        },
      )

      // 额外的超时保护
      const timeoutId = setTimeout(() => {
        if (childProcess.exitCode === null && !childProcess.killed) {
          childProcess.kill('SIGTERM')
          // 1秒后如果还没退出，强制杀死
          setTimeout(() => {
            if (childProcess.exitCode === null && !childProcess.killed) {
              childProcess.kill('SIGKILL')
            }
          }, 1000)
        }
      }, timeout)

      // 清理超时定时器
      childProcess.on('exit', () => {
        clearTimeout(timeoutId)
      })
    })

    // 7. 记录成功日志
    await logCommandExecution(command, workspace, true)

    return {
      success: code === 0,
      stdout,
      stderr,
      code: code || undefined,
      signal: signal || undefined,
    }
  } catch (error: any) {
    // 8. 处理错误
    const errorMessage = error.message || String(error)
    const errorCode = error.code
    const errorSignal = error.signal

    await logCommandExecution(command, workspace, false, errorMessage)

    return {
      success: false,
      stdout: error.stdout,
      stderr: error.stderr || errorMessage,
      error: errorMessage,
      code: errorCode,
      signal: errorSignal,
    }
  }
}

// 导出工具定义
export const commandTools = [
  {
    name: 'executeCommand',
    description:
      'Execute a command in the workspace with full shell support (pipes, redirections, variables)',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'Command to execute (can include pipes, redirections, environment variables)',
          examples: [
            'ls -la',
            'cat file.txt | grep "pattern"',
            'echo $PATH',
            'npm install && npm run build',
          ],
        },
        options: {
          type: 'object',
          properties: {
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 30000, 0 for no timeout)',
              minimum: 0,
              maximum: 600000, // 10分钟最大
            },
            maxBuffer: {
              type: 'number',
              description: 'Max output buffer size in bytes (default: 10485760, 10MB)',
              minimum: 1024,
              maximum: 104857600, // 100MB最大
            },
            env: {
              type: 'object',
              description: 'Additional environment variables',
              additionalProperties: { type: 'string' },
            },
            allowBlacklisted: {
              type: 'boolean',
              description: 'Allow potentially dangerous commands (use with caution)',
              default: false,
            },
          },
          description: 'Execution options',
        },
      },
      required: ['command'],
    },
    execute: async (
      args: {
        command: string
        options?: {
          timeout?: number
          maxBuffer?: number
          env?: Record<string, string>
          allowBlacklisted?: boolean
        }
      },
      workspace: string,
    ) => {
      return await executeCommand(args.command, workspace, args.options || {})
    },
  },
]
