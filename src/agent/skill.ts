import { readFile, readdir, access, watch } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { log, logError } from '../utils/error-handler'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 解析项目根目录（处理开发和构建两种情况）
const getProjectRoot = () => {
  if (__dirname.includes('/dist/') || __dirname.endsWith('/dist')) {
    return join(__dirname, '..')
  }
  return join(__dirname, '..')
}

// 获取内置技能目录
const getBuiltinSkillsDir = () => {
  const projectRoot = getProjectRoot()
  return join(projectRoot, 'src/skills')
}

export interface SkillInfo {
  name: string
  path: string
  source: 'builtin' | 'workspace'
}

export interface SkillRequirements {
  bins?: string[]
  env?: string[]
}

export interface SkillMetadata {
  name?: string
  description?: string
  always?: boolean
  requires?: SkillRequirements
}

export interface SkillsLoaderOptions {
  autoReload?: boolean
  onChange?: (skills: SkillInfo[]) => void
}

/**
 * SkillsLoader - 技能加载器
 *
 * 职责：
 * - 加载 workspace 和内置技能
 * - 解析技能元数据（frontmatter）
 * - 检查技能依赖要求
 * - 支持文件变化自动重载
 */
export class SkillsLoader {
  private skillMetadataCache: SkillInfo[] | null = null
  private skillContentCache: Map<string, string> = new Map()
  private watchInitialized: boolean = false
  private onChangeCallback?: (skills: SkillInfo[]) => void

