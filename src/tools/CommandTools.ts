import { exec } from 'child_process'
import { resolve } from 'path'

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

/**
 * 检查命令是否在黑名单中
 */
function isBlacklistedCommand(command: string): boolean {
  const cmdName = command.trim().split(' ')[0].split('/').pop() || ''
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
 * 执行命令（支持管道、重定向等 shell 特性）
 * @param command 要执行的完整命令字符串
 * @param workspace 工作空间路径
 * @param options 选项
 * @returns 执行结果（字符串）
 */
export async function executeCommand(
  command: string,
  workspace: string,
  options: {
    timeout?: number
    maxBuffer?: number
    env?: Record<string, string>
    shell?: string
    allowBlacklisted?: boolean
  } = {},
): Promise<string> {
  const resolvedWorkspace = resolve(workspace)

  if (isSensitivePath(resolvedWorkspace)) {
    throw new Error(
      `Access denied: Cannot execute commands in sensitive system directory: ${resolvedWorkspace}`,
    )
  }

  if (!options.allowBlacklisted && isBlacklistedCommand(command)) {
    throw new Error(`Command contains blacklisted command: ${command.split(' ')[0]}`)
  }

  const timeout = options.timeout || 30000
  const maxBuffer = options.maxBuffer || 10 * 1024 * 1024
  const shell = options.shell || '/bin/sh'

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
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
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

    const timeoutId = setTimeout(() => {
      if (childProcess.exitCode === null && !childProcess.killed) {
        childProcess.kill('SIGTERM')
        setTimeout(() => {
          if (childProcess.exitCode === null && !childProcess.killed) {
            childProcess.kill('SIGKILL')
          }
        }, 1000)
      }
    }, timeout)

    childProcess.on('exit', () => {
      clearTimeout(timeoutId)
    })
  })

  const output = [stdout, stderr].filter(Boolean).join('\n')
  return output || `Command completed with code ${code}`
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
              maximum: 600000,
            },
            maxBuffer: {
              type: 'number',
              description: 'Max output buffer size in bytes (default: 10485760, 10MB)',
              minimum: 1024,
              maximum: 104857600,
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
