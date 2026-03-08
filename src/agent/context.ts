import { readFile } from 'fs/promises'
import { Memory } from './memory'
import { SkillsLoader, SkillMeta } from './skill'
import { join } from 'path'
import type { Message, ToolMessage } from '../session/manager'
import { log } from '../utils/error-handler'

export class ContextMng {
  private sysMsgPromise: Promise<Message[]>
  private skillsLoader: SkillsLoader
  workspace: string
  private currentSkills: SkillMeta[] = []

  constructor(workspace: string, autoReloadSkills: boolean = true) {
    this.workspace = workspace
    this.skillsLoader = new SkillsLoader(workspace, undefined, {
      autoReload: autoReloadSkills,
      onChange: (skills) => this.onSkillsChanged(skills),
    })
    this.sysMsgPromise = this.loadSystemMessages()
  }

  /**
   * 技能变化时的回调
   */
  private onSkillsChanged(skills: SkillMeta[]): void {
    this.currentSkills = skills
    log('success', `Skills updated! ${skills.length} skill(s) available.`, 'context')
    // 重新加载系统消息
    this.sysMsgPromise = this.loadSystemMessages()
  }

  /**
   * 重新加载技能列表和系统消息
   */
  async reloadSkills(): Promise<void> {
    // 清除技能加载器的缓存
    this.skillsLoader.clearCache()
    // 重新加载系统消息
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

    // 使用缓存加载技能元数据
    const skillMetas = await this.skillsLoader.getSkillMetadata(true)
    this.currentSkills = skillMetas
    _sys_msg.push({
      role: 'system',
      content: `# Skill\n\nSkills are your specialized capabilities. Each skill contains detailed instructions for specific tasks.\n\n ## Available Skills\n\n${skillMetas.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}\n\n## Guidelines\n- Load skill: readFile("@skill/{skillName}")`,
    })

    return _sys_msg
  }

  async loadAgentPrompt(workspace: string): Promise<string> {
    const paths = ['AGENT.md', 'SOUL.md', 'USER.md'].map((filename) => join(workspace, filename))
    const contents = await Promise.all(
      paths.map(async (path) => {
        try {
          return await readFile(path, 'utf-8')
        } catch {
          log('warn', `Could not read ${path}, skipping...`, 'context')
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
