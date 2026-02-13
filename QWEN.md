# Roxy 项目说明

## 项目概述

Roxy 是一个 AI 助手，允许用户通过命令行与 AI 模型进行交互。该项目采用 TypeScript 编写，具有模块化的架构，支持会话管理、流式响应等功能。

主要特性：
- 交互式对话模式
- 会话持久化
- 流式响应显示
- 配置管理
- 工作空间管理
- 彩色终端输出
- 加载指示器
- 命令支持（/help, /clear, /history等）
- 改进的错误处理和重试机制

## 项目结构

```
roxy/
├── src/                 # 源代码目录
│   ├── agent/          # AI 代理相关逻辑
│   ├── bus/            # 事件总线
│   ├── cli/            # CLI 命令实现
│   ├── config/         # 配置管理
│   ├── provider/       # LLM 提供商抽象
│   ├── session/        # 会话管理
│   └── types/          # 类型定义
├── tests/              # 测试文件
├── package.json        # 项目配置
├── tsconfig.json       # TypeScript 配置
├── tsdown.config.ts    # 构建配置
└── README.md           # 项目文档
```

## 核心组件

### CLI 层 (`src/cli/`)
- 使用 `commander` 库实现命令行界面
- 提供 `onboard` 和 `agent` 命令
- 负责用户输入处理和输出显示
- 支持交互式命令（如 `/help`, `/clear`, `/history`, `/exit`）
- 使用 `readline` 库提供更好的输入体验

### Agent 层 (`src/agent/`)
- `AgentLoop` 类处理消息循环和与 LLM 的交互
- `ContextMng` 管理对话上下文
- `Memory` 和 `Skill` 管理长期记忆和技能

### Provider 层 (`src/provider/`)
- `LLMProvider` 抽象基类定义接口
- `LiteLLMProvider` 实现具体的 LLM 调用
- 支持流式响应处理

### 会话管理 (`src/session/`)
- `Session` 类管理单个会话的消息历史
- `SessionManager` 管理多个会话的持久化

## 关键功能实现

### 流式响应
- 在 `Ctx` 接口中定义 `onStreamData` 回调函数
- `LiteLLMProvider` 在流式模式下调用此回调传递数据片段
- CLI 层提供回调函数将数据输出到控制台
- 这种设计实现了关注点分离，LLMProvider 不直接依赖控制台输出

### 交互式体验增强
- 使用 `chalk` 库为终端输出添加颜色，区分用户和AI的回复
- 使用 `ora` 库添加加载指示器，在AI处理请求时显示"Thinking"状态
- 实现了命令支持（如 `/help`, `/clear`, `/history`, `/exit`），提升用户交互体验
- 添加了错误处理和重试机制，提高系统健壮性
- 使用 `readline` 库提供更好的输入体验和命令行交互

### 配置管理
- 配置文件位于 `~/.roxy/config.json`
- 包含工作空间路径、默认模型和提供商配置
- `onboard` 命令初始化配置和工作空间文件

## 构建和运行

### 构建项目
```bash
npm run build
# 或
pnpm build
```

### 运行测试
```bash
npm run test
# 或
pnpm test
```

### 开发模式
```bash
npm run dev
# 或
pnpm dev
```

### 安装和使用
```bash
# 全局安装
npm install -g roxy
# 或
pnpm add -g roxy

# 初始化配置
roxy onboard

# 启动交互式会话
roxy agent
```

## 开发约定

### 类型安全
- 项目使用 TypeScript，所有核心接口都有类型定义
- 在 `src/types/global.d.ts` 中定义全局类型

### 架构模式
- 遵循关注点分离原则
- LLMProvider 只负责 API 通信，不处理 UI 输出
- 使用回调函数在不同层级间传递数据

### UI/UX 增强
- 使用 `chalk` 库为终端输出添加颜色，提升用户体验
- 使用 `ora` 库实现加载指示器，提供视觉反馈
- 使用 `readline` 库改善命令行交互体验
- 实现命令支持（如 `/help`, `/clear`, `/history`），增强交互性

### 代码风格
- 使用 ES2020+ 特性
- 遵循现代 TypeScript 最佳实践
- 使用模块化设计便于扩展和维护

## 扩展性

项目设计具有良好的扩展性：
- 新的 LLM 提供商可以通过继承 `LLMProvider` 基类实现
- 新的 CLI 命令可以轻松添加到 CLI 层
- 会话管理系统支持多会话管理
- 上下文管理器可以轻松扩展以包含更多上下文信息