import { Command } from 'commander'
import chalk from 'chalk'
import { CLIChannel } from '../../channels/cli.channel'
import { RoxyGateway } from '../../gateway/gateway'
import { loadConfig } from '../../config/manager'

export const AgentCommand = new Command('agent')

AgentCommand.description('Start an interactive conversation with the AI agent')
  .option('-s, --session <sessionId>', 'Specify session ID to use (default: "cli:default")')
  .option('-c, --clear', 'Clear the current session history')
  .action(async (options) => {
    try {
      // 加载配置
      const config = await loadConfig()
      const workspace = config.workspace

      const sessionId = options.session || 'cli:default'

      // 如果设置了清除选项，则清空会话历史
      if (options.clear) {
        const { SessionManager } = await import('../../session/manager')
        const sessionManager = new SessionManager()
        const session = await sessionManager.getOrCreate(sessionId)
        session.clear()
        await sessionManager.save(sessionId)
        console.log(chalk.yellow('🗑️  Session history cleared'))
      }

      // 创建 Gateway
      const gateway = new RoxyGateway({
        config: {
          workspace,
          defaultModel: config.agents.defaults.model,
        },
      })

      // 创建 CLI Channel
      const channel = new CLIChannel(sessionId)

      // 设置输入处理器
      channel.setInputHandler(async (content) => {
        await gateway.receive({
          channelId: channel.id,
          sessionId: channel.sessionIdValue!,
          content,
        })
      })

      // 设置输出处理器
      channel.setOutputHandler(async (message) => {
        await channel.receive(message)
      })

      // 注册 Gateway 输出到 Channel
      gateway.on(channel.id, async (output) => {
        await channel.receive({
          type: output.type,
          data: output.data,
          sessionId: output.sessionId,
          channelId: output.channelId,
        })
      })

      // 启动 Gateway
      await gateway.start()

      // 启动 Channel
      await channel.start()

      // 处理进程退出
      process.on('SIGINT', async () => {
        await channel.stop()
        await gateway.stop()
        process.exit(0)
      })

      process.on('SIGTERM', async () => {
        await channel.stop()
        await gateway.stop()
        process.exit(0)
      })
    } catch (error) {
      if (
        error.message.includes('配置文件不存在') ||
        error.message.includes('Configuration not found')
      ) {
        console.error(chalk.red('❌ Configuration not found. Please run "roxy onboard" first.'))
      } else {
        console.error(chalk.red('❌ Failed to start agent:'), error.message)
      }
      process.exit(1)
    }
  })
