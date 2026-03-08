# Roxy - AI Assistant

## 项目概述

Roxy 是一个基于事件驱动的 AI 助手框架，使用 TypeScript 开发。它支持多 LLM 提供商、工具调用、会话管理和技能扩展。

### 核心技术栈

- **运行时**: Node.js (ESM)
- **语言**: TypeScript 5.9+
- **包管理器**: pnpm 10.29.2
- **构建工具**: tsdown
- **测试框架**: Vitest
- **Linter**: oxlint
- **Formatter**: oxfmt

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                            │
│                    (src/cli/index.ts)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Gateway                               │
│              (src/gateway/gateway.ts)                        │
│         ┌─────────────────────────────────────┐              │
│         │           Event Bus                 │              │
│         │         (src/bus/)                  │              │
│         └─────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│    Agent Loop    │ │   Sub Agents     │ │   Channels       │
│  (src/agent/)    │ │  (src/agent/)    │ │ (src/channels/)  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      Tool Layer                              │
│              (src/tools/ToolExecutor.ts)                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐ │
│  │ FileSystem │ │  Command   │ │   Cron     │ │  Skills   │ │
│  └────────────┘ └────────────┘ └────────────┘ └───────────┘ │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Provider Layer                            │
│              (src/provider/llm.ts)                           │
│         (Ollama, DeepSeek, etc.)                             │
└─────────────────────────────────────────────────────────────┘
```

### 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **Agent Loop** | `src/agent/loop.ts` | 事件驱动的消息处理器，协调 LLM 对话和工具调用 |
| **Tool Executor** | `src/tools/ToolExecutor.ts` | 工具注册、执行和错误处理 |
| **Event Bus** | `src/bus/instance.ts` | 基于 mitt 的事件总线，解耦模块通信 |
| **Session Manager** | `src/session/` | 会话管理和消息持久化 |
| **Config Manager** | `src/config/manager.ts` | 配置加载和工作区初始化 |
| **Provider** | `src/provider/llm.ts` | LLM 提供商抽象层 |
| **Gateway** | `src/gateway/` | 外部请求入口和路由 |
| **Channels** | `src/channels/` | 不同通信渠道实现 |

### 内置工具

- **FileSystemTools**: 文件系统操作（读/写/删除等）
- **CommandTools**: 系统命令执行
- **CronTool**: 定时任务管理
- **SkillTools**: 技能系统扩展
- **SpawnTool**: 子进程生成

---

## 构建和运行

### 安装依赖

```bash
pnpm install
```

### 开发

```bash
# 使用 ts-node 直接运行（开发模式）
pnpm dev

# 构建项目
pnpm build

# 运行 Web 服务器
pnpm web
```

### 测试

```bash
# 运行所有测试
pnpm test

# 运行测试 UI
pnpm test:ui

# 监视模式运行测试
pnpm test:watch
```

### 代码质量

```bash
# Lint 检查
pnpm lint

# 自动修复 lint 问题
pnpm lint:fix

# 格式化代码
pnpm fmt
```

### 构建产物

构建后输出到 `dist/` 目录：

- `dist/index.js` - 主入口
- `dist/cli/index.mjs` - CLI 可执行文件
- `dist/agent/loop.mjs` - Agent Loop 模块
- `dist/provider/llm.mjs` - LLM Provider 模块
- 等等...

---

## 开发规范

### 项目结构

```
roxy/
├── src/
│   ├── agent/          # Agent 核心逻辑
│   ├── bus/            # 事件总线
│   ├── channels/       # 通信渠道
│   ├── cli/            # CLI 命令
│   ├── config/         # 配置管理
│   ├── cron/           # 定时任务
│   ├── gateway/        # 网关层
│   ├── provider/       # LLM 提供商
│   ├── session/        # 会话管理
│   ├── skills/         # 技能系统
│   ├── tools/          # 工具实现
│   ├── types/          # TypeScript 类型定义
│   └── utils/          # 工具函数
├── tests/              # 测试文件
├── .roxy/              # 运行时数据
│   ├── config.json     # 用户配置
│   ├── sessions/       # 会话存储
│   └── workspace/      # 工作区文件
└── dist/               # 构建输出
```

### 编码风格

- **模块系统**: ES Modules (`"type": "module"`)
- **目标环境**: ES2020
- **模块解析**: `bundler` 模式
- **错误处理**: 使用 `RoxyError` 统一错误类型
- **日志**: 使用 `log`/`logError` 工具函数

### 事件命名约定

事件总线使用 `namespace:action` 格式：

- `agent:execute` - 执行任务
- `agent:response` - 响应返回
- `agent:stream` - 流式数据
- `agent:tool_call` - 工具调用
- `agent:tool_result` - 工具结果
- `subagent:complete` - 子代理完成
- `error` - 错误事件

### 测试实践

- 测试文件位于 `tests/` 目录
- 使用 Vitest 框架
- 测试文件命名：`*.test.ts`
- 测试工具调用相关的功能时使用 mock

### 配置管理

配置文件位于 `~/.roxy/config.json`，统一管理所有配置：

```json
{
  "workspace": "~/.roxy/workspace",
  "sessionDir": "~/.roxy/sessions",
  "agents": {
    "defaults": {
      "model": "ollama/qwen3.5:9b"
    },
    "list": [
      {
        "id": "main-agent",
        "role": "main",
        "model": "ollama/qwen3.5:9b"
      }
    ]
  },
  "providers": {
    "deepseek": {
      "apiKey": "",
      "baseURL": "https://api.deepseek.com"
    },
    "ollama": {
      "apiKey": "ollama-local",
      "baseURL": "http://localhost:11434/v1"
    }
  },
  "heartbeat": {
    "enabled": true,
    "interval": 1800
  },
  "cron": {
    "enabled": true
  },
  "channels": {
    "cli": {
      "id": "cli",
      "enabled": true
    }
  }
}
```

**配置说明**：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `workspace` | 工作区路径 | `~/.roxy/workspace` |
| `sessionDir` | 会话存储路径 | `~/.roxy/sessions` |
| `agents.defaults.model` | 默认模型 | `ollama/qwen3.5:9b` |
| `agents.list` | 自定义 Agent 列表 | - |
| `providers` | LLM Provider 配置 | - |
| `heartbeat.enabled` | 是否启用心跳 | `true` |
| `heartbeat.interval` | 心跳间隔（秒） | `1800` (30 分钟) |
| `cron.enabled` | 是否启用 Cron | `true` |
| `channels` | Channel 配置 | - |

### 工作区文件

初始化后，`~/.roxy/workspace/` 包含：

- `AGENT.md` - Agent 行为指南
- `SOUL.md` - AI 人格定义
- `USER.md` - 用户偏好设置
- `MEMORY.md` - 重要信息存储
- `HISTORY.md` - 追加式事件日志

---

## 关键设计决策

1. **事件驱动架构**: 使用事件总线解耦各模块，支持异步和并发处理
2. **工具显式注册**: 工具不自动扫描，由 Gateway 显式注册，增强可控性
3. **统一错误处理**: 使用 `RoxyError` 封装所有错误，便于分类和处理
4. **会话持久化**: 所有对话和工具调用结果保存到 session，支持上下文恢复
5. **流式响应**: 支持 LLM 流式输出，实时反馈给用户
