import readline from 'readline'
import chalk from 'chalk'
import ora, { type Ora } from 'ora'
import { BaseChannel } from './base'
import type { EventBus } from '../bus/instance'
import type { Session, SessionManager } from '../session/manager'
import { ResourceManager } from '../utils/resource-manager'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError } from '../utils/error-handler'

/**
 * CLI Channel - 命令行交互通道
 *
 * 负责处理用户输入和显示 AI 响应
 */
export class CLIChannel extends BaseChannel {
  readonly id = 'cli'

  private rl: readline.Interface | null = null
  private spinner: Ora | null = null
  private aiResponse = ''
  private isWaitingResponse = false

  private session: Session | null = null
  private sessionManager: SessionManager | null = null
  private resourceManager = new ResourceManager()

  constructor(eventBus: EventBus, sessionId?: string) {
    super(eventBus)
    this.sessionId = sessionId || 'cli:default'
  }

  async initialize(sessionManager: SessionManager): Promise<void> {
    this.sessionManager = sessionManager
    this.session = await sessionManager.getOrCreate(this.sessionId!)
  }

  async start(): Promise<void> {
    console.log(chalk.blue.bold('🤖 Roxy'))
    console.log(chalk.gray(`Session: ${this.sessionId} | Type /help for commands\n`))

    try {
      this.setupReadline()
      this.setupResourceCleanup()
      this.subscribeEvents()
      this.setupInterruptHandler()
      this.showPrompt()
    } catch (error) {
      const roxyError =
        error instanceof RoxyError
          ? error
          : new RoxyError(
            ErrorCode.CHANNEL_CONNECTION_FAILED,
            'Failed to start CLI channel',
            error instanceof Error ? error : undefined,
          )
      logError(roxyError, 'error', 'CLIChannel')
      throw roxyError
    }
  }

  async stop(): Promise<void> {
    try {
      await this.resourceManager.cleanupAll()
    } catch (error) {
      logError(
        error instanceof RoxyError
          ? error
          : new RoxyError(
            ErrorCode.RESOURCE_CLEANUP_FAILED,
            'Failed to cleanup CLI channel resources',
            error instanceof Error ? error : undefined,
          ),
        'warn',
        'CLIChannel',
      )
    } finally {
      this.rl = null
      this.spinner = null
    }
  }

  async display(): Promise<void> {
    // No-op - events are handled via subscriptions
  }

  // ==================== Private Methods ====================

  private setupReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    this.rl.on('line', async (input) => {
      await this.handleLine(input)
    })

