import { writeFile, mkdir, readFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants } from 'node:fs'
import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'

export const ROOT_PATH = join(homedir(), '.roxy')
export const WROKSPACE_PATH = join(ROOT_PATH, 'workspace')
export const CONFIG_PATH = join(ROOT_PATH, 'config.json')
export const SESSIONS_PATH = join(ROOT_PATH, 'sessions')

const __dirname = dirname(fileURLToPath(import.meta.url))
export const TEMPLATE_PATH = join(__dirname, '../../src/template')

const defaultConfig = {
  workspace: WROKSPACE_PATH,
  agents: {
    defaults: {
      model: 'ollama/qwen3.5:9b',
    },
  },
  providers: {
    deepseek: {
      apiKey: '',
      baseURL: 'https://api.deepseek.com',
    },
    ollama: {
      apiKey: 'ollama-local',
      baseURL: 'http://localhost:11434/v1',
    },
  },
}

type Config = typeof defaultConfig

/**
 * 统一初始化所有配置和工作区文件
 */
export async function initAll(force = false): Promise<void> {
  // 创建目录结构
  await mkdir(ROOT_PATH, { recursive: true })
  await mkdir(WROKSPACE_PATH, { recursive: true })
  await mkdir(SESSIONS_PATH, { recursive: true })
  await mkdir(join(WROKSPACE_PATH, 'skills'), { recursive: true })

  // 初始化配置文件
  await initConfigFile(force)

  // 初始化工作区文件
  await initWorkspaceFiles()
}

async function initConfigFile(force: boolean): Promise<void> {
  const exists = await fileExists(CONFIG_PATH)

  if (exists && !force) {
    return
  }

  await writeFile(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2))
  log('success', `Config: ${CONFIG_PATH}`, 'config/manager')
}

async function initWorkspaceFiles(): Promise<void> {
  const files = ['AGENT.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'HISTORY.md']
  const today = new Date().toISOString().split('T')[0]

  for (const fileName of files) {
    const templatePath = join(TEMPLATE_PATH, fileName)
    const workspacePath = join(WROKSPACE_PATH, fileName)
    const exists = await fileExists(workspacePath)

    if (exists) {
      continue
    }

    try {
      let content = await readFile(templatePath, 'utf-8')
      // 替换模板变量
      content = content.replace(/{{DATE}}/g, today)

      await writeFile(workspacePath, content, 'utf-8')
      log('success', `Workspace: ${fileName}`, 'config/manager')
    } catch (error) {
      logError(
        new RoxyError(ErrorCode.CONFIG_INVALID, `读取模板失败：${fileName}`),
        'error',
        'config/manager',
      )
      throw error
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 确保配置和工作区存在（用于运行时检查）
 */
export async function ensureConfigAndWorkspace(): Promise<void> {
  const exists = await fileExists(CONFIG_PATH)
  if (!exists) {
    await initAll(false)
  }
}

export async function checkPathPermissions(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK | constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * @deprecated Use initAll instead
 */
export async function initConfig(): Promise<string> {
  await initAll(false)
  return CONFIG_PATH
}

export async function loadConfig(): Promise<Config> {
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log('warn', `配置文件不存在：${CONFIG_PATH}，正在初始化...`, 'config/manager')
      await ensureConfigAndWorkspace()
      const data = await readFile(CONFIG_PATH, 'utf-8')
      return JSON.parse(data)
    } else if (error instanceof SyntaxError) {
      logError(
        new RoxyError(ErrorCode.CONFIG_INVALID, `配置文件格式错误：${error.message}`),
        'warn',
        'config/manager',
      )
      log('warn', '正在重新创建配置文件...', 'config/manager')
      await initAll(true)
      const data = await readFile(CONFIG_PATH, 'utf-8')
      return JSON.parse(data)
    } else {
      throw error
    }
  }
}
