import readline from 'readline'
import chalk from 'chalk'
import ora, { type Ora } from 'ora'
import { BaseChannel } from './base'
import type { ChannelMessage } from './types'
import { ResourceManager } from '../utils/resource-manager'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError } from '../utils/error-handler'

/**
 * CLI Channel - 命令行交互通道
 *
 * 职责：
 * - 只负责 I/O
 * - 不处理业务逻辑
 * - 通过回调与 Gateway 通信
 */
export class CLIChannel extends BaseChannel {
  readonly id = 'cli'

  private rl: readline.Interface | null = null
  private spinner: Ora | null = null
  private aiResponse = ''
  private isWaitingResponse = false

  private resourceManager = new ResourceManager()

  constructor(sessionId?: string) {
    super()
    this.sessionId = sessionId || 'cli:default'
  }

  async start(): Promise<void> {
    console.log(chalk.blue.bold('🤖 Roxy'))
    console.log(chalk.gray(`Session: ${this.sessionId} | Type /help for commands\n`))

    try {
      this.setupReadline()
      this.setupResourceCleanup()
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

  /**
   * 接收来自 Gateway 的消息
   */
  async receive(message: ChannelMessage): Promise<void> {
    switch (message.type) {
      case 'stream':
        this.showStream(message.content?.chunk || message.data?.chunk)
        break
      case 'response':
        this.showResponse(message.content || message.data?.content)
        break
      case 'tool_call':
        this.showToolCall(message.data?.name, message.data?.args)
        break
      case 'tool_result':
        this.showToolResult(message.data?.name, message.data?.result, message.data?.error)
        break
      case 'subagent_start':
        this.showSubAgentStart(message.data?.taskId, message.data?.label, message.data?.task)
        break
      case 'subagent_complete':
        this.showSubAgentComplete(message.data?.taskId, message.data?.label, message.data?.result, message.data?.success, message.data?.error)
        break
      case 'error':
        this.showError(message.content || message.data?.error)
        break
    }
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
    this.send(trimmedInput)
  }

  private async handleCommand(cmd: string): Promise<void> {
    switch (cmd) {
      case '/exit':
      case '/quit':
        console.log(chalk.blue('\n👋 Goodbye!\n'))
        process.exit(0)
        break
      case '/clear':
        console.log(chalk.yellow('🗑️  Session cleared (note: session data still persisted)'))
        break
      case '/history':
        console.log(chalk.gray('\n📜 History command not available in this mode'))
        break
      case '/skills':
        console.log(chalk.gray('🔄 Reloading skills...'))
        break
      case '/help':
        console.log(chalk.gray('\n📚 Commands:'))
        console.log(chalk.gray('  /help     - Show help'))
        console.log(chalk.gray('  /clear    - Clear session'))
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

  private showResponse(_content: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
      this.spinner = null
    }
    process.stdout.write('\n')
    this.isWaitingResponse = false
    this.aiResponse = ''
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

  private showSubAgentStart(taskId: string, label: string, task: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }

    if (this.aiResponse) {
      process.stdout.write('\n')
    }

    console.log(chalk.dim(`└─ 🤖 SubAgent [${label}] started (id: ${taskId})`))
    console.log(chalk.dim(`   Task: ${task.length > 60 ? task.slice(0, 60) + '...' : task}\n`))

    this.spinner = ora({
      text: chalk.dim('subagent working...'),
      spinner: 'dots',
      color: 'gray',
    }).start()
  }

  private showSubAgentComplete(
    taskId: string,
    label: string,
    result: string,
    success: boolean,
    error?: string,
  ): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
    }

    const status = success ? '✅' : '❌'
    const statusText = success ? 'completed' : 'failed'

    console.log(chalk.dim(`└─ ${status} SubAgent [${label}] ${statusText}`))

    if (result) {
      const preview = result.length > 200 ? result.slice(0, 200) + '...' : result
      console.log(chalk.dim(`   Result: ${preview}\n`))
    }

    if (error) {
      console.log(chalk.red(`   Error: ${error}\n`))
    }

    this.spinner = null
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
