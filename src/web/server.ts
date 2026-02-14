import { log } from 'node:console';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { AgentLoop } from '../agent/loop';
import { ContextMng } from '../agent/context';
import { SessionManager } from '../session/manager';
import { LiteLLMProvider } from '../provider/llm';
import { loadConfig } from '../config/manager';
import { ToolExecutor } from '../tools/ToolExecutor';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 创建HTTP服务器
const server = createServer(async (req, res) => {
    const { url, method } = req;

    if (url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        const content = await readFile(join(__dirname, 'index.html'), 'utf-8');
        res.end(content);
    } else if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found\n');
    }
});

// 创建WebSocket服务器，附加到HTTP服务器
const wss = new WebSocketServer({ server: server, path: '/' });

// 初始化配置
const config = loadConfig();
const defaultModel = config.agents.defaults.model;

// 初始化会话管理器
const sessionManager = new SessionManager();

// 为每个WebSocket连接创建一个会话
wss.on('connection', (ws: WebSocket) => {
    log('New client connected');

    // 创建一个新的会话
    const sessionId = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const session = sessionManager.getOrCreate(sessionId);

    // 初始化组件
    const contextMng = new ContextMng(config.workspace);
    const provider = new LiteLLMProvider({
        ...config.providers.deepseek,
        model: defaultModel.split('/')[1]
    });
    const toolExecutor = new ToolExecutor(config.workspace);
    const agentLoop = new AgentLoop({
        session,
        ctx: contextMng,
        provider,
        toolExecutor,
        model: defaultModel.split('/')[1]
    });

    // 处理接收到的消息
    ws.on('message', async (data) => {
        try {
            const message = data.toString();
            const parsedData = JSON.parse(message);

            if (parsedData.type === 'message') {
                // 显示正在打字指示器
                ws.send(JSON.stringify({ type: 'typing', content: 'Roxy is thinking...' }));

                // 处理消息
                await agentLoop.msgHandler(
                    parsedData.content,
                    // onStreamData 回调 - 用于流式传输响应
                    (chunk: string) => {
                        ws.send(JSON.stringify({
                            type: 'stream',
                            content: chunk
                        }));
                    },
                    // onToolCall 回调 - 用于处理工具调用
                    (toolName: string, args: any) => {
                        ws.send(JSON.stringify({
                            type: 'tool_call',
                            toolName,
                            args
                        }));
                    },
                    // onToolResult 回调 - 用于处理工具结果
                    (toolName: string, result: any) => {
                        ws.send(JSON.stringify({
                            type: 'tool_result',
                            toolName,
                            result
                        }));
                    }
                );
            }
        } catch (error) {
            log('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                content: 'An error occurred while processing your message.'
            }));
        }
    });

    // 处理连接关闭
    ws.on('close', async () => {
        log('Client disconnected');
        // 保存会话
        await sessionManager.save(session);
    });

    // 发送欢迎消息
    ws.send(JSON.stringify({
        type: 'welcome',
        content: 'Connected to Roxy AI assistant!'
    }));
});

// 从环境变量或默认值获取端口和主机
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

server.listen(PORT, HOST, () => {
    console.log(`Roxy web server listening on ${HOST}:${PORT}`);
    console.log(`Visit http://${HOST}:${PORT} to access the chat interface`);
});
