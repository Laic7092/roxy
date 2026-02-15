import { readFile, readdir, access } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { which } from 'which'

const __dirname = dirname(fileURLToPath(import.meta.url))

export class SkillsLoader {
  constructor(
    private workspace: string,
    private builtinDir = join(__dirname, '../../skills'),
  ) {}

  async getSkill(name: string): Promise<string | null> {
    const paths = [
      join(this.workspace, 'skills', name, 'SKILL.md'),
      join(this.builtinDir, name, 'SKILL.md'),
    ]

    for (const p of paths) {
      try {
        return await readFile(p, 'utf-8')
      } catch {}
    }
    return null
  }

  async getAvailableSkills(): Promise<string[]> {
    const skills: string[] = []
    const dirs = [this.builtinDir, join(this.workspace, 'skills')]

    for (const dir of dirs) {
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory() && !skills.includes(entry.name)) {
            const skillPath = join(dir, entry.name, 'SKILL.md')
            try {
              await access(skillPath)
              skills.push(entry.name)
            } catch {}
          }
        }
      } catch {}
    }
    return skills
  }

  async loadMultiple(names: string[]): Promise<string> {
    const contents = await Promise.all(
      names.map(async (name) => {
        const content = await this.getSkill(name)
        return content ? `### Skill: ${name}\n\n${this.stripFrontmatter(content)}` : null
      }),
    )

    return contents.filter(Boolean).join('\n\n---\n\n')
  }

  private stripFrontmatter(content: string): string {
    return content.replace(/^---\n.*?\n---\n/s, '').trim()
  }
}
