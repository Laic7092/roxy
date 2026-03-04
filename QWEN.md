# Roxy 项目说明

## 项目概述

Roxy 是一个 AI 助手，允许用户通过命令行和 Web 与 AI 模型进行交互。该项目采用 TypeScript 编写，采用分层架构设计，支持会话管理、流式响应等功能。

## 架构设计

### 分层架构（参考 nanobot）

```
┌─────────────────────────────────────────────────────────────┐
│                    MessageBus (单例)                         │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │  inbound Queue  │    │ outbound Queue  │                │
│  │  (Channel→Agent)│    │  (Agent→Channel)│                │
│  └─────────────────┘    └─────────────────┘                │
└─────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
┌────────┴────────┐   ┌───────┴────────┐   ┌───────┴───────┐
│  CLIChannel     │   │  WebChannel    │   │  AgentLoop    │
│  (只负责 I/O)    │   │  (只负责 I/O)   │   │  (单例！共享)  │
└─────────────────┘   └────────────────┘   └───────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ SessionManager  │
                                    │ (按 sessionId   │
                                    │  隔离会话)       │
                                    └─────────────────┘
```

### 核心设计原则

1. **单一 AgentLoop 实例** - CLI 和 Web 共享同一个 AgentLoop
2. **MessageBus 双队列** - inbound (Channel→Agent), outbound (Agent→Channel)
3. **Channel 只负责 I/O** - 不创建 Agent，只通过 BUS 通信
4. **Session 隔离** - 通过 sessionId 实现会话隔离（`cli:*`, `web:*`）

### 各组件职责

| 组件 | 职责 |
|------|------|
| **Channel** | 负责输入输出，管理 Session 生命周期和持久化 |
| **MessageBus** | 双队列事件总线，解耦 Channel 和 Agent |
| **AgentLoop** | 单一实例，处理所有 Channel 的消息（无状态） |
| **SessionManager** | 按 sessionId 管理会话，实现隔离和持久化 |

## 项目结构

```
roxy/
├── src/
│   ├── agent/
│   │   ├── loop.ts         # AgentLoop - 消息处理核心（支持运行模式）
│   │   └── context.ts      # 上下文管理
│   ├── bus/
│   │   ├── instance.ts     # MessageBus - 双队列实现
│   │   └── types.ts        # 消息类型定义
│   ├── channels/
│   │   ├── base.ts         # Channel 抽象基类
│   │   ├── cli.channel.ts  # CLI 通道实现
│   │   └── web.channel.ts  # Web 通道实现
│   ├── cli/
│   │   └── commands/
│   │       ├── agent.ts    # agent 命令
│   │       ├── onboard.ts  # onboard 命令
│   │       └── web.ts      # web 命令
│   ├── config/             # 配置管理
│   ├── provider/           # LLM 提供商抽象
│   ├── session/            # 会话管理
│   ├── tools/              # 工具系统
│   ├── skills/             # 技能系统
│   ├── web/
│   │   └── server.ts       # Web 服务器
│   └── types/              # 类型定义
├── tests/
├── package.json
├── tsconfig.json
├── tsdown.config.ts
└── README.md
```

## 核心组件

### MessageBus (`src/bus/`)

**双队列设计**：
```typescript
class MessageBus {
  private inbound: AsyncQueue<InboundMessage>   // Channel → Agent
  private outbound: AsyncQueue<OutboundMessage> // Agent → Channel

  publishInbound(msg): Promise<void>
  consumeInbound(): Promise<InboundMessage>
  publishOutbound(msg): Promise<void>
  consumeOutbound(): Promise<OutboundMessage>
}
```

**消息类型**：
```typescript
interface InboundMessage {
  channelId: string
  content: string
  sessionId?: string      // 决定会话隔离
  timestamp: Date
}

interface OutboundMessage {
  channelId: string
  type: 'typing' | 'stream' | 'response' | 'tool_call' | 'tool_result' | 'error'
  content: string | any
}
```

