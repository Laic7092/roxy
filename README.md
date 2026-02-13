# Roxy

Roxy 是一个 AI 助手

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

### 交互式对话

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

## 命令

### `onboard`

初始化工作区和配置文件：

```bash
roxy onboard [options]
```

选项:
- `-f, --force` - 强制重新初始化，即使配置已存在

### `agent`

启动交互式 AI 代理：

```bash
roxy agent [options]
```

选项:
- `-s, --session <sessionId>` - 指定要使用的会话 ID（默认为 "default"）
- `-c, --clear` - 清除当前会话历史

## 配置

配置文件位于 `~/.roxy/config.json`，示例配置如下：

```json
{
  "workspace": "/home/user/.roxy/workspace",
  "agents": {
    "defaults": {
      "model": "deepseek/deepseek-chat"
    }
  },
  "providers": {
    "deepseek": {
      "apiKey": "your-api-key-here",
      "baseURL": "https://api.deepseek.com"
    }
  }
}
```

## 开发

如果您想为 Roxy 贡献代码：

1. 克隆仓库
2. 运行 `pnpm install`
3. 运行 `pnpm build` 构建项目
4. 运行 `pnpm test` 执行测试

## 许可证

ISC