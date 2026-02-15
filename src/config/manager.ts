import { writeFile, mkdir, readFile, access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { constants } from 'node:fs'
import chalk from 'chalk'

export const ROOT_PATH = join(homedir(), '.roxy')
export const WROKSPACE_PATH = join(ROOT_PATH, 'workspace')
export const CONFIG_PATH = join(ROOT_PATH, 'config.json')

const defaultConfig = {
  workspace: WROKSPACE_PATH,
  agents: {
    defaults: {
      model: 'deepseek/deepseek-chat',
    },
  },
  providers: {
    deepseek: {
      apiKey: '',
      baseURL: 'https://api.deepseek.com',
    },
  },
}

type Config = typeof defaultConfig

/**
 * 确保配置和工作区存在且完整
 */
export async function ensureConfigAndWorkspace(): Promise<void> {
  try {
    // 检查主配置目录是否存在，不存在则创建
    try {
      await access(ROOT_PATH, constants.F_OK)
      console.log(chalk.blue(`ℹ️  主配置目录已存在: ${ROOT_PATH}`))
    } catch {
      console.log(chalk.yellow(`⚠️  主配置目录不存在，正在创建: ${ROOT_PATH}`))
      await mkdir(ROOT_PATH, { recursive: true })
      console.log(chalk.green(`✅ 主配置目录已创建: ${ROOT_PATH}`))
    }

    // 检查工作区目录是否存在，不存在则创建
    try {
      await access(WROKSPACE_PATH, constants.F_OK)
      console.log(chalk.blue(`ℹ️  工作区目录已存在: ${WROKSPACE_PATH}`))
    } catch {
      console.log(chalk.yellow(`⚠️  工作区目录不存在，正在创建: ${WROKSPACE_PATH}`))
      await mkdir(WROKSPACE_PATH, { recursive: true })
      console.log(chalk.green(`✅ 工作区目录已创建: ${WROKSPACE_PATH}`))
    }

    // 检查配置文件是否存在，不存在则创建
    try {
      await access(CONFIG_PATH, constants.F_OK)
      console.log(chalk.blue(`ℹ️  配置文件已存在: ${CONFIG_PATH}`))

      // 验证配置文件是否可读和格式正确
      try {
        const configContent = await readFile(CONFIG_PATH, 'utf-8')
        JSON.parse(configContent)
        console.log(chalk.blue(`ℹ️  配置文件格式有效`))
      } catch (parseError) {
        console.log(chalk.red(`❌ 配置文件格式错误，将重新创建: ${parseError.message}`))
        await writeFile(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2))
        console.log(chalk.green(`✅ 已重新创建配置文件: ${CONFIG_PATH}`))
      }
    } catch {
      console.log(chalk.yellow(`⚠️  配置文件不存在，正在创建默认配置: ${CONFIG_PATH}`))
      await writeFile(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2))
      console.log(chalk.green(`✅ 配置文件已创建: ${CONFIG_PATH}`))
    }

    // 确保工作区中的必需文件都存在
    await initializeWorkspaceFiles(WROKSPACE_PATH)

    // 检查是否有足够的磁盘空间和权限
    try {
      await checkPermissionsAndSpace()
    } catch (error) {
      console.log(chalk.red(`⚠️  权限或空间检查警告: ${error.message}`))
    }
  } catch (error) {
    console.error(chalk.red(`❌ 确保配置和工作区存在时发生错误: ${error.message}`))
    throw error
  }
}

/**
 * 专门的错误处理函数，用于生成用户友好的错误信息
 */
export function handleConfigError(error: Error, context: string = ''): void {
  const errorMessage = error.message.toLowerCase()

  if (errorMessage.includes('permission') || errorMessage.includes('eacces')) {
    console.error(chalk.red('❌ 权限不足错误:'))
    console.error(chalk.red('   请检查 ~/.roxy 目录的权限设置'))
    console.error(chalk.red('   可能需要使用 chmod 或管理员权限'))
  } else if (errorMessage.includes('enospc')) {
    console.error(chalk.red('❌ 磁盘空间不足:'))
    console.error(chalk.red('   请清理一些磁盘空间后再试'))
  } else if (errorMessage.includes('eexist')) {
    console.error(chalk.red('❌ 文件已存在冲突:'))
    console.error(chalk.red(`   ${error.message}`))
  } else if (errorMessage.includes('enoent')) {
    console.error(chalk.red('❌ 文件或目录不存在:'))
    console.error(chalk.red(`   ${error.message}`))
    console.error(chalk.yellow('   这通常意味着配置尚未初始化'))
    console.error(chalk.yellow('   请运行 "roxy onboard" 命令进行初始化'))
  } else {
    console.error(chalk.red(`❌ ${context}发生未知错误:`))
    console.error(chalk.red(`   ${error.message}`))
  }
}

/**
 * 检查权限和可用空间
 */
async function checkPermissionsAndSpace(): Promise<void> {
  try {
    // 检查主目录的读写权限
    await access(ROOT_PATH, constants.R_OK | constants.W_OK)

    // 检查配置文件的读写权限（如果存在）
    try {
      await access(CONFIG_PATH, constants.R_OK | constants.W_OK)
    } catch (configError) {
      // 如果配置文件不存在，只检查目录权限
      if ((configError as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw configError
      }
    }

    // 检查工作区目录的读写权限
    await access(WROKSPACE_PATH, constants.R_OK | constants.W_OK)

    // 检查可用磁盘空间 (至少需要 10MB)
    // Node.js 标准库没有直接获取可用空间的方法，我们使用 statfs 方法（需要额外的库）
    // 这里我们暂时只做基本的权限检查
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      throw new Error('权限不足，无法访问配置目录或文件')
    }
    throw error
  }
}

