import { Memory } from "./memory"
import { SkillsLoader } from "./skill"

export class ContextMng {
    systemPrompt: string = 'you are a helpful AI Assist'
    tools: Tool[]
    skills: []
    _sys_msg: Message[]
    constructor({
        workspace
    }) {
        const memo = new Memory()
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

    buildContext(messages: Message[]) {
        return [
            ...this._sys_msg,
            ...messages
        ]
    }
}