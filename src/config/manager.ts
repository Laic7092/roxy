import { writeFile, mkdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

export const ROOT_PATH = join(homedir(), '.roxy')
export const WROKSPACE_PATH = join(ROOT_PATH, 'workspace')
export const CONFIG_PATH = join(ROOT_PATH, 'config.json')

const defaultConfig = {
    workspace: WROKSPACE_PATH,
    agents: {
        defaults: {
            model: "deepseek/deepseek-chat"
        }
    },
    providers: {
        deepseek: {
            apiKey: '',
            baseURL: 'https://api.deepseek.com'
        }
    }
}

type Config = typeof defaultConfig

export async function initConfig() {
    try {
        // 确保主配置目录存在
        const mainDir = join(homedir(), '.roxy');
        await mkdir(mainDir, { recursive: true });

        // 确保工作空间目录存在
        await mkdir(defaultConfig.workspace, { recursive: true });

        // 初始化工作空间中的基础文件
        await initializeWorkspaceFiles(defaultConfig.workspace);

        const configPath = join(mainDir, 'config.json');

        // 检查配置文件是否已存在
        if (existsSync(configPath)) {
            console.log(`ℹ️ 配置文件已存在: ${configPath}`)
            return configPath
        }

        // 写入配置文件
        await writeFile(configPath, JSON.stringify(defaultConfig, null, 2))
        return configPath
    } catch (error) {
        console.error('❌ 创建配置文件失败:', error.message)
        throw error
    }
}

async function initializeWorkspaceFiles(workspaceDir: string) {
    // 定义需要初始化的文件及其默认内容
    const filesToInitialize = [
        {
            name: 'USER.md',
            content: `# User Information

This file contains user-specific information and preferences.`
        },
        {
            name: 'MEMORY.md',
            content: `# Memory

This file stores important memories and learnings.`
        },
        {
            name: 'SOUL.md',
            content: `# Soul

This file represents the core identity and values.`
        },
        {
            name: 'AGENT.md',
            content: `# Agent Configuration

This file contains agent-specific configurations and behaviors.`
        }
    ];

    // 初始化每个文件
    for (const file of filesToInitialize) {
        const filePath = join(workspaceDir, file.name);

        // 检查文件是否已存在
        if (!existsSync(filePath)) {
            await writeFile(filePath, file.content, 'utf-8');
            console.log(`✅ 已创建: ${filePath}`);
        } else {
            console.log(`ℹ️  文件已存在: ${filePath}`);
        }
    }
}

export function loadConfig(): Config {
    if (!existsSync(CONFIG_PATH)) {
        throw new Error(`配置文件不存在: ${CONFIG_PATH}`)
    }
    const data = readFileSync(CONFIG_PATH, 'utf-8')
    return JSON.parse(data)
}