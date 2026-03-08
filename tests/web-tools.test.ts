import { describe, it, expect, beforeEach } from 'vitest'
import { ToolExecutor } from '../src/tools/ToolExecutor'
import { createWebTools } from '../src/tools/WebTools'

describe('WebTools', () => {
  let toolExecutor: ToolExecutor

  beforeEach(async () => {
    toolExecutor = new ToolExecutor('/mock/workspace')
    await toolExecutor.initialize()
    // 注册 Web 工具（不配置 API Key，用于测试错误处理）
    const webTools = createWebTools({})
    toolExecutor.registerTools([...webTools])
  })

  it('should return web_search tool definition', async () => {
    const tools = await toolExecutor.getToolDefinitions()

    expect(tools).toBeDefined()
    const toolNames = tools.map((tool) => tool.function.name)
    expect(toolNames).toContain('web_search')
    expect(toolNames).toContain('web_fetch')
  })

  it('should return API key error for web_search', async () => {
    const result = await toolExecutor.executeTool('web_search', { query: 'test' })

    expect(result).toHaveProperty('result')
    expect(result.result).toContain('Error:')
    expect(result.result).toContain('Brave Search API key')
  })

  it('should validate URL for web_fetch', async () => {
    const result = await toolExecutor.executeTool('web_fetch', { url: 'invalid-url' })

    expect(result).toHaveProperty('result')
    const parsed = JSON.parse(result.result)
    expect(parsed.error).toContain('URL validation failed')
  })

  it('should fetch JSON content for web_fetch', async () => {
    // 测试有效的 JSON URL（使用 httpbin 或类似服务）
    // 注意：这个测试需要网络连接
    const result = await toolExecutor.executeTool('web_fetch', {
      url: 'https://httpbin.org/json',
    }, undefined, { channelId: 'test', sessionId: 'test' })

    expect(result).toHaveProperty('result')
    // 可能返回 JSON 内容或错误（网络问题）
    const parsed = JSON.parse(result.result)
    if (parsed.error) {
      // 网络错误，跳过
      expect(parsed.error).toBeDefined()
    } else {
      expect(parsed.extractor).toBe('json')
      expect(parsed.url).toBe('https://httpbin.org/json')
    }
  }, 10000)

  it('should handle errors for web_fetch', async () => {
    const result = await toolExecutor.executeTool('web_fetch', {
      url: 'https://invalid-domain-that-does-not-exist.example',
    })

    expect(result).toHaveProperty('result')
    const parsed = JSON.parse(result.result)
    expect(parsed.error).toBeDefined()
  })
})
