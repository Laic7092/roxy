# Roxy

> AI Assistant CLI & Framework

一个基于事件驱动的 AI 助手框架，支持多 LLM 提供商、工具调用和会话管理。

## ✨ 特性

- 🚀 **事件驱动架构** - 基于事件总线的模块化设计
- 🛠️ **工具系统** - 内置文件系统、命令执行、定时任务等工具
- 💬 **会话管理** - 持久化会话和历史记录
- 🔌 **多 LLM 支持** - Ollama、DeepSeek 等提供商
- 🎯 **技能扩展** - 可扩展的技能系统
- 📦 **CLI 工具** - 命令行界面，易于集成

## 📦 安装

```bash
# 克隆项目
git clone <repository-url>
cd roxy

# 安装依赖
pnpm install

# 构建
pnpm build
```

## 🚀 快速开始

### CLI 使用

```bash
# 初始化配置
pnpm build
node dist/cli/index.mjs
```

### 作为库使用

```typescript
import { AgentLoop } from './src/agent/loop'
import { ToolExecutor } from './src/tools/ToolExecutor'
import { Bus } from './src/bus/instance'

// 创建实例
const bus = new Bus()
const toolExecutor = new ToolExecutor(workspacePath)
const agent = new AgentLoop({ config, provider, toolExecutor, bus, context, sessionManager })
```

## 📁 项目结构

```
roxy/
├── src/
│   ├── agent/       # Agent 核心逻辑
│   ├── bus/         # 事件总线
│   ├── cli/         # CLI 命令
│   ├── config/      # 配置管理
│   ├── gateway/     # 网关层
│   ├── provider/    # LLM 提供商
│   ├── session/     # 会话管理
│   ├── tools/       # 工具实现
│   └── utils/       # 工具函数
├── tests/           # 测试文件
└── .roxy/           # 运行时数据
```

## 🛠️ 开发命令

```bash
pnpm dev          # 开发模式
pnpm build        # 构建项目
pnpm test         # 运行测试
pnpm lint         # 代码检查
pnpm fmt          # 格式化代码
```

## 📖 文档

- [QWEN.md](./QWEN.md) - 详细的开发文档和架构说明

## 📄 许可证

ISC
