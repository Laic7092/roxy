import { readFile, readdir, access, watch } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { log, logError } from '../utils/error-handler'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 解析项目根目录（处理开发和构建两种情况）
const getProjectRoot = () => {
  // 如果路径中包含 'dist'，说明是构建后的环境
  if (__dirname.includes('/dist/') || __dirname.endsWith('/dist')) {
    return join(__dirname, '..')
  }
  // 开发环境，__dirname 是 src/agent
  return join(__dirname, '..')
}

// 获取内置技能目录
const getBuiltinSkillsDir = () => {
  const projectRoot = getProjectRoot()
  // 开发环境：src/skills
  // 构建环境：先尝试 dist/skills，不存在则用 src/skills
  return join(projectRoot, 'src/skills')
}

export interface SkillMeta {
  name: string
  description: string
  source: 'builtin' | 'workspace'
}

export interface SkillsLoaderOptions {
  autoReload?: boolean
  onChange?: (skills: SkillMeta[]) => void
}

export class SkillsLoader {
  private skillMetadataCache: SkillMeta[] | null = null
  private skillContentCache: Map<string, string> = new Map()
  private watchInitialized: boolean = false
  private onChangeCallback?: (skills: SkillMeta[]) => void

  constructor(
    private workspace: string,
    private builtinDir: string = getBuiltinSkillsDir(),
    private options: SkillsLoaderOptions = {},
  ) {
    this.onChangeCallback = options.onChange
    if (options.autoReload) {
      this.initWatch()
    }
  }

  /**
   * 初始化文件监听
   */
  private async initWatch(): Promise<void> {
    if (this.watchInitialized) return
    this.watchInitialized = true

    const dirsToWatch = [join(this.workspace, 'skills'), this.builtinDir]

    for (const dir of dirsToWatch) {
      try {
        // 使用异步迭代器监听文件变化
        const watcher = watch(dir, { recursive: true })

        // 异步处理文件变化事件
        ;(async () => {
          for await (const { eventType, filename } of watcher) {
            // 只监听 SKILL.md 文件的变化
            if (filename && filename.endsWith('SKILL.md')) {
              log('info', `Skill file changed: ${filename}`, 'skill')
              // 清除缓存并重新加载
              this.clearCache()
              if (this.onChangeCallback) {
                const skills = await this.getSkillMetadata(false)
                this.onChangeCallback(skills)
              }
            }
          }
        })().catch((error) => {
          logError(
            error instanceof Error ? error : new Error(String(error)),
            'warn',
            'skill',
          )
        })
      } catch (error) {
        logError(
          error instanceof Error ? error : new Error(String(error)),
          'warn',
          'skill',
        )
      }
    }
  }

  /**
   * 清除缓存，强制下次请求时重新加载
   */
  clearCache(): void {
    this.skillMetadataCache = null
    this.skillContentCache.clear()
  }

  async getSkill(name: string, useCache = true): Promise<string | null> {
    // 检查内容缓存
    if (useCache && this.skillContentCache.has(name)) {
      return this.skillContentCache.get(name)!
    }

    // 内置技能优先级最高
    const paths = [
      join(this.builtinDir, name, 'SKILL.md'),
      join(this.workspace, 'skills', name, 'SKILL.md'),
    ]

    for (const p of paths) {
      try {
        const content = await readFile(p, 'utf-8')
        // 缓存内容
        this.skillContentCache.set(name, content)
        return content
      } catch {}
    }
    return null
  }

  async getSkillMetadata(useCache = true): Promise<SkillMeta[]> {
    // 检查元数据缓存
    if (useCache && this.skillMetadataCache) {
      return this.skillMetadataCache
    }

    const skills: Map<string, SkillMeta> = new Map()
    // 先扫描 workspace，再扫描内置，让内置技能覆盖同名 workspace 技能
    const dirs = [
      { path: join(this.workspace, 'skills'), source: 'workspace' as const },
      { path: this.builtinDir, source: 'builtin' as const },
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
              // 内置技能覆盖同名 workspace 技能
              skills.set(entry.name, { name: entry.name, description, source })
            } catch {}
          }
        }
      } catch {}
    }

    // 缓存元数据
    this.skillMetadataCache = Array.from(skills.values())
    return this.skillMetadataCache
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
