import { describe, it, expect, beforeEach } from 'vitest'
import { ToolExecutor } from '../src/tools/ToolExecutor'
import { fileSystemTools } from '../src/tools/FileSystemTools'

describe('ToolExecutor', () => {
  let toolExecutor: ToolExecutor

  beforeEach(async () => {
    toolExecutor = new ToolExecutor('/mock/workspace')
    await toolExecutor.initialize()
    // 注册基础工具
    toolExecutor.registerTools([...fileSystemTools])
  })

  it('should return tool definitions', async () => {
    const tools = await toolExecutor.getToolDefinitions()

    expect(tools).toBeDefined()
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0)

    const toolNames = tools.map((tool) => tool.function.name)
    expect(toolNames).toContain('readFile')
    expect(toolNames).toContain('writeFile')
    expect(toolNames).toContain('listDir')
    expect(toolNames).toContain('getWorkspace')
  })

  it('should execute readFile tool', async () => {
    const tools = await toolExecutor.getToolDefinitions()
    const readFileTool = tools.find((tool) => tool.function.name === 'readFile')

    expect(readFileTool).toBeDefined()
    expect(readFileTool.function.parameters.properties.filePath).toBeDefined()
  })

  it('should execute writeFile tool', async () => {
    const tools = await toolExecutor.getToolDefinitions()
    const writeFileTool = tools.find((tool) => tool.function.name === 'writeFile')

    expect(writeFileTool).toBeDefined()
    expect(writeFileTool.function.parameters.properties.filePath).toBeDefined()
    expect(writeFileTool.function.parameters.properties.content).toBeDefined()
  })

  it('should execute listDir tool', async () => {
    const tools = await toolExecutor.getToolDefinitions()
    const listDirTool = tools.find((tool) => tool.function.name === 'listDir')

    expect(listDirTool).toBeDefined()
  })

  it('should execute getWorkspace tool', async () => {
    const tools = await toolExecutor.getToolDefinitions()
    const getWorkspaceTool = tools.find((tool) => tool.function.name === 'getWorkspace')

    expect(getWorkspaceTool).toBeDefined()
  })
})
