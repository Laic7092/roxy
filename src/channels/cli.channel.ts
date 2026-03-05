import readline from 'readline'
import chalk from 'chalk'
import ora, { type Ora } from 'ora'
import { BaseChannel } from './base'
import type { EventBus } from '../bus/instance'
import type { Session } from '../session/manager'
import type { SessionManager } from '../session/manager'
import { ResourceManager } from '../utils/resource-manager'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError } from '../utils/error-handler'

/**
 * CLI Channel - 命令行交互式通道
 *
 * 职责：
 * - 只负责 I/O
 * - 发布用户消息事件
 * - 监听并显示 Agent 响应
 */
export class CLIChannel extends BaseChannel {
  readonly id = 'cli'

  private rl: readline.Interface | null = null
  private spinner: Ora | null = null
  private aiResponse = ''

  // Session 管理
  private session: Session | null = null
  private sessionManager: SessionManager | null = null

  // 资源管理器
  private resourceManager = new ResourceManager()

  constructor(eventBus: EventBus, sessionId?: string) {
    super(eventBus)
    this.sessionId = sessionId || 'cli:default'
  }

  /**
   * 初始化 Session
   */
  async initialize(sessionManager: SessionManager): Promise<void> {
    this.sessionManager = sessionManager
    this.session = await sessionManager.getOrCreate(this.sessionId!)
  }

  async start(): Promise<void> {
    if (this._running) return

    this._running = true
    console.log(chalk.blue('🤖 Starting interactive agent session...'))
    console.log(chalk.green(`💬 Entering interactive mode (session: ${this.sessionId || 'cli:default'})`))
    console.log(chalk.gray('Commands: /help, /clear, /history, /skills, /exit\n'))

    try {
      // 创建 readline 接口
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      // 注册资源
      this.resourceManager.register('readline', async () => {
        if (this.rl) {
          this.rl.close()
        }
      })

      this.resourceManager.register('spinner', async () => {
        if (this.spinner?.isSpinning) {
          this.spinner.stop()
        }
      })

      // 订阅事件
      this.subscribeEvents()

      // 处理用户输入
      this.rl.on('line', async (input) => {
        await this.handleLine(input)
      })

      // 处理关闭
      this.rl.on('close', () => {
        console.log(chalk.blue('\n👋 Session ended.'))
        this._running = false
      })

      // 处理 Ctrl+C
      process.on('SIGINT', () => {
        console.log(chalk.blue('\n\n👋 Goodbye!'))
        process.exit(0)
      })
    } catch (error) {
      const roxyError = error instanceof RoxyError
        ? error
        : new RoxyError(
            ErrorCode.CHANNEL_CONNECTION_FAILED,
            'Failed to start CLI channel',
            error instanceof Error ? error : undefined
          )
      logError(roxyError, 'error', 'CLIChannel')
      throw roxyError
    }
  }

  async stop(): Promise<void> {
    this._running = false
    try {
      await this.resourceManager.cleanupAll()
    } catch (error) {
      logError(
        error instanceof RoxyError ? error : new RoxyError(
          ErrorCode.RESOURCE_CLEANUP_FAILED,
          'Failed to cleanup CLI channel resources',
          error instanceof Error ? error : undefined
        ),
        'warn',
        'CLIChannel'
      )
    } finally {
      this.rl = null
      this.spinner = null
    }
  }

  /**
   * 订阅事件
   */
  private subscribeEvents(): void {
    // 监听 Agent 流式输出
    this.eventBus.on('agent:stream', (event) => {
      if (event.channelId === this.id) {
        this.showStream(event.chunk)
      }
    })

    // 监听 Agent 响应
    this.eventBus.on('agent:response', (event) => {
      if (event.channelId === this.id) {
        this.showResponse(event.content)
      }
    })

    // 监听工具调用
    this.eventBus.on('agent:tool_call', (event) => {
      if (event.channelId === this.id) {
        this.showToolCall({ name: event.toolName, args: event.toolArgs })
      }
    })

    // 监听工具结果
    this.eventBus.on('agent:tool_result', (event) => {
      if (event.channelId === this.id) {
        this.showToolResult({ name: event.toolName, result: event.toolResult })
      }
    })

    // 监听错误
    this.eventBus.on('error', (event) => {
      if (event.channelId === this.id) {
        this.showError(event.error instanceof Error ? event.error.message : String(event.error))
      }
    })
  }

