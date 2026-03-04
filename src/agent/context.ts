import { readFile } from 'fs/promises'
import { Memory } from './memory'
import { SkillsLoader } from './skill'
import { join } from 'path'
import type { Message, ToolMessage } from '../session/manager'

export class ContextMng {
  private sysMsgPromise: Promise<Message[]>
  private skillsLoader: SkillsLoader
  workspace: string

  constructor(workspace: string) {
    this.workspace = workspace
    this.skillsLoader = new SkillsLoader(workspace)
    this.sysMsgPromise = this.loadSystemMessages()
  }

  private async loadSystemMessages(): Promise<Message[]> {
    const memory = new Memory(this.workspace)
    const memoryContent = await memory.getMemory()

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

    const skillMetas = await this.skillsLoader.getSkillMetadata()
    _sys_msg.push({
      role: 'system',
      content: `# Available Skills\n\n${skillMetas.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}\n\nUse the 'load_skill' tool to load a skill's full instructions when needed.`,
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

  async buildContext(messages: (Message | ToolMessage)[]): Promise<(Message | ToolMessage)[]> {
    const sysMsgs = await this.sysMsgPromise
    return [...sysMsgs, ...messages]
  }

  async loadSkillContent(skillName: string): Promise<string | null> {
    return this.skillsLoader.loadSkill(skillName)
  }
}