    this.rl.on('close', () => {
      console.log(chalk.blue('\n👋 Goodbye!\n'))
      process.exit(0)
    })
  }

  private setupResourceCleanup(): void {
    this.resourceManager.register('readline', async () => {
      if (this.rl) this.rl.close()
    })

    this.resourceManager.register('spinner', async () => {
      if (this.spinner?.isSpinning) this.spinner.stop()
    })
  }

  private setupInterruptHandler(): void {
    process.on('SIGINT', () => {
      if (this.isWaitingResponse) {
        console.log(chalk.yellow('\n⚠️  Response interrupted'))
        this.isWaitingResponse = false
        this.aiResponse = ''
        this.showPrompt()
      } else {
        console.log(chalk.blue('\n👋 Goodbye!\n'))
        process.exit(0)
      }
    })
  }

  private subscribeEvents(): void {
    this.eventBus.on('agent:stream', (event) => {
      if (event.channelId === this.id) {
        this.showStream(event.chunk)
      }
    })

    this.eventBus.on('agent:response', (event) => {
      if (event.channelId === this.id) {
        this.showResponse(event.content)
      }
    })

    this.eventBus.on('agent:tool_call', (event) => {
      if (event.channelId === this.id) {
        this.showToolCall(event.toolName, event.toolArgs)
      }
    })

    this.eventBus.on('agent:tool_result', (event) => {
      if (event.channelId === this.id) {
        this.showToolResult(event.toolName, event.toolResult, event.error)
      }
    })

    // SubAgent 独立事件
    this.eventBus.on('subagent:start', (event) => {
      this.showSubAgentStart(event)
    })

    this.eventBus.on('subagent:complete', (event) => {
      this.showSubAgentComplete(event)
    })

    this.eventBus.on('error', (event) => {
      if (event.channelId === this.id) {
        this.showError(event.error instanceof Error ? event.error.message : String(event.error))
      }
    })
  }

  private async handleLine(input: string): Promise<void> {
    const trimmedInput = input.trim()

    if (this.isWaitingResponse) return

    if (trimmedInput.startsWith('/')) {
      await this.handleCommand(trimmedInput)
      this.showPrompt()
      return
    }

    if (trimmedInput === '') {
      this.showPrompt()
      return
    }

    this.isWaitingResponse = true
    this.aiResponse = ''

    this.showTyping('Thinking...')
    await this.handleInput(trimmedInput)
  }

  private async handleCommand(cmd: string): Promise<void> {
    switch (cmd) {
      case '/exit':
      case '/quit':
        console.log(chalk.blue('\n👋 Goodbye!\n'))
        process.exit(0)
        break
      case '/clear':
        if (this.session) {
          this.session.clear()
          if (this.sessionManager) {
            this.sessionManager.save(this.session.id)
          }
        }
        console.log(chalk.yellow('🗑️  Session cleared'))
        break
      case '/history':
        console.log(chalk.gray('\n📜 History:'))
        if (this.session) {
          const history = this.session.getHistory()
          history.forEach((msg) => {
            const role = msg.role === 'user' ? chalk.green.bold('You') : chalk.cyan.bold('AI')
            const preview = msg.content.slice(0, 80) + (msg.content.length > 80 ? '...' : '')
            console.log(`  ${role}: ${preview}`)
          })
        }
        break
      case '/skills':
        console.log(chalk.gray('🔄 Reloading skills...'))
        break
      case '/help':
        console.log(chalk.gray('\n📚 Commands:'))
        console.log(chalk.gray('  /help     - Show help'))
        console.log(chalk.gray('  /clear    - Clear history'))
        console.log(chalk.gray('  /history  - Show history'))
        console.log(chalk.gray('  /skills   - Reload skills'))
        console.log(chalk.gray('  /exit     - Exit\n'))
        break
      default:
        console.log(chalk.red(`❌ Unknown command: ${cmd}`))
    }
  }

  private showPrompt(): void {
    if (this.rl && !this.isWaitingResponse) {
      this.rl.setPrompt(chalk.cyan('You: '))
      this.rl.prompt()
    }
  }

  private showTyping(status: string): void {
    if (this.spinner?.isSpinning) return
    this.spinner = ora({
      text: chalk.cyan(status),
      spinner: 'dots',
    }).start()
  }

  private showStream(chunk: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
      this.spinner = null
    }
    this.aiResponse += chunk
    process.stdout.write(chunk)
  }

  private showResponse(content: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
      this.spinner = null
    }
    process.stdout.write('\n')
    this.isWaitingResponse = false
    this.aiResponse = ''
    // console.log(content)
    this.showPrompt()
  }

  private showToolCall(toolName: string, toolArgs: any): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }

    if (this.aiResponse) {
      process.stdout.write('\n')
    }

    const argsPreview = toolArgs ? `(${JSON.stringify(toolArgs).slice(0, 50)})` : ''
    console.log(chalk.dim(`└─ ⚙️  ${toolName} ${chalk.gray(argsPreview)}`))

    this.spinner = ora({
      text: chalk.dim('executing...'),
      spinner: 'dots',
      color: 'gray',
    }).start()
  }

  private showToolResult(toolName: string, toolResult: any, error?: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }

    if (error) {
      console.log(chalk.dim(`└─ ❌ ${toolName}: ${error}\n`))
    } else {
      console.log(chalk.dim(`└─ ✅ ${toolName}\n`))
    }

    this.spinner = null
  }

  private showSubAgentStart(event: any): void {
    // 停止可能的 spinner
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }

    // 显示 SubAgent 启动通知
    console.log(chalk.cyan(`\n└─ 🚀 SubAgent [${event.label}] started`))
    console.log(
      chalk.cyan(`   Task: ${event.task.slice(0, 100)}${event.task.length > 100 ? '...' : ''}`),
    )
    console.log()
  }

  private showSubAgentComplete(event: any): void {
    // 停止可能的 spinner
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }

    // 显示 SubAgent 完成状态
    const statusIcon = event.success ? chalk.green('✅') : chalk.red('❌')
    const statusText = event.success ? 'completed' : 'failed'

    console.log(chalk.cyan(`\n└─ ${statusIcon} SubAgent [${event.label}] ${statusText}`))

    // 显示结果
    if (event.result) {
      console.log(chalk.gray(event.result))
    }

    console.log()

    // 重置状态并显示提示符
    this.isWaitingResponse = false
    this.aiResponse = ''
    this.showPrompt()
  }

  private showError(content: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }
    console.error(chalk.red(`\n❌ Error: ${content}`))
    this.isWaitingResponse = false
    this.aiResponse = ''
    this.showPrompt()
  }
}