  constructor(
    private workspace: string,
    private builtinDir: string = getBuiltinSkillsDir(),
  ) {}

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.skillMetadataCache = null
    this.skillContentCache.clear()
  }

  /**
   * 列出所有技能
   * @param filterUnavailable 是否过滤不满足依赖的技能
   */
  async listSkills(filterUnavailable = true): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = []

    // Workspace skills
    const workspaceSkillsDir = join(this.workspace, 'skills')
    try {
      const entries = await readdir(workspaceSkillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillFile = join(workspaceSkillsDir, entry.name, 'SKILL.md')
          try {
            await access(skillFile)
            skills.push({ name: entry.name, path: skillFile, source: 'workspace' })
          } catch {}
        }
      }
    } catch {}

    // Built-in skills
    try {
      const entries = await readdir(this.builtinDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillFile = join(this.builtinDir, entry.name, 'SKILL.md')
          try {
            await access(skillFile)
            // 避免重复（workspace 技能优先）
            if (!skills.some((s) => s.name === entry.name)) {
              skills.push({ name: entry.name, path: skillFile, source: 'builtin' })
            }
          } catch {}
        }
      }
    } catch {}

    // 过滤不满足依赖的技能
    if (filterUnavailable) {
      const result: SkillInfo[] = []
      for (const skill of skills) {
        const meta = await this.getSkillMetadataByName(skill.name)
        if (this.checkRequirements(meta)) {
          result.push(skill)
        }
      }
      return result
    }

    return skills
  }

  /**
   * 加载技能内容
   */
  async loadSkill(name: string): Promise<string | null> {
    // Workspace 优先级更高
    const workspaceSkill = join(this.workspace, 'skills', name, 'SKILL.md')
    try {
      const content = await readFile(workspaceSkill, 'utf-8')
      return content
    } catch {}

    // 内置技能
    const builtinSkill = join(this.builtinDir, name, 'SKILL.md')
    try {
      const content = await readFile(builtinSkill, 'utf-8')
      return content
    } catch {}

    return null
  }

  /**
   * 加载多个技能用于上下文
   */
  async loadSkillsForContext(skillNames: string[]): Promise<string> {
    const parts: string[] = []

    for (const name of skillNames) {
      const content = await this.loadSkill(name)
      if (content) {
        const stripped = this.stripFrontmatter(content)
        parts.push(`### Skill: ${name}\n\n${stripped}`)
      }
    }

    return parts.join('\n\n---\n\n')
  }

  /**
   * 构建技能摘要（XML 格式）
   */
  async buildSkillsSummary(): Promise<string> {
    const allSkills = await this.listSkills(false)
    if (allSkills.length === 0) return ''

    const escapeXML = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const lines: string[] = ['<skills>']

    for (const skill of allSkills) {
      const name = escapeXML(skill.name)
      const path = skill.path
      const meta = await this.getSkillMetadataByName(skill.name)
      const desc = escapeXML(meta.description || skill.name)
      const available = this.checkRequirements(meta)

      lines.push('  <skill available="' + String(available).toLowerCase() + '">')
      lines.push(`    <name>${name}</name>`)
      lines.push(`    <description>${desc}</description>`)
      lines.push(`    <location>${path}</location>`)

      if (!available) {
        const missing = this.getMissingRequirements(meta)
        if (missing) {
          lines.push(`    <requires>${escapeXML(missing)}</requires>`)
        }
      }

      lines.push('  </skill>')
    }

    lines.push('</skills>')
    return lines.join('\n')
  }

  /**
   * 获取 always 技能
   */
  async getAlwaysSkills(): Promise<string[]> {
    const result: string[] = []
    const skills = await this.listSkills(true)

    for (const skill of skills) {
      const meta = await this.getSkillMetadataByName(skill.name)
      if (meta.always) {
        result.push(skill.name)
      }
    }

    return result
  }

  /**
   * 获取技能元数据（缓存）
   */
  async getSkillMetadata(useCache = true): Promise<SkillInfo[]> {
    if (useCache && this.skillMetadataCache) {
      return this.skillMetadataCache
    }

    const skills = await this.listSkills(false)
    this.skillMetadataCache = skills
    return skills
  }

  /**
   * 获取单个技能的元数据
   */
  async getSkillMetadataByName(name: string): Promise<SkillMetadata> {
    const content = await this.loadSkill(name)
    if (!content) return {}

    const frontmatter = this.parseFrontmatter(content)
    return this.parseNanobotMetadata(frontmatter.metadata)
  }

  /**
   * 检查技能依赖是否满足
   */
  checkRequirements(meta: SkillMetadata): boolean {
    const requires = meta.requires || {}
    const bins = requires.bins || []
    const envVars = requires.env || []

    for (const bin of bins) {
      if (!this.which(bin)) {
        return false
      }
    }

    for (const env of envVars) {
      if (!process.env[env]) {
        return false
      }
    }

    return true
  }

  /**
   * 获取缺失的依赖描述
   */
  getMissingRequirements(meta: SkillMetadata): string {
    const missing: string[] = []
    const requires = meta.requires || {}

    for (const bin of requires.bins || []) {
      if (!this.which(bin)) {
        missing.push(`CLI: ${bin}`)
      }
    }

    for (const env of requires.env || []) {
      if (!process.env[env]) {
        missing.push(`ENV: ${env}`)
      }
    }

    return missing.join(', ')
  }

  /**
   * 解析 frontmatter
   */
  private parseFrontmatter(content: string): { metadata: string; content: string } {
    if (!content.startsWith('---')) {
      return { metadata: '', content }
    }

    const match = content.match(/^---\n(.*?)\n---\n/s)
    if (!match) {
      return { metadata: '', content }
    }

    return {
      metadata: match[1],
      content: content.slice(match[0].length).trim(),
    }
  }

  /**
   * 解析 nanobot 元数据（支持 YAML 格式）
   */
  private parseNanobotMetadata(yamlStr: string): SkillMetadata {
    if (!yamlStr.trim()) return {}

    const result: SkillMetadata = {}
    const lines = yamlStr.split('\n')

    let currentKey: string | null = null
    let currentArray: string[] = []
    let inRequires = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // 检查是否是顶级键
      const keyMatch = line.match(/^(\w+):\s*(.*)/)
      if (keyMatch) {
        // 保存之前的数组
        if (currentKey && currentArray.length > 0) {
          if (currentKey === 'requires') {
            inRequires = true
          }
        }

        const [, key, value] = keyMatch
        currentKey = key
        currentArray = []

        if (key === 'requires') {
          inRequires = true
          result.requires = {}
          continue
        }

        inRequires = false

        // 处理简单值
        if (value) {
          const cleanValue = value.replace(/^["']|["']$/g, '')
          if (cleanValue === 'true') {
            ;(result as any)[key] = true
          } else if (cleanValue === 'false') {
            ;(result as any)[key] = false
          } else {
            ;(result as any)[key] = cleanValue
          }
        }
      } else if (trimmed.startsWith('- ') && (currentKey === 'bins' || currentKey === 'env')) {
        // 数组项
        const item = trimmed
          .slice(2)
          .trim()
          .replace(/^["']|["']$/g, '')
        currentArray.push(item)

        if (inRequires && currentKey) {
          if (currentKey === 'bins') {
            result.requires = result.requires || {}
            result.requires.bins = result.requires.bins || []
            result.requires.bins.push(item)
          } else if (currentKey === 'env') {
            result.requires = result.requires || {}
            result.requires.env = result.requires.env || []
            result.requires.env.push(item)
          }
        } else if (currentKey === 'always') {
          // 不应该到这里，但处理一下
        }
      }
    }

    return result
  }

  /**
   * 移除 frontmatter
   */
  stripFrontmatter(content: string): string {
    return content.replace(/^---\n.*?\n---\n/s, '').trim()
  }

  /**
   * 检查命令是否存在（类似 which）
   */
  private which(command: string): boolean {
    try {
      const { execSync } = require('child_process')
      const cmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`
      execSync(cmd, { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
}
