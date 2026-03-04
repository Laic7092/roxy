import { readFile, readdir, access } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface SkillMeta {
  name: string
  description: string
  source: 'builtin' | 'workspace'
}

export class SkillsLoader {
  constructor(
    private workspace: string,
    private builtinDir = join(__dirname, '../src/skills'),
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

  async getSkillMetadata(): Promise<SkillMeta[]> {
    const skills: Map<string, SkillMeta> = new Map()
    const dirs = [
      { path: this.builtinDir, source: 'builtin' as const },
      { path: join(this.workspace, 'skills'), source: 'workspace' as const },
    ]

    for (const { path, source } of dirs) {
      try {
        const entries = await readdir(path, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillPath = join(path, entry.name, 'SKILL.md')
            try {
              await access(skillPath)
              const content = await readFile(skillPath, 'utf-8')
              const { name, description } = this.parseFrontmatter(content)
              // workspace 技能覆盖同名内置技能
              skills.set(entry.name, { name: entry.name, description, source })
            } catch {}
          }
        }
      } catch {}
    }
    return Array.from(skills.values())
  }

  async loadSkill(name: string): Promise<string | null> {
    return this.getSkill(name)
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

  async loadMultiple(names?: string[]): Promise<string> {
    const skillNames = names || (await this.getAvailableSkills())
    const contents = await Promise.all(
      skillNames.map(async (name) => {
        const content = await this.getSkill(name)
        return content ? `### Skill: ${name}\n\n${this.stripFrontmatter(content)}` : null
      }),
    )

    return contents.filter(Boolean).join('\n\n---\n\n')
  }

  private stripFrontmatter(content: string): string {
    return content.replace(/^---\n.*?\n---\n/s, '').trim()
  }

  private parseFrontmatter(content: string): { name: string; description: string } {
    const match = content.match(/^---\n(.*?)\n---\n/s)
    if (!match) {
      return { name: 'unknown', description: 'No description' }
    }

    const frontmatter = match[1]
    const nameMatch = frontmatter.match(/name:\s*(.+)/)
    const descMatch = frontmatter.match(/description:\s*(.+)/)

    return {
      name: nameMatch ? nameMatch[1].trim() : 'unknown',
      description: descMatch ? descMatch[1].trim() : 'No description',
    }
  }
}
