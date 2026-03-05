import { Command } from 'commander'
import chalk from 'chalk'
import { CLIChannel } from '../../channels/cli.channel'
import { SessionManager } from '../../session/manager'
import { LiteLLMProvider } from '../../provider/llm'
import { ToolExecutor } from '../../tools/ToolExecutor'
import { loadConfig } from '../../config/manager'
import { getEventBus } from '../../bus/instance'
import { AgentFactory } from '../../agent/factory'
import { AgentOrchestrator } from '../../orchestrator/orchestrator'
import { AgentRole } from '../../agent/types'

export const AgentCommand = new Command('agent')

AgentCommand.description('Start an interactive conversation with the AI agent')
  .option('-s, --session <sessionId>', 'Specify session ID to use (default: "cli:default")')
  .option('-c, --clear', 'Clear the current session history')
  .action(async (options) => {
    try {
      // 加载配置
      const config = await loadConfig()
      const workspace = config.workspace

      // 获取 EventBus 单例
      const eventBus = getEventBus()

      // 初始化会话管理器
      const sessionManager = new SessionManager()
      sessionManager.setEventBus(eventBus) // 设置事件总线，自动保存

      const sessionId = options.session || 'cli:default'

      // 如果设置了清除选项，则清空会话历史
      if (options.clear) {
        const session = await sessionManager.getOrCreate(sessionId)
        session.clear()
        await sessionManager.save(sessionId)
        console.log(chalk.yellow('🗑️  Session history cleared'))
      }

      // 初始化 Provider
      const curProvider = config.agents.defaults.model.split('/')[0]
      const curModel = config.agents.defaults.model.split('/')[1]
      const { apiKey, baseURL } = config.providers[curProvider]

      const provider = new LiteLLMProvider({
        apiKey,
        baseURL,
        model: curModel,
      })

      // 初始化 ToolExecutor
      const toolExecutor = new ToolExecutor(workspace)

      // 创建 AgentFactory
      const agentFactory = new AgentFactory({
        eventBus,
        provider,
        toolExecutor,
        sessionManager,
        workspace,
      })

      // 创建 AgentOrchestrator
      const orchestrator = new AgentOrchestrator({
        eventBus,
        agentFactory,
        sessionManager,
      })

      // 初始化默认 Agent
      await orchestrator.initializeDefaultAgent()

      // 创建 CLI Channel
      const channel = new CLIChannel(eventBus, sessionId)

      // 初始化 Channel 的 Session
      await channel.initialize(sessionManager)

      // 启动 Channel
      await channel.start()

      // 处理进程退出
      process.on('SIGINT', async () => {
        await channel.stop()
        await orchestrator.dispose()
        process.exit(0)
      })

      process.on('SIGTERM', async () => {
        await channel.stop()
        await orchestrator.dispose()
        process.exit(0)
      })
    } catch (error) {
      if (error.message.includes('配置文件不存在') || error.message.includes('Configuration not found')) {
        console.error(chalk.red('❌ Configuration not found. Please run "roxy onboard" first.'))
      } else {
        console.error(chalk.red('❌ Failed to start agent:'), error.message)
      }
      process.exit(1)
    }
  })
