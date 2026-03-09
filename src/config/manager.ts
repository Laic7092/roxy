import { writeFile, mkdir, readFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { constants } from 'node:fs'
import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'
import type { RoxyConfig } from './types'
import { defaultConfig } from './types'
import { getProjectRoot } from '../utils/helper'

export const ROOT_PATH = join(homedir(), '.roxy')
export const WROKSPACE_PATH = join(ROOT_PATH, 'workspace')
export const CONFIG_PATH = join(ROOT_PATH, 'config.json')
export const SESSIONS_PATH = join(ROOT_PATH, 'sessions')

const PROJECT_ROOT = await getProjectRoot()
export const TEMPLATE_PATH = join(PROJECT_ROOT, 'src', 'template')

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
  const files = ['AGENT.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'HISTORY.md', 'HEARTBEAT.md']
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

/**
 * 同步工作区模板文件
 * 确保工作区文件与模板保持同步（用于更新模板后的同步）
 */
export async function syncWorkspaceTemplates(): Promise<void> {
  const files = ['AGENT.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'HISTORY.md', 'HEARTBEAT.md']
  const today = new Date().toISOString().split('T')[0]

  for (const fileName of files) {
    const templatePath = join(TEMPLATE_PATH, fileName)
    const workspacePath = join(WROKSPACE_PATH, fileName)

    try {
      // 检查模板文件是否存在
      const templateExists = await fileExists(templatePath)
      if (!templateExists) {
        log('warn', `Template not found: ${fileName}`, 'config/manager')
        continue
      }

      // 检查工作区文件是否存在
      const workspaceExists = await fileExists(workspacePath)

      if (!workspaceExists) {
        // 文件不存在，直接创建
        let content = await readFile(templatePath, 'utf-8')
        content = content.replace(/{{DATE}}/g, today)
        await writeFile(workspacePath, content, 'utf-8')
        log('success', `Created: ${fileName}`, 'config/manager')
        continue
      }

      // 文件已存在，比较内容
      const templateContent = await readFile(templatePath, 'utf-8')
      const workspaceContent = await readFile(workspacePath, 'utf-8')

      // 如果模板内容不同，可以选择更新或跳过
      // 这里选择只创建不存在的文件，不覆盖已存在的文件
      if (templateContent !== workspaceContent) {
        log(
          'debug',
          `File exists and differs from template: ${fileName} (skipping)`,
          'config/manager',
        )
      }
    } catch (error) {
      logError(
        new RoxyError(
          ErrorCode.CONFIG_INVALID,
          `同步模板失败：${fileName}`,
          error instanceof Error ? error : undefined,
        ),
        'error',
        'config/manager',
      )
    }
  }

  log('info', 'Workspace templates synchronized', 'config/manager')
}

export async function loadConfig(): Promise<RoxyConfig> {
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8')
    const loadedConfig = JSON.parse(data)

    // 合并默认配置，确保所有字段都存在
    return mergeConfig(defaultConfig, loadedConfig)
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

/**
 * 合并配置，确保默认值生效
 */
function mergeConfig(defaults: RoxyConfig, loaded: RoxyConfig): RoxyConfig {
  const config: RoxyConfig = {
    ...defaults,
    ...loaded,
    agents: {
      defaults: {
        ...defaults.agents.defaults,
        ...loaded.agents?.defaults,
      },
      list: loaded.agents?.list,
    },
    providers: {
      ...defaults.providers,
      ...loaded.providers,
    },
    heartbeat: {
      ...defaults.heartbeat,
      ...loaded.heartbeat,
    },
    cron: {
      ...defaults.cron,
      ...loaded.cron,
    },
    channels: {
      ...defaults.channels,
      ...loaded.channels,
    },
  }

  return config
}

/**
 * 保存配置
 */
export async function saveConfig(config: RoxyConfig): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
  log('success', 'Config saved', 'config/manager')
}

/**
 * 更新部分配置
 */
export async function updateConfig(partial: Partial<RoxyConfig>): Promise<RoxyConfig> {
  const current = await loadConfig()
  const updated = mergeConfig(current, partial)
  await saveConfig(updated)
  return updated
}
