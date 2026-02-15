import { log } from 'node:console'
import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { AgentLoop } from '../agent/loop'
import { ContextMng } from '../agent/context'
import { SessionManager, Session } from '../session/manager'
import { LiteLLMProvider } from '../provider/llm'
import { loadConfig } from '../config/manager'
import { ToolExecutor } from '../tools/ToolExecutor'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 创建HTTP服务器
const server = createServer(async (req, res) => {
  const { url, method } = req

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

// 创建WebSocket服务器，附加到HTTP服务器
const wss = new WebSocketServer({ server: server, path: '/' })

// 初始化配置
const config = loadConfig()
const defaultModel = config.agents.defaults.model

// 初始化会话管理器
const sessionManager = new SessionManager()

// 为每个WebSocket连接维护当前活动会话
const connections = new Map<WebSocket, { currentSession: Session; agentLoop: AgentLoop }>()

wss.on('connection', (ws: WebSocket) => {
  log('New client connected')

  // 创建一个新的会话
  const sessionId = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const session = sessionManager.getOrCreate(sessionId)

  // 初始化组件
  const contextMng = new ContextMng(config.workspace)
  const provider = new LiteLLMProvider({
    ...config.providers.deepseek,
    model: defaultModel.split('/')[1],
  })
  const toolExecutor = new ToolExecutor(config.workspace)
  const agentLoop = new AgentLoop({
    session,
    ctx: contextMng,
    provider,
    toolExecutor,
    model: defaultModel.split('/')[1],
  })

  // 将连接和会话信息存储到映射中
  connections.set(ws, { currentSession: session, agentLoop })

  // 处理接收到的消息
  ws.on('message', async (data) => {
    try {
      const message = data.toString()
      const parsedData = JSON.parse(message)

      // 获取当前连接对应的会话和代理循环
      const connectionData = connections.get(ws)
      if (!connectionData) {
        throw new Error('Connection data not found')
      }

      const { currentSession, agentLoop } = connectionData

      switch (parsedData.type) {
        case 'message':
          // 显示正在打字指示器
          ws.send(JSON.stringify({ type: 'typing', content: 'Roxy is thinking...' }))

          // 处理消息
          await agentLoop.msgHandler(
            parsedData.content,
            // onStreamData 回调 - 用于流式传输响应
            (chunk: string) => {
              ws.send(
                JSON.stringify({
                  type: 'stream',
                  content: chunk,
                }),
              )
            },
            // onToolCall 回调 - 用于处理工具调用
            (toolName: string, args: any) => {
              ws.send(
                JSON.stringify({
                  type: 'tool_call',
                  toolName,
                  args,
                }),
              )
            },
            // onToolResult 回调 - 用于处理工具结果
            (toolName: string, result: any) => {
              ws.send(
                JSON.stringify({
                  type: 'tool_result',
                  toolName,
                  result,
                }),
              )
            },
          )
          break

        case 'get_sessions':
          // 获取所有会话列表
          try {
            const sessionDir = sessionManager['dir'] // 访问私有属性获取会话目录
            const files = await readdir(sessionDir)

            // 过滤出会话文件并提取会话信息
            const sessions = files
              .filter((file) => file.endsWith('.jsonl'))
              .map((file) => {
                // 从文件名还原会话ID（去掉.jsonl后缀和特殊字符替换）
                const sessionId = file.replace(/\.jsonl$/, '')
                return {
                  id: sessionId,
                  name: sessionId, // 默认名称为ID，后续可以扩展为实际的会话标题
                  createdAt: 'N/A', // 可以从文件元数据或其他地方获取时间
                }
              })

            ws.send(
              JSON.stringify({
                type: 'sessions_list',
                sessions,
              }),
            )
          } catch (error) {
            log('Error getting sessions:', error)
            ws.send(
              JSON.stringify({
                type: 'error',
                content: 'An error occurred while retrieving sessions.',
              }),
            )
          }
          break

        case 'switch_session':
          // 切换到指定会话
          try {
            const { sessionId } = parsedData

            if (!sessionId) {
              throw new Error('Session ID is required to switch session')
            }

            // 获取指定的会话
            const targetSession = sessionManager.getOrCreate(sessionId)

            // 更新当前连接的会话
            connectionData.currentSession = targetSession

            // 重新创建AgentLoop以使用新的会话
            const newAgentLoop = new AgentLoop({
              session: targetSession,
              ctx: contextMng,
              provider,
              toolExecutor,
              model: defaultModel.split('/')[1],
            })

            connectionData.agentLoop = newAgentLoop

            // 发送成功消息
            ws.send(
              JSON.stringify({
                type: 'session_switched',
                sessionId: targetSession.id,
                message: `Switched to session: ${targetSession.id}`,
              }),
            )

            // 发送新会话的消息历史
            ws.send(
              JSON.stringify({
                type: 'session_history',
                history: targetSession.getHistory(),
              }),
            )
          } catch (error) {
            log('Error switching session:', error)
            ws.send(
              JSON.stringify({
                type: 'error',
                content: `An error occurred while switching sessions: ${error.message}`,
              }),
            )
          }
          break

        case 'create_session':
          // 创建新会话
          try {
            // 生成新的会话ID
            const newSessionId = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

            // 创建新会话
            const newSession = sessionManager.getOrCreate(newSessionId)

            // 更新当前连接的会话
            connectionData.currentSession = newSession

            // 重新创建AgentLoop以使用新的会话
            const newAgentLoop = new AgentLoop({
              session: newSession,
              ctx: contextMng,
              provider,
              toolExecutor,
              model: defaultModel.split('/')[1],
            })

            connectionData.agentLoop = newAgentLoop

            // 发送成功消息
            ws.send(
              JSON.stringify({
                type: 'session_created',
                sessionId: newSession.id,
                message: `Created and switched to new session: ${newSession.id}`,
              }),
            )
          } catch (error) {
            log('Error creating session:', error)
            ws.send(
              JSON.stringify({
                type: 'error',
                content: `An error occurred while creating a new session: ${error.message}`,
              }),
            )
          }
          break

        case 'delete_session':
          // 删除指定会话
          try {
            const { sessionId } = parsedData

            if (!sessionId) {
              throw new Error('Session ID is required to delete session')
            }

            // 检查是否尝试删除当前活动会话
            if (connectionData.currentSession.id === sessionId) {
              throw new Error('Cannot delete the currently active session')
            }

            // 删除会话文件
            const deleted = await sessionManager.delete(sessionId)

            if (deleted) {
              ws.send(
                JSON.stringify({
                  type: 'session_deleted',
                  sessionId,
                  message: `Session ${sessionId} has been deleted`,
                }),
              )
            } else {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  content: `Session ${sessionId} not found`,
                }),
              )
            }
          } catch (error) {
            log('Error deleting session:', error)
            ws.send(
              JSON.stringify({
                type: 'error',
                content: `An error occurred while deleting session: ${error.message}`,
              }),
            )
          }
          break
      }
    } catch (error) {
      log('Error processing message:', error)
      ws.send(
        JSON.stringify({
          type: 'error',
          content: 'An error occurred while processing your message.',
        }),
      )
    }
  })

  // 处理连接关闭
  ws.on('close', async () => {
    log('Client disconnected')

    // 获取当前连接对应的会话
    const connectionData = connections.get(ws)
    if (connectionData) {
      // 保存当前会话
      await sessionManager.save(connectionData.currentSession)

      // 从映射中移除连接
      connections.delete(ws)
    }
  })
})

// 从环境变量或默认值获取端口和主机
const PORT = parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOST || '127.0.0.1'

server.listen(PORT, HOST, () => {
  console.log(`Roxy web server listening on ${HOST}:${PORT}`)
  console.log(`Visit http://${HOST}:${PORT} to access the chat interface`)
})
