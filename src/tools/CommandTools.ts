import { spawn, exec } from 'child_process';
import { resolve } from 'path';
import { access, constants } from 'fs/promises';
import { createWriteStream, appendFileSync } from 'fs';

// 命令白名单（暂不启用）
const COMMAND_WHITELIST = [
  'ls', 'cat', 'grep', 'find', 'wc', 'head', 'tail', 'sort', 'uniq',
  'echo', 'pwd', 'whoami', 'date', 'ps', 'top', 'df', 'du', 'free',
  'netstat', 'ifconfig', 'ping', 'traceroute', 'nslookup', 'dig',
  'git', 'npm', 'yarn', 'node', 'python', 'python3', 'java', 'javac'
];

// 日志配置
const LOG_FILE_PATH = './command_logs.txt'; // 可以根据需要调整日志文件路径

/**
 * 记录命令执行日志
 * @param command 执行的命令
 * @param workspace 工作空间
 * @param success 是否成功
 * @param error 错误信息（如果有）
 */
function logCommandExecution(
  command: string,
  workspace: string,
  success: boolean,
  error?: string
): void {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] Command: "${command}" | Workspace: "${workspace}" | Success: ${success}${error ? ` | Error: ${error}` : ''}\n`;
  
  try {
    appendFileSync(LOG_FILE_PATH, logEntry, { encoding: 'utf8' });
  } catch (logError) {
    console.error('Failed to write command log:', logError);
  }
}

/**
 * 执行系统命令
 * @param command 要执行的命令
 * @param args 命令参数
 * @param workspace 工作空间路径
 * @param options 选项，如超时时间等
 * @returns 执行结果
 */
export async function executeCommand(
  command: string,
  args: string[],
  workspace: string,
  options: { timeout?: number; maxBuffer?: number } = {}
): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
  const fullCommand = `${command} ${args.join(' ')}`;
  
  try {
    // 验证路径安全性，防止路径遍历攻击
    const resolvedWorkspace = resolve(workspace);

    // 检查是否尝试访问敏感系统目录
    if (isSensitivePath(resolvedWorkspace)) {
      const errorMsg = 'Access denied: Attempting to execute commands in sensitive system directory';
      logCommandExecution(fullCommand, workspace, false, errorMsg);
      throw new Error(errorMsg);
    }

    // 验证工作空间是否存在
    await access(resolvedWorkspace, constants.F_OK);

    // 暂时不限制命令类型，保留白名单机制的框架
    /*
    // 检查命令是否在白名单中
    const cmdName = command.split(' ')[0]; // 提取命令名称
    if (!COMMAND_WHITELIST.includes(cmdName)) {
      const errorMsg = `Command '${cmdName}' is not allowed`;
      logCommandExecution(fullCommand, workspace, false, errorMsg);
      throw new Error(errorMsg);
    }
    */

    // 设置默认值
    const timeout = options.timeout || 10000; // 默认10秒超时
    const maxBuffer = options.maxBuffer || 1024 * 1024; // 默认1MB最大缓冲区

    // 执行命令
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      // 使用spawn执行命令，更安全地处理参数
      const childProcess = spawn(command, args, {
        cwd: resolvedWorkspace,
        env: {
          ...process.env,
          // 限制环境变量，防止注入
          PATH: process.env.PATH
        },
        timeout,
        maxBuffer
      });

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
        }
      });

      childProcess.on('error', (err) => {
        reject(err);
      });

      // 超时处理
      setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill();
          reject(new Error('Command timed out'));
        }
      }, timeout);
    });

    logCommandExecution(fullCommand, workspace, true);
    return { success: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    logCommandExecution(fullCommand, workspace, false, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 执行简单命令（使用exec，适用于管道和重定向）
 * @param command 要执行的完整命令字符串
 * @param workspace 工作空间路径
 * @param options 选项，如超时时间等
 * @returns 执行结果
 */
export async function executeSimpleCommand(
  command: string,
  workspace: string,
  options: { timeout?: number; maxBuffer?: number } = {}
): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
  try {
    // 验证路径安全性，防止路径遍历攻击
    const resolvedWorkspace = resolve(workspace);

    // 检查是否尝试访问敏感系统目录
    if (isSensitivePath(resolvedWorkspace)) {
      const errorMsg = 'Access denied: Attempting to execute commands in sensitive system directory';
      logCommandExecution(command, workspace, false, errorMsg);
      throw new Error(errorMsg);
    }

    // 验证工作空间是否存在
    await access(resolvedWorkspace, constants.F_OK);

    // 设置默认值
    const timeout = options.timeout || 10000; // 默认10秒超时
    const maxBuffer = options.maxBuffer || 1024 * 1024; // 默认1MB最大缓冲区

    // 执行命令
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const childProcess = exec(command, {
        cwd: resolvedWorkspace,
        env: {
          ...process.env,
          // 限制环境变量，防止注入
          PATH: process.env.PATH
        },
        timeout,
        maxBuffer
      }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });

      // 超时处理
      setTimeout(() => {
        if (childProcess.exitCode === null && !childProcess.killed) {
          childProcess.kill();
          reject(new Error('Command timed out'));
        }
      }, timeout);
    });

    logCommandExecution(command, workspace, true);
    return { success: true, stdout, stderr };
  } catch (error) {
    logCommandExecution(command, workspace, false, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 检查路径是否指向敏感系统目录
 * @param path 路径
 * @returns 是否为敏感路径
 */
function isSensitivePath(path: string): boolean {
  const sensitivePaths = [
    '/etc',
    '/etc/',
    '/var',
    '/var/',
    '/usr',
    '/usr/',
    '/root',
    '/root/',
    '/home/root',
    '/home/root/',
    '/proc',
    '/proc/',
    '/sys',
    '/sys/',
    '/tmp',
    '/tmp/'
  ];

  return sensitivePaths.some(sensitive =>
    path === sensitive || path.startsWith(sensitive + '/')
  );
}

/**
 * 使用示例和说明
 * 
 * 该工具提供了两种执行命令的方式：
 * 1. executeCommand - 使用spawn方法，适合执行单一命令，更安全
 * 2. executeSimpleCommand - 使用exec方法，支持管道和重定向等shell功能
 * 
 * 示例：
 * 
 * // 使用spawn方式执行命令
 * const result1 = await executeCommand('ls', ['-la'], '/path/to/workspace');
 * console.log(result1);
 * 
 * // 使用exec方式执行带管道的命令
 * const result2 = await executeSimpleCommand('cat file.txt | grep keyword', '/path/to/workspace');
 * console.log(result2);
 * 
 * // 执行带自定义选项的命令
 * const result3 = await executeCommand('find', ['.', '-name', '*.ts'], '/path/to/workspace', {
 *   timeout: 5000,      // 5秒超时
 *   maxBuffer: 1048576  // 1MB最大缓冲区
 * });
 * console.log(result3);
 */

// 导出工具定义，以便自动注册
export const commandTools = [
  {
    name: 'executeCommand',
    description: 'Execute a system command in the workspace',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to execute'
        },
        args: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Arguments for the command'
        },
        options: {
          type: 'object',
          properties: {
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 10000)'
            },
            maxBuffer: {
              type: 'number',
              description: 'Max buffer size in bytes (default: 1048576)'
            }
          },
          description: 'Additional options for command execution'
        }
      },
      required: ['command', 'args']
    },
    execute: async (args: { command: string; args: string[]; options?: { timeout?: number; maxBuffer?: number } }, workspace: string) => {
      return await executeCommand(args.command, args.args, workspace, args.options || {});
    }
  },
  {
    name: 'executeSimpleCommand',
    description: 'Execute a simple command with shell features (pipes, redirections) in the workspace',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to execute (can include pipes and redirections)'
        },
        options: {
          type: 'object',
          properties: {
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 10000)'
            },
            maxBuffer: {
              type: 'number',
              description: 'Max buffer size in bytes (default: 1048576)'
            }
          },
          description: 'Additional options for command execution'
        }
      },
      required: ['command']
    },
    execute: async (args: { command: string; options?: { timeout?: number; maxBuffer?: number } }, workspace: string) => {
      return await executeSimpleCommand(args.command, workspace, args.options || {});
    }
  }
];