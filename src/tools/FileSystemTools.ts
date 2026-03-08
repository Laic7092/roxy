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
 * @param filePath 文件路径（相对于 workspace，或 @skills/{name}/SKILL.md 访问内置技能）
 * @param workspace 工作空间路径
 * @returns 文件内容
 */
export async function readFile(
  filePath: string,
  workspace: string,
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    // 支持特殊前缀 @skills/{name}/SKILL.md 访问内置技能
    if (filePath.startsWith('@skills/')) {
      const skillName = filePath.replace('@skills/', '').replace('/SKILL.md', '')
      const builtinDir = getBuiltinSkillsDir()
      const skillPath = join(builtinDir, skillName, 'SKILL.md')
      const content = await fs.readFile(skillPath, 'utf-8')
      return { success: true, content }
    }

    // 支持特殊前缀 @workspace/skills/{name}/SKILL.md 访问 workspace 技能
    if (filePath.startsWith('@workspace/skills/')) {
      const skillName = filePath.replace('@workspace/skills/', '').replace('/SKILL.md', '')
      const skillPath = join(workspace, 'skills', skillName, 'SKILL.md')
      const content = await fs.readFile(skillPath, 'utf-8')
      return { success: true, content }
    }

    // 验证路径安全性，防止路径遍历攻击
    const fullPath = resolve(join(workspace, filePath))

    // 检查是否尝试访问敏感系统目录
    if (isSensitivePath(fullPath)) {
      throw new Error('Access denied: Attempting to access sensitive system directory')
    }

    // 检查路径是否在工作空间内
    if (!fullPath.startsWith(resolve(workspace))) {
      throw new Error('Access denied: Path traversal detected')
    }

    const content = await fs.readFile(fullPath, 'utf-8')
    return { success: true, content }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * 写入文件内容
 * @param filePath 文件路径（相对于 workspace）
 * @param content 文件内容
 * @param workspace 工作空间路径
 * @returns 操作结果
 */
export async function writeFile(
  filePath: string,
  content: string,
  workspace: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // 验证路径安全性，防止路径遍历攻击
    const fullPath = resolve(join(workspace, filePath))

    // 检查是否尝试访问敏感系统目录
    if (isSensitivePath(fullPath)) {
      throw new Error('Access denied: Attempting to access sensitive system directory')
    }

    // 检查路径是否在工作空间内
    if (!fullPath.startsWith(resolve(workspace))) {
      throw new Error('Access denied: Path traversal detected')
    }

    // 确保目录存在
    const dirPath = dirname(fullPath)
    await fs.mkdir(dirPath, { recursive: true })

    await fs.writeFile(fullPath, content, 'utf-8')
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * 列出目录内容
 * @param dirPath 目录路径（相对于 workspace）
 * @param workspace 工作空间路径
 * @returns 目录内容列表
 */
export async function listDir(
  dirPath: string = '.',
  workspace: string,
): Promise<{ success: boolean; files?: string[]; error?: string }> {
  try {
    // 验证路径安全性
    const fullPath = resolve(join(workspace, dirPath))

    // 检查是否尝试访问敏感系统目录
    if (isSensitivePath(fullPath)) {
      throw new Error('Access denied: Attempting to access sensitive system directory')
    }

    // 检查路径是否在工作空间内
    if (!fullPath.startsWith(resolve(workspace))) {
      throw new Error('Access denied: Path traversal detected')
    }

    const files = await fs.readdir(fullPath)
    return { success: true, files }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * 获取工作空间路径
 * @param workspace 工作空间路径
 * @returns 工作空间路径
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
    description: 'Read content from a file. Use @skills/{name}/SKILL.md to load built-in skills.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file (relative to workspace, or @skills/{name}/SKILL.md)',
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
    execute: async (_, workspace: string) => {
      return { success: true, workspace: getWorkspace(workspace) }
    },
  },
]
