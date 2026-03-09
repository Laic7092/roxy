import { promises as fs } from 'fs'
import { join, dirname, resolve } from 'path'
import { getProjectRoot } from '../utils/helper'

const PROJECT_ROOT = await getProjectRoot()

function resolvePath(inputPath: string, workspace: string, allowReadOnly: boolean = false): string {
  const fullPath = inputPath.startsWith('/')
    ? resolve(inputPath)
    : resolve(join(workspace, inputPath))
  const normalizedPath = resolve(fullPath)
  const normalizedWorkspace = resolve(workspace)
  const normalizedProjectRoot = resolve(PROJECT_ROOT)

  const isInWorkspace = normalizedPath.startsWith(normalizedWorkspace)
  const isInProjectRoot = allowReadOnly && normalizedPath.startsWith(normalizedProjectRoot)

  if (!isInWorkspace && !isInProjectRoot) {
    throw new Error('Access denied: Path outside allowed directories')
  }

  if (isSensitivePath(normalizedPath)) {
    throw new Error('Access denied: Attempting to access sensitive system directory')
  }

  return normalizedPath
}

export async function fsRead(filePath: string, workspace: string): Promise<string> {
  const fullPath = resolvePath(filePath, workspace, true)

  try {
    return await fs.readFile(fullPath, 'utf-8')
  } catch (error: any) {
    if (error.code === 'ENOENT') throw new Error(`File not found: ${filePath}`)
    if (error.code === 'EACCES') throw new Error(`Permission denied: ${filePath}`)
    throw new Error(`Failed to read file: ${error.message}`)
  }
}

export async function fsWrite(
  filePath: string,
  content: string,
  workspace: string,
): Promise<string> {
  const fullPath = resolvePath(filePath, workspace, false)

  try {
    const dirPath = dirname(fullPath)
    await fs.mkdir(dirPath, { recursive: true })

    if (content.length > 10 * 1024 * 1024) {
      throw new Error('File size exceeds limit (10MB)')
    }

    await fs.writeFile(fullPath, content, 'utf-8')
    return `File written: ${filePath}`
  } catch (error: any) {
    if (error.code === 'EACCES') throw new Error(`Permission denied: ${filePath}`)
    if (error.code === 'ENOSPC') throw new Error('No disk space available')
    throw new Error(`Failed to write file: ${error.message}`)
  }
}

export async function fsReadDir(dirPath: string = '.', workspace: string): Promise<string> {
  const fullPath = resolvePath(dirPath, workspace, true)

  try {
    const stat = await fs.stat(fullPath)
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${dirPath}`)

    const files = await fs.readdir(fullPath)
    return files.join('\n')
  } catch (error: any) {
    if (error.code === 'ENOENT') throw new Error(`Directory not found: ${dirPath}`)
    if (error.code === 'EACCES') throw new Error(`Permission denied: ${dirPath}`)
    throw new Error(`Failed to list directory: ${error.message}`)
  }
}

export function fsGetWorkspace(workspace: string): string {
  return workspace
}

function isSensitivePath(path: string): boolean {
  const sensitivePaths = [
    '/etc',
    '/var',
    '/usr',
    '/root',
    '/proc',
    '/sys',
    '/dev',
    '/boot',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/opt',
  ]

  if (path.startsWith(PROJECT_ROOT)) return false

  return sensitivePaths.some((sensitive) => path === sensitive || path.startsWith(sensitive + '/'))
}

export const fileSystemTools = [
  {
    name: 'fsRead',
    description: 'Read content from a file',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the file' },
      },
      required: ['filePath'],
    },
    execute: async (args: { filePath: string }, workspace: string) => {
      return await fsRead(args.filePath, workspace)
    },
  },
  {
    name: 'fsWrite',
    description: 'Write content to a file in the workspace',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the file to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['filePath', 'content'],
    },
    execute: async (args: { filePath: string; content: string }, workspace: string) => {
      return await fsWrite(args.filePath, args.content, workspace)
    },
  },
  {
    name: 'fsReadDir',
    description: 'List contents of a directory',
    parameters: {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: 'Path to the directory' },
      },
      required: [],
    },
    execute: async (args: { dirPath?: string }, workspace: string) => {
      return await fsReadDir(args.dirPath || '.', workspace)
    },
  },
  {
    name: 'fsGetWorkspace',
    description: 'Get the current workspace path',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (_: unknown, workspace: string) => {
      return fsGetWorkspace(workspace)
    },
  },
]
