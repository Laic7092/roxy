import { readFile } from 'fs/promises'
import { Memory } from './memory'
import { SkillsLoader } from './skill'
import { join } from 'path'
import type { Message, ToolMessage } from '../session/manager'

export class ContextMng {
  private sysMsgPromise: Promise<Message[]> // 异步加载系统消息
  workspace: string

  constructor(workspace: string) {
    this.workspace = workspace
    // 在构造函数中启动异步加载过程
    this.sysMsgPromise = this.loadSystemMessages()
  }

  private async loadSystemMessages(): Promise<Message[]> {
    // 创建Memory实例并异步获取记忆
    const memory = new Memory(this.workspace)
    const memoryContent = await memory.getMemory()

    // 创建SkillsLoader实例并异步获取技能
    const skillsLoader = new SkillsLoader(this.workspace)
    const skills = await skillsLoader.getAvailableSkills()

    // 异步加载代理提示
    const agentPrompt = await this.loadAgentPrompt(this.workspace)

    const _sys_msg: Message[] = [
      {
        role: 'system',
        content: agentPrompt,
      },
      {
        role: 'system',
        content: memoryContent,
      },
    ]

    _sys_msg.push({
      role: 'system',
      content: '# SKILLS' + skills.join('\n'),
    })

    return _sys_msg
  }

  async loadAgentPrompt(workspace: string): Promise<string> {
    const paths = ['AGENT.md', 'SOUL.md', 'USER.md'].map((filename) => join(workspace, filename))
    const contents = await Promise.all(
      paths.map(async (path) => {
        try {
          return await readFile(path, 'utf-8')
        } catch (error) {
          console.error(error)
          console.warn(`Warning: Could not read ${path}, skipping...`)
          return ''
        }
      }),
    )
    return contents.join('\n')
  }

  // 异步构建上下文
  async buildContext(messages: (Message | ToolMessage)[]): Promise<(Message | ToolMessage)[]> {
    const sysMsgs = await this.sysMsgPromise
    return [...sysMsgs, ...messages]
  }
}