  /**
   * 显示消息
   */
  async display(msg: any): Promise<void> {
    // 由事件订阅处理
  }

  /**
   * 处理用户输入行
   */
  private async handleLine(input: string): Promise<void> {
    const trimmedInput = input.trim()

    // 处理命令
    if (trimmedInput.startsWith('/')) {
      await this.handleCommand(trimmedInput)
      this.showPrompt()
      return
    }

    // 忽略空输入
    if (trimmedInput === '') {
      this.showPrompt()
      return
    }

    // 显示用户输入
    console.log(`\n${chalk.green('[You]:')} ${trimmedInput}`)

    // 发布用户消息事件
    await this.handleInput(trimmedInput)

    this.showPrompt()
  }

  /**
   * 处理 CLI 命令
   */
  private async handleCommand(cmd: string): Promise<void> {
    switch (cmd) {
      case '/exit':
      case '/quit':
        console.log(chalk.blue('\n👋 Goodbye!'))
        process.exit(0)
        break
      case '/clear':
        if (this.session) {
          this.session.clear()
          // 保存清空后的 session
          if (this.sessionManager) {
            await this.sessionManager.save(this.session.id)
          }
        }
        console.log(chalk.yellow('🗑️  Session history cleared'))
        break
      case '/history':
        console.log(chalk.gray('\n📜 Session History:'))
        if (this.session) {
          const history = this.session.getHistory()
          history.forEach((msg) => {
            const role = msg.role === 'user' ? 'You' : 'Assistant'
            console.log(chalk.gray(`  ${role}: ${msg.content.slice(0, 100)}${msg.content.length > 100 ? '...' : ''}`))
          })
        }
        break
      case '/skills':
        console.log(chalk.gray('Reloading skills...'))
        break
      case '/help':
        console.log(chalk.gray('\n📚 Available commands:'))
        console.log(chalk.gray('  /help     - Show this help message'))
        console.log(chalk.gray('  /clear    - Clear session history'))
        console.log(chalk.gray('  /history  - Show session history'))
        console.log(chalk.gray('  /skills   - Reload skills'))
        console.log(chalk.gray('  /exit     - Exit the session'))
        break
      default:
        console.log(
          chalk.red(
            `❌ Unknown command: ${cmd}. Type /help for available commands.`,
          ),
        )
    }
  }

  private showPrompt(): void {
    if (this.rl) {
      this.rl.setPrompt(chalk.cyan('> '))
      this.rl.prompt()
    }
  }

  private showTyping(status: string): void {
    if (this.spinner && this.spinner.isSpinning) return

    this.spinner = ora({
      text: chalk.gray(status),
      spinner: 'clock',
    })
    this.spinner.start()
  }

  private showStream(chunk: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }
    this.aiResponse += chunk
    process.stdout.write(chalk.blueBright(chunk))
  }

  private showResponse(content: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }
    if (!this.aiResponse) {
      console.log(chalk.blueBright(content))
    }
    console.log('')
    this.aiResponse = ''
  }

  private showToolCall(content: { name: string; args: any }): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }
    console.log(chalk.gray(`\n🔧 [Tool Call]: ${content.name}(${JSON.stringify(content.args)})`))

    if (this.spinner) {
      this.spinner.text = chalk.gray(`Executing ${content.name}...`)
      this.spinner.start()
    }
  }

  private showToolResult(content: { name: string; result: any }): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }
    console.log(chalk.gray(`\n💾 [Tool Result]: ${JSON.stringify(content.result)}`))

    if (this.spinner) {
      this.spinner.text = chalk.gray('Processing tool result...')
      this.spinner.start()
    }
  }

  private showError(content: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }
    console.error(chalk.red('\n❌ Error:'), content)
  }
}
