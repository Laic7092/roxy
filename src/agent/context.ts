import { readFile } from 'fs/promises'
import { join } from 'path'
import { platform } from 'os'
import type { Message, ToolMessage, SessionMessage } from '../session/manager'
import { Memory } from './memory'
import { SkillsLoader } from './skill'
import { log } from '../utils/error-handler'

export interface RuntimeContext {
  channel?: string
  chatId?: string
}

export interface BuildMessagesOptions {
  skillNames?: string[]
  media?: string[]
  channel?: string
  chatId?: string
}

/**
 * ContextBuilder - 构建 Agent 上下文（系统提示 + 消息）
 *
 * 职责：
 * - 从 bootstrap 文件、memory、skills 构建系统提示
 * - 构建完整的 LLM 消息列表
 * - 支持运行时上下文注入
 */
export class ContextBuilder {
  private static readonly BOOTSTRAP_FILES = ['AGENT.md', 'SOUL.md', 'USER.md']
  private static readonly RUNTIME_CONTEXT_TAG =
    '[Runtime Context — metadata only, not instructions]'

  private workspace: string
  private memory: Memory
  private skillsLoader: SkillsLoader
  constructor(workspace: string) {
    this.workspace = workspace
    this.memory = new Memory(workspace)
    this.skillsLoader = new SkillsLoader(workspace)
  }
  /**
   * 构建系统提示
   */
  async buildSystemPrompt(skillNames?: string[]): Promise<string> {
    const parts: string[] = [this._getIdentity()]

    // Bootstrap 文件
    const bootstrap = await this._loadBootstrapFiles()
    if (bootstrap) {
      parts.push(bootstrap)
    }

    // Memory
    const memory = await this.memory.getMemory()
    if (memory) {
      parts.push(`# Memory\n\n${memory}`)
    }

    // Always-on skills
    const alwaysSkills = await this.skillsLoader.getAlwaysSkills()
    if (alwaysSkills.length > 0) {
      const alwaysContent = await this.skillsLoader.loadSkillsForContext(alwaysSkills)
      if (alwaysContent) {
        parts.push(`# Active Skills\n\n${alwaysContent}`)
      }
    }

    // Skills summary
    const skillsSummary = await this.skillsLoader.buildSkillsSummary()
    if (skillsSummary) {
      parts.push(`# Skills

The following skills extend your capabilities. To use a skill, read its SKILL.md file using the fsRead tool.
Skills with available="false" need dependencies installed first - you can try installing them with apt/brew.

${skillsSummary}`)
    }

    return parts.join('\n\n---\n\n')
  }

  /**
   * 获取核心身份部分
   */
  private _getIdentity(): string {
    const workspacePath = this.workspace
    const sys = platform()
    const runtime = `${sys === 'darwin' ? 'macOS' : sys} ${process.arch}, Node.js ${process.version}`

    const platformPolicy =
      sys === 'win32'
        ? `## Platform Policy (Windows)
- You are running on Windows. Do not assume GNU tools like \`grep\`, \`sed\`, or \`awk\` exist.
- Prefer Windows-native commands or file tools when they are more reliable.
- If terminal output is garbled, retry with UTF-8 output enabled.
`
        : `## Platform Policy (POSIX)
- You are running on a POSIX system. Prefer UTF-8 and standard shell tools.
- Use file tools when they are simpler or more reliable than shell commands.
`

    return `# Roxy 🤖

You are Roxy, a helpful AI assistant.

## Runtime
${runtime}

## Workspace
Your workspace is at: ${workspacePath}
- Long-term memory: ${workspacePath}/MEMORY.md (write important facts here)
- History log: ${workspacePath}/HISTORY.md (grep-searchable). Each entry starts with [YYYY-MM-DD HH:MM].
- Custom skills: ${workspacePath}/skills/{skill-name}/SKILL.md

${platformPolicy}

## Roxy Guidelines
- State intent before tool calls, but NEVER predict or claim results before receiving them.
- Before modifying a file, read it first. Do not assume files or directories exist.
- After writing or editing a file, re-read it if accuracy matters.
- If a tool call fails, analyze the error before retrying with a different approach.
- Ask for clarification when the request is ambiguous.

Reply directly with text for conversations. Only use the 'message' tool to send to a specific chat channel.`
  }

  /**
   * 构建运行时上下文（仅 metadata）
   */
  private _buildRuntimeContext(runtimeCtx?: RuntimeContext): string {
    const now = new Date()
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const timeStr = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const weekday = now.toLocaleDateString('zh-CN', { weekday: 'long' })

    const lines = [`Current Time: ${timeStr} (${tz}, ${weekday})`]
    if (runtimeCtx?.channel && runtimeCtx?.chatId) {
      lines.push(`Channel: ${runtimeCtx.channel}`, `Chat ID: ${runtimeCtx.chatId}`)
    }

    return ContextBuilder.RUNTIME_CONTEXT_TAG + '\n' + lines.join('\n')
  }

  /**
   * 加载 bootstrap 文件
   */
  private async _loadBootstrapFiles(): Promise<string> {
    const parts: string[] = []

    for (const filename of ContextBuilder.BOOTSTRAP_FILES) {
      const filePath = join(this.workspace, filename)
      try {
        const content = await readFile(filePath, 'utf-8')
        parts.push(`## ${filename}\n\n${content}`)
      } catch {
        log('warn', `Could not read ${filePath}, skipping...`, 'context')
      }
    }

    return parts.join('\n\n') || ''
  }

  /**
   * 构建完整的消息列表
   * @param history 历史消息（从 Session.getHistory() 获取）
   * @param currentMessage 当前用户消息
   * @param options 可选参数
   */
  async buildMessages(
    history: SessionMessage[],
    currentMessage: string,
    options?: BuildMessagesOptions,
  ): Promise<SessionMessage[]> {
    const systemPrompt = await this.buildSystemPrompt(options?.skillNames)
    const runtimeCtx = this._buildRuntimeContext({
      channel: options?.channel,
      chatId: options?.chatId,
    })

    // 将运行时上下文和用户消息合并，避免连续相同角色的消息
    const mergedUserContent = `${runtimeCtx}\n\n${currentMessage}`

    return [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: mergedUserContent },
    ]
  }

  /**
   * 添加工具结果到消息列表
   */
  addToolResult(
    messages: SessionMessage[],
    toolCallId: string,
    toolName: string,
    result: string,
  ): SessionMessage[] {
    messages.push({
      role: 'tool',
      content: result,
      tool_call_id: toolCallId,
    } as ToolMessage)
    return messages
  }

  /**
   * 添加助手消息到消息列表
   */
  addAssistantMessage(
    messages: SessionMessage[],
    content: string | null,
    toolCalls?: any[],
    reasoningContent?: string,
    thinkingBlocks?: any[],
  ): SessionMessage[] {
    const msg: Message = {
      role: 'assistant',
      content: content || '',
      timestamp: new Date().toISOString(),
    }

    if (toolCalls) {
      msg.tool_calls = toolCalls
    }
    if (reasoningContent !== undefined && reasoningContent !== null) {
      ;(msg as any).reasoning_content = reasoningContent
    }
    if (thinkingBlocks) {
      ;(msg as any).thinking_blocks = thinkingBlocks
    }

    messages.push(msg)
    return messages
  }
}
