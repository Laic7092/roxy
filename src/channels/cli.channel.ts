import readline from 'readline'
import chalk from 'chalk'
import ora, { type Ora } from 'ora'
import { BaseChannel } from './base'
import type { MessageBus } from '../bus/instance'
import type { OutboundMessage } from '../bus/types'
import type { AgentLoop } from '../agent/loop'
import type { Session } from '../session/manager'
import { ContextMng } from '../agent/context'
import { ResourceManager } from '../utils/resource-manager'
import { RoxyError, ErrorCode } from '../types/errors'
import { logError, log } from '../utils/error-handler'

/**
 * CLI Channel - 命令行交互式通道
 *
 * 职责：
 * - 管理自己的 Session 和 Context
 * - 直接调用 AgentLoop.process() 处理消息
 * - 通过 Bus 发布 outbound 消息，供其他 Channel 监听
 */
export class CLIChannel extends BaseChannel {
  readonly id = 'cli'

  private rl: readline.Interface | null = null
  private spinner: Ora | null = null
  private aiResponse = ''

  // 自己管理 Session 和 Context
  private session: Session | null = null
  private ctx: ContextMng | null = null
  private sessionManager: any = null

  // AgentLoop 引用（由外部注入）
  private agentLoop: AgentLoop | null = null

  // 资源管理器
  private resourceManager = new ResourceManager()

  constructor(bus: MessageBus, sessionId?: string) {
    super(bus)
    this.sessionId = sessionId || 'cli:default'
  }

  /**
   * 设置 AgentLoop 实例（依赖注入）
   */
  setAgentLoop(agentLoop: AgentLoop): void {
    this.agentLoop = agentLoop
  }

  /**
   * 初始化 Session 和 Context
   */
  async initialize(workspace: string, sessionManager: any): Promise<void> {
    this.sessionManager = sessionManager
    this.session = await sessionManager.getOrCreate(this.sessionId!)
    this.ctx = new ContextMng(workspace, true)
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

      // 开始消费出站消息
      this.consumeOutboundMessages()
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

  async send(msg: OutboundMessage): Promise<void> {
    switch (msg.type) {
      case 'typing':
        this.showTyping(msg.content)
        break
      case 'stream':
        this.showStream(msg.content)
        break
      case 'response':
        this.showResponse(msg.content)
        break
      case 'tool_call':
        this.showToolCall(msg.content)
        break
      case 'tool_result':
        this.showToolResult(msg.content)
        break
      case 'error':
        this.showError(msg.content)
        break
    }
  }

  /**
   * 消费出站消息队列（仅处理发给自己的消息）
   */
  private async consumeOutboundMessages(): Promise<void> {
    while (this._running) {
      try {
        const msg = await this.bus.consumeOutbound()
        if (msg.channelId === this.id) {
          await this.send(msg)
        }
      } catch (error) {
        console.error(chalk.red('Error consuming outbound message:'), error)
      }
    }
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

    // 发布到 Bus（用于通知其他 Channel）
    await this.handleInput(trimmedInput, this.sessionId || undefined)

    // 直接调用 AgentLoop 处理
    await this.processMessage(trimmedInput)

    this.showPrompt()
  }

  /**
   * 处理消息
   */
  private async processMessage(content: string): Promise<void> {
    if (!this.agentLoop || !this.session || !this.ctx) {
      await this.publish('error', 'Agent not initialized')
      return
    }

    try {
      // 发布 typing 状态
      await this.publish('typing', 'Thinking...')

      // 调用 AgentLoop 处理
      await this.agentLoop.process(content, this.session, this.ctx, {
        onStream: (chunk) => {
          this.publish('stream', chunk)
        },
        onToolCall: (name, args) => {
          this.publish('tool_call', { name, args })
        },
        onToolResult: (name, result) => {
          this.publish('tool_result', { name, result })
        },
      })

      await this.publish('response', '')

      // 保存 session 到磁盘
      await this.sessionManager.save(this.session)
    } catch (error) {
      await this.publish('error', error instanceof Error ? error.message : 'Unknown error')
    }
  }

  /**
   * 发布消息到 Bus
   */
  private async publish(type: OutboundMessage['type'], content: any): Promise<void> {
    await this.bus.publishOutbound({
      channelId: this.id,
      type,
      content,
    })
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
        if (this.ctx) {
          await this.ctx.reloadSkills()
        }
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
