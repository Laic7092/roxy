import { promises as fs } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 获取内置技能目录（处理开发和构建两种情况）
const getBuiltinSkillsDir = () => {
  if (__dirname.includes('/dist/') || __dirname.endsWith('/dist')) {
    return join(__dirname, '..', 'src', 'skills')
  }
  return join(__dirname, '..', 'skills')
}

/**
 * 读取文件内容
 * @param filePath 文件路径（相对于 workspace，或 @skill/{name} 访问技能）
 * @param workspace 工作空间路径
 * @returns 文件内容（字符串）
 */
export async function readFile(filePath: string, workspace: string): Promise<string> {
  // 支持特殊前缀 @skill/{name} 访问技能（自动查找内置和 workspace）
  if (filePath.startsWith('@skill/')) {
    const skillName = filePath.replace('@skill/', '')
    const skillPath = join(workspace, 'skills', skillName, 'SKILL.md')
    try {
      return await fs.readFile(skillPath, 'utf-8')
    } catch {
      const builtinDir = getBuiltinSkillsDir()
      const builtinPath = join(builtinDir, skillName, 'SKILL.md')
      return await fs.readFile(builtinPath, 'utf-8')
    }
  }

  const fullPath = resolve(join(workspace, filePath))

  if (isSensitivePath(fullPath)) {
    throw new Error('Access denied: Attempting to access sensitive system directory')
  }

  if (!fullPath.startsWith(resolve(workspace))) {
    throw new Error('Access denied: Path traversal detected')
  }

  return await fs.readFile(fullPath, 'utf-8')
}

/**
 * 写入文件内容
 * @param filePath 文件路径（相对于 workspace）
 * @param content 文件内容
 * @param workspace 工作空间路径
 * @returns 成功消息（字符串）
 */
export async function writeFile(filePath: string, content: string, workspace: string): Promise<string> {
  const fullPath = resolve(join(workspace, filePath))

  if (isSensitivePath(fullPath)) {
    throw new Error('Access denied: Attempting to access sensitive system directory')
  }

  if (!fullPath.startsWith(resolve(workspace))) {
    throw new Error('Access denied: Path traversal detected')
  }

  const dirPath = dirname(fullPath)
  await fs.mkdir(dirPath, { recursive: true })

  await fs.writeFile(fullPath, content, 'utf-8')
  return `File written: ${filePath}`
}

/**
 * 列出目录内容
 * @param dirPath 目录路径（相对于 workspace）
 * @param workspace 工作空间路径
 * @returns 文件列表（字符串）
 */
export async function listDir(dirPath: string = '.', workspace: string): Promise<string> {
  const fullPath = resolve(join(workspace, dirPath))

  if (isSensitivePath(fullPath)) {
    throw new Error('Access denied: Attempting to access sensitive system directory')
  }

  if (!fullPath.startsWith(resolve(workspace))) {
    throw new Error('Access denied: Path traversal detected')
  }

  const files = await fs.readdir(fullPath)
  return files.join('\n')
}

/**
 * 获取工作空间路径
 * @param workspace 工作空间路径
 * @returns 工作空间路径（字符串）
 */
export function getWorkspace(workspace: string): string {
  return workspace
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
  ]

  return sensitivePaths.some((sensitive) => path === sensitive || path.startsWith(sensitive + '/'))
}

// 导出工具定义，以便自动注册
export const fileSystemTools = [
  {
    name: 'readFile',
    description: 'Read content from a file. Use @skill/{name} to load a skill.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file (relative to workspace, or @skill/{name})',
        },
      },
      required: ['filePath'],
    },
    execute: async (args: { filePath: string }, workspace: string) => {
      return await readFile(args.filePath, workspace)
    },
  },
  {
    name: 'writeFile',
    description: 'Write content to a file in the workspace',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to write (relative to workspace)',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['filePath', 'content'],
    },
    execute: async (args: { filePath: string; content: string }, workspace: string) => {
      return await writeFile(args.filePath, args.content, workspace)
    },
  },
  {
    name: 'listDir',
    description: 'List contents of a directory in the workspace',
    parameters: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description:
            'Path to the directory to list (relative to workspace, optional, defaults to workspace root)',
        },
      },
      required: [],
    },
    execute: async (args: { dirPath?: string }, workspace: string) => {
      return await listDir(args.dirPath || '.', workspace)
    },
  },
  {
    name: 'getWorkspace',
    description: 'Get the current workspace path',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (_: unknown, workspace: string) => {
      return getWorkspace(workspace)
    },
  },
]
