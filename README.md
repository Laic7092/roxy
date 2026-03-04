# Roxy

Roxy 是一个 AI 助手，支持 CLI 和 Web 多种交互方式。

## 安装

```bash
npm install -g roxy
```

或者使用 pnpm:

```bash
pnpm add -g roxy
```

## 使用方法

### 初始化配置

首次使用前，需要初始化配置文件：

```bash
roxy onboard
```

这将在 `~/.roxy/` 创建主配置目录，并在其中创建：
- `config.json` - 主配置文件
- `workspace/` - 工作空间目录，包含：
  - `USER.md` - 用户信息
  - `MEMORY.md` - 记忆存储
  - `SOUL.md` - 核心身份和价值观
  - `AGENT.md` - 代理配置

您需要编辑 `~/.roxy/config.json` 文件并添加您的 API 密钥。

### 交互式对话（CLI）

启动交互式 AI 对话：

```bash
roxy agent
```

您可以指定会话 ID：

```bash
roxy agent --session my-session
```

要清除当前会话历史：

```bash
roxy agent --clear
```

**会话持久化**：
- 所有会话会自动保存到 `~/.roxy/sessions/` 目录
- 每次消息处理后自动持久化，重启后会话历史依然存在
- 使用相同 `--session` ID 可恢复之前的对话

### Web 界面

启动 Web 服务器：

```bash
roxy web
```

选项：
- `-p, --port <port>` - 指定端口（默认：3000）
- `--host <host>` - 指定主机（默认：127.0.0.1）
- `--no-open` - 不自动打开浏览器

**会话持久化**：
- Web 会话同样会自动保存到 `~/.roxy/sessions/` 目录
- 每个 WebSocket 连接拥有独立的会话
- 刷新页面后，使用相同会话 ID 可恢复对话

## 命令

### `onboard`

初始化工作区和配置文件：

```bash
roxy onboard [options]
```

选项:
- `-f, --force` - 强制重新初始化，即使配置已存在

### `agent`

启动交互式 AI 代理（CLI 模式）：

```bash
roxy agent [options]
```

选项:
- `-s, --session <sessionId>` - 指定要使用的会话 ID（默认为 "cli:default"）
- `-c, --clear` - 清除当前会话历史

### `web`

启动 Web 服务器：

```bash
roxy web [options]
```

选项:
- `-p, --port <port>` - 指定端口（默认：3000）
- `--host <host>` - 指定主机（默认：127.0.0.1）
- `--no-open` - 不自动打开浏览器

## 配置

配置文件位于 `~/.roxy/config.json`，示例配置如下：

```json
{
  "workspace": "/home/user/.roxy/workspace",
  "agents": {
    "defaults": {
      "model": "ollama/qwen3.5:9b"
    }
  },
  "providers": {
    "ollama": {
      "apiKey": "ollama-local",
      "baseURL": "http://localhost:11434/v1"
    },
    "deepseek": {
      "apiKey": "your-api-key-here",
      "baseURL": "https://api.deepseek.com"
    }
  }
}
```

## 架构

Roxy 采用分层架构设计：

```
┌─────────────────────────────────────────────────────────────┐
│                      Channel Layer                           │
│  ┌──────────────┐          ┌──────────────┐                 │
│  │  CLIChannel  │          │  WebChannel  │                 │
│  └──────┬───────┘          └──────┬───────┘                 │
│         └────────────┬────────────┘                          │
│                      ▼                                       │
│         ┌─────────────────────────┐                          │
│         │       MessageBus        │                          │
│         │  (双队列：inbound/outbound)                        │
│         └────────────┬────────────┘                          │
│                      ▼                                       │
│         ┌─────────────────────────┐                          │
│         │      AgentGateway       │                          │
│         └─────────────────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

- **Channel 层**：CLI 和 Web 通道，统一输入输出接口，**管理 Session 持久化**
- **MessageBus**：双队列事件总线，解耦通道和核心逻辑
- **AgentGateway**：统一处理所有通道的消息
- **SessionManager**：按 sessionId 隔离会话，自动持久化到磁盘

### 会话管理

- 会话 ID 格式：`cli:{name}`（CLI）或 `web:{id}`（Web）
- 存储位置：`~/.roxy/sessions/{sessionId}.jsonl`
- 存储格式：JSONL（每行一条 JSON 消息）
- 自动保存：每次消息处理完成后自动持久化

## 开发

如果您想为 Roxy 贡献代码：

1. 克隆仓库
2. 运行 `pnpm install`
3. 运行 `pnpm build` 构建项目
4. 运行 `pnpm test` 执行测试

## 许可证

ISC
