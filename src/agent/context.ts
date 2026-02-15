import { readFileSync } from 'fs'
import { Memory } from './memory'
import { SkillsLoader } from './skill'
import { join } from 'path'
import { Message, ToolMessage } from '../session/manager'

export class ContextMng {
  skills: []
  _sys_msg: Message[]
  workspace: string
  constructor(workspace: string) {
    const memo = new Memory(workspace)
    const skillsLoader = new SkillsLoader(workspace)

    const _sys_msg = [
      {
        role: 'system',
        content: this.loadAgentPrompt(workspace),
      },
      {
        role: 'system',
        content: memo.getMemory(),
      },
    ]
    skillsLoader.getAvailableSkills().then((skills) => {
      _sys_msg.push({
        role: 'system',
        content: '# SKILLS' + skills.join('\n'),
      })
    })
    this._sys_msg = _sys_msg as Message[]
    this.workspace = workspace
  }

  loadAgentPrompt(workspace) {
    const paths = ['AGENT.md', 'SOUL.md', 'USER.md'].map((filename) => join(workspace, filename))
    return paths.map((path) => readFileSync(path, 'utf-8')).join('\n')
  }

  buildContext(messages: (Message | ToolMessage)[]) {
    return [...this._sys_msg, ...messages]
  }
}
