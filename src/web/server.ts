import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { AgentLoop } from '../agent/loop'
import { WebChannel } from '../channels/web.channel'
import { SessionManager } from '../session/manager'
import { LiteLLMProvider } from '../provider/llm'
import { ToolExecutor } from '../tools/ToolExecutor'
import { loadConfig } from '../config/manager'
import { getBus } from '../bus/instance'

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

// 全局 AgentLoop 实例（所有 Web 连接共享）
let agentLoop: AgentLoop | null = null
let sessionManager: SessionManager | null = null
let workspace: string | null = null

// 初始化 AgentLoop
async function initAgentLoop() {
  if (agentLoop) return

  const config = await loadConfig()
  workspace = config.workspace

  sessionManager = new SessionManager()

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

  // 创建 AgentLoop 实例（精简后只需传入依赖）
  agentLoop = new AgentLoop({
    provider,
    toolExecutor,
  })
}

wss.on('connection', async (ws) => {
  console.log('New client connected')

  // 确保 AgentLoop 已初始化
  await initAgentLoop()

  // 获取 Bus 单例
  const bus = getBus()

  // 创建 WebChannel（每个连接一个，注入 Bus）
  const channel = new WebChannel(ws, bus)

  // 注入 AgentLoop 到 Channel
  if (agentLoop) {
    channel.setAgentLoop(agentLoop)
  }

  // 初始化 Channel 的 Session 和 Context
  if (workspace && sessionManager) {
    await channel.initialize(workspace, sessionManager)
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
  // 初始化 AgentLoop
  await initAgentLoop()

  console.log(`Roxy web server listening on ${HOST}:${PORT}`)
  console.log(`Visit http://${HOST}:${PORT} to access the chat interface`)
})

// 处理进程退出
process.on('SIGTERM', async () => {
  server.close()
})

process.on('SIGINT', async () => {
  server.close()
})
