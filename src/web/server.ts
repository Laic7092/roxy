import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { WebChannel } from '../channels/web.channel'
import { SessionManager } from '../session/manager'
import { LiteLLMProvider } from '../provider/llm'
import { ToolExecutor } from '../tools/ToolExecutor'
import { loadConfig } from '../config/manager'
import { getEventBus } from '../bus/instance'
import { AgentFactory } from '../agent/factory'
import { AgentOrchestrator } from '../orchestrator/orchestrator'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 创建 HTTP 服务器
const server = createServer(async (req, res) => {
  const { url } = req

  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    const content = await readFile(join(__dirname, 'index.html'), 'utf-8')
    res.end(content)
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found\n')
  }
})

// 创建 WebSocket 服务器
const wss = new WebSocketServer({ server })

// 全局依赖
let sessionManager: SessionManager | null = null
let orchestrator: AgentOrchestrator | null = null
let workspace: string | null = null

// 初始化系统
async function initSystem() {
  if (orchestrator) return

  const config = await loadConfig()
  workspace = config.workspace

  // 获取 EventBus 单例
  const eventBus = getEventBus()

  // 初始化会话管理器
  sessionManager = new SessionManager()
  sessionManager.setEventBus(eventBus) // 设置事件总线，自动保存

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
  orchestrator = new AgentOrchestrator({
    eventBus,
    agentFactory,
    sessionManager,
  })

  // 初始化默认 Agent
  await orchestrator.initializeDefaultAgent()
}

wss.on('connection', async (ws) => {
  console.log('New client connected')

  // 确保系统已初始化
  await initSystem()

  // 获取 EventBus
  const eventBus = getEventBus()

  // 创建 WebChannel（每个连接一个）
  const channel = new WebChannel(ws, eventBus)

  // 初始化 Channel 的 Session
  if (sessionManager) {
    await channel.initialize(sessionManager)
  }

  // 设置消息处理器
  channel.setupMessageHandler()

  // 启动 Channel
  await channel.start()
})

// 从环境变量或默认值获取端口和主机
const PORT = parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOST || '127.0.0.1'

// 启动服务器
server.listen(PORT, HOST, async () => {
  // 初始化系统
  await initSystem()

  console.log(`Roxy web server listening on ${HOST}:${PORT}`)
  console.log(`Visit http://${HOST}:${PORT} to access the chat interface`)
})

// 处理进程退出
process.on('SIGTERM', async () => {
  if (orchestrator) {
    await orchestrator.dispose()
  }
  server.close()
})

process.on('SIGINT', async () => {
  if (orchestrator) {
    await orchestrator.dispose()
  }
  server.close()
})