export async function checkPathPermissions(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK | constants.R_OK | constants.W_OK)
    return true
  } catch (error) {
    return false
  }
}

// 日志级别枚举
export enum LogLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  SUCCESS = 'success',
}

/**
 * 统一日志记录函数
 */
export function logMessage(level: LogLevel, message: string, ...args: any[]): void {
  switch (level) {
    case LogLevel.INFO:
      console.log(chalk.blue(`ℹ️  ${message}`), ...args)
      break
    case LogLevel.WARN:
      console.log(chalk.yellow(`⚠️  ${message}`), ...args)
      break
    case LogLevel.ERROR:
      console.log(chalk.red(`❌ ${message}`), ...args)
      break
    case LogLevel.SUCCESS:
      console.log(chalk.green(`✅ ${message}`), ...args)
      break
    default:
      console.log(message, ...args)
  }
}

export async function initConfig() {
  try {
    console.log(chalk.blue('ℹ️  正在初始化配置...'))
    await ensureConfigAndWorkspace()
    console.log(chalk.green(`✅ 配置初始化完成: ${CONFIG_PATH}`))
    return CONFIG_PATH
  } catch (error) {
    console.error(chalk.red('❌ 创建配置文件失败:', (error as Error).message))
    throw error
  }
}

async function initializeWorkspaceFiles(workspaceDir: string) {
  // 定义需要初始化的文件及其默认内容
  const filesToInitialize = [
    {
      name: 'AGENT.md',
      content: `# Agent Instructions

You are a helpful AI assistant. Be concise, accurate, and friendly.

## Guidelines

- Always explain what you're doing before taking actions
- Ask for clarification when the request is ambiguous
- Use tools to help accomplish tasks
- Remember important information in MEMORY.md; past events are logged in HISTORY.md
`,
    },
    {
      name: 'SOUL.md',
      content: `# Soul

I am roxy, a lightweight AI assistant.

## Personality

- Helpful and friendly
- Concise and to the point
- Curious and eager to learn

## Values

- Accuracy over speed
- User privacy and safety
- Transparency in actions
`,
    },
    {
      name: 'USER.md',
      content: `# User

Information about the user goes here.

## Preferences

- Communication style: (casual/formal)
- Timezone: (your timezone)
- Language: (your preferred language)
`,
    },
    {
      name: 'MEMORY.md',
      content: `# Memory

This file stores important information and context.

## Session Information

- Last updated: ${new Date().toISOString().split('T')[0]}
- Sessions: 0

## Key Points

- No memory entries yet.
`,
    },
  ]

  // 初始化每个文件
  for (const file of filesToInitialize) {
    const filePath = join(workspaceDir, file.name)

    // 检查文件是否已存在
    try {
      await access(filePath, constants.F_OK)
      console.log(`ℹ️  文件已存在: ${filePath}`)
    } catch {
      // 文件不存在，创建它
      await writeFile(filePath, file.content, 'utf-8')
      console.log(`✅ 已创建: ${filePath}`)
    }
  }
}

export async function loadConfig(): Promise<Config> {
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(chalk.yellow(`⚠️  配置文件不存在: ${CONFIG_PATH}，正在初始化...`))
      await ensureConfigAndWorkspace()
      // 重新尝试读取配置文件
      try {
        const data = await readFile(CONFIG_PATH, 'utf-8')
        console.log(chalk.green(`✅ 配置加载成功`))
        return JSON.parse(data)
      } catch (retryError) {
        console.error(chalk.red(`❌ 即使初始化后仍无法加载配置: ${(retryError as Error).message}`))
        throw new Error(`配置初始化失败: ${CONFIG_PATH}`)
      }
    } else if (error instanceof SyntaxError) {
      console.log(chalk.red(`❌ 配置文件格式错误: ${error.message}`))
      console.log(chalk.yellow(`⚠️  正在重新创建配置文件...`))
      await ensureConfigAndWorkspace()
      // 重新尝试读取配置文件
      try {
        const data = await readFile(CONFIG_PATH, 'utf-8')
        console.log(chalk.green(`✅ 配置加载成功`))
        return JSON.parse(data)
      } catch (retryError) {
        console.error(
          chalk.red(`❌ 即使重新创建后仍无法加载配置: ${(retryError as Error).message}`),
        )
        throw new Error(`配置重新创建后仍加载失败: ${CONFIG_PATH}`)
      }
    } else {
      console.error(chalk.red(`❌ 读取配置文件时发生未知错误: ${(error as Error).message}`))
      // 尝试确保配置和工作区存在
      try {
        await ensureConfigAndWorkspace()
        // 重新尝试读取配置文件
        const data = await readFile(CONFIG_PATH, 'utf-8')
        console.log(chalk.green(`✅ 配置加载成功`))
        return JSON.parse(data)
      } catch (retryError) {
        console.error(chalk.red(`❌ 确保配置存在后仍无法加载: ${(retryError as Error).message}`))
        throw error
      }
    }
  }
}
