import { readFileSync } from "fs"
import { Memory } from "./memory"
import { SkillsLoader } from "./skill"
import { join } from "path"

export class ContextMng {
    systemPrompt: string
    tools: Tool[]
    skills: []
    _sys_msg: Message[]
    constructor({
        workspace
    }) {
        this.loadAgentPrompt(workspace)
        const memo = new Memory(workspace)
        const skillsLoader = new SkillsLoader(workspace)

        const _sys_msg = [
            {
                role: 'system',
                content: this.systemPrompt
            },
            {
                role: 'system',
                content: memo.getMemory()
            }
        ]
        skillsLoader.getAvailableSkills().then(skills => {
            _sys_msg.push({
                role: 'system',
                content: '# SKILLS' + skills.join('\n')
            })
        })
        this._sys_msg = _sys_msg as Message[]
    }

    loadAgentPrompt(workspace) {
        const paths = ['AGENT.md', 'SOUL.md', 'USER.md'].map(filename => join(workspace, filename))
        this.systemPrompt = paths.map(path => readFileSync(path, 'utf-8')).join('\n')
    }

    buildContext(messages: Message[]) {
        return [
            ...this._sys_msg,
            ...messages
        ]
    }
}