### Channel 层 (`src/channels/`)

**BaseChannel** - 抽象基类：
```typescript
abstract class BaseChannel {
  abstract readonly id: string
  protected sessionId: string | null
  protected bus: MessageBus

  abstract start(): Promise<void>
  abstract stop(): Promise<void>
  abstract send(msg: OutboundMessage): Promise<void>

  protected handleInput(content: string, sessionId?: string): Promise<void>
  async createSession(): Promise<string>
  async switchSession(sessionId: string): Promise<void>
}
```

**Channel 的 Session 管理**：
```typescript
// Channel 持有 sessionManager 和 session 引用
class CLIChannel extends BaseChannel {
  private session: Session | null = null
  private sessionManager: SessionManager | null = null

  async initialize(workspace: string, sessionManager: SessionManager) {
    this.sessionManager = sessionManager
    this.session = await sessionManager.getOrCreate(this.sessionId!)
  }

  private async processMessage(content: string) {
    await this.agentLoop.process(content, this.session, this.ctx, callbacks)
    // 处理完成后自动保存
    await this.sessionManager.save(this.session)
  }
}
```

**CLIChannel** - CLI 通道实现：
- 使用 `readline` 处理用户输入
- 使用 `chalk` 和 `ora` 美化输出
- 支持命令：`/help`, `/clear`, `/history`, `/skills`, `/exit`
- 默认 sessionId: `cli:default`
- **自动保存 Session** - 每次消息处理后自动持久化到磁盘

**WebChannel** - Web 通道实现：
- 使用 WebSocket 进行通信
- 每个连接一个 Channel 实例
- 支持会话管理：创建、切换会话
- 默认 sessionId: `web:{随机 ID}`
- **自动保存 Session** - 每次消息处理后自动持久化到磁盘

### AgentLoop (`src/agent/`)

**两种使用模式**：

1. **直接调用模式** - 用于测试或简单场景
```typescript
const agentLoop = new AgentLoop({ session, ctx, provider, ... })
await agentLoop.msgHandler('Hello', onStreamData, onToolCall, onToolResult)
```

2. **运行模式** - 从 BUS 消费消息，自动处理
```typescript
await agentLoop.run({
  sessionManager,
  defaultSessionPrefix: 'cli', // 或 'web'
})
```

**运行模式工作流程**：
```typescript
async run(options: RunOptions) {
  while (this._running) {
    const msg = await this.bus.consumeInbound()
    await this.handleMessage(msg)
  }
}

async handleMessage(msg: InboundMessage) {
  // 1. 确定 sessionId（决定会话隔离）
  const sessionId = msg.sessionId || `${this.defaultSessionPrefix}:${msg.channelId}`

  // 2. 获取或创建 Session（按 sessionId 隔离）
  const session = await this.sessionManager.getOrCreate(sessionId)

  // 3. 处理消息并发布响应到 BUS
  await this.msgHandler(msg.content, 
    (chunk) => this.publishStream(msg.channelId, chunk),
    (name, args) => this.publishToolCall(msg.channelId, name, args),
    (name, result) => this.publishToolResult(msg.channelId, name, result)
  )
}
```

### 会话管理 (`src/session/`)

**Session 隔离策略**：
```
CLI 默认：sessionId = 'cli:default'     → cli_default.jsonl
CLI 工作：sessionId = 'cli:work'        → cli_work.jsonl
Web 用户 A: sessionId = 'web:userA'      → web_userA.jsonl
Web 用户 B: sessionId = 'web:userB'      → web_userB.jsonl
共享会话：sessionId = 'shared:proj1'    → shared_proj1.jsonl (CLI 和 Web 共享)
```

**存储格式**（JSONL）：
```jsonl
{"_type":"metadata","key":"cli:default","created_at":"..."}
{"role":"user","content":"Hello","timestamp":"..."}
{"role":"assistant","content":"Hi!","timestamp":"..."}
```

**Session 持久化**：
- Channel 在每次消息处理完成后自动调用 `sessionManager.save(session)`
- 数据以 JSONL 格式保存到 `~/.roxy/sessions/` 目录
- 文件名由 sessionId 编码生成（特殊字符转为下划线）

## 关键功能实现

### 消息流转

```
1. 用户输入
   → CLIChannel.handleInput()
   → bus.publishInbound({ sessionId: 'cli:default', ... })

2. MessageBus.inbound 队列

3. AgentLoop.consumeInbound()
   → 按 sessionId 获取 Session
   → AgentLoop.msgHandler()
   → bus.publishOutbound({ type: 'stream', ... })
   → bus.publishOutbound({ type: 'response', ... })

4. MessageBus.outbound 队列

5. CLIChannel.consumeOutbound()
   → CLIChannel.send()
   → console.log() / chalk.blue()

6. Session 持久化
   → Channel 调用 sessionManager.save(session)
   → 数据写入 ~/.roxy/sessions/{sessionId}.jsonl
```

### 流式响应

```typescript
// AgentLoop 处理
const handleStreamData = (chunk: string) => {
  this.bus.publishOutbound({
    channelId: msg.channelId,
    type: 'stream',
    content: chunk,
  })
}

// Channel 接收并显示
case 'stream':
  process.stdout.write(chalk.blue(chunk))
  break
```

### 工具调用

```
1. LLM 返回工具调用请求
2. AgentLoop 发布 tool_call 消息
3. AgentLoop 执行工具
4. AgentLoop 发布 tool_result 消息
5. 循环处理直到没有工具调用
```

## 构建和运行

### 构建项目
```bash
pnpm build
```

### 运行测试
```bash
pnpm test
```

### 开发模式
```bash
pnpm dev
```

### 安装和使用
```bash
# 全局安装
pnpm add -g roxy

# 初始化配置
roxy onboard

# 启动 CLI 会话
roxy agent
roxy agent --session cli:work  # 指定会话

# 启动 Web 服务器
roxy web -p 3000
```

## 开发约定

### 类型安全
- 项目使用 TypeScript，所有核心接口都有类型定义
- 消息类型在 `src/bus/types.ts` 中统一定义

### 架构模式
- **Channel 模式**：统一输入输出接口，便于扩展新通道
- **单一 AgentLoop**：所有 Channel 共享，节省资源
- **双队列总线**：清晰的消息流向，便于调试和扩展
- **Session 隔离**：通过 sessionId 实现多会话管理

### 代码风格
- 使用 ES2020+ 特性
- 遵循现代 TypeScript 最佳实践
- 模块化设计便于扩展和维护

## 扩展性

### 新增 Channel

1. 继承 `BaseChannel` 类
2. 实现 `start()`, `stop()`, `send()` 方法
3. 在 CLI 或 Web 入口中启动

```typescript
class DiscordChannel extends BaseChannel {
  readonly id = 'discord'
  
  async start() { /* ... */ }
  async stop() { /* ... */ }
  async send(msg: OutboundMessage) { /* ... */ }
}
```

### 新增消息类型

1. 在 `src/bus/types.ts` 中添加类型定义
2. 在 `AgentLoop.handleMessage()` 中处理新类型
3. 在 Channel 的 `send()` 中实现对应的输出方法

### 新增工具

在 `src/tools/` 目录下创建新工具，实现 `Tool` 接口，工具会自动被 `ToolExecutor` 发现和加载。

### Session 管理策略

| 场景 | SessionId 格式 | 说明 |
|------|---------------|------|
| CLI 默认 | `cli:default` | CLI 独立会话 |
| CLI 多会话 | `cli:{name}` | CLI 多个独立会话 |
| Web 默认 | `web:{随机 ID}` | 每个 Web 连接独立会话 |
| Web 用户会话 | `web:{userId}` | 按用户隔离会话 |
| 跨通道共享 | `shared:{name}` | CLI 和 Web 共享同一会话 |
