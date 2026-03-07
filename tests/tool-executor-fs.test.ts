import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ToolExecutor } from '../src/tools/ToolExecutor'
import { fileSystemTools } from '../src/tools/FileSystemTools'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

describe('ToolExecutor FileSystem Operations', () => {
  let tempDir: string
  let workspaceDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roxy-test-'))
    workspaceDir = path.join(tempDir, 'workspace')
    fs.mkdirSync(workspaceDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should execute readFile tool', async () => {
    const testFilePath = path.join(workspaceDir, 'test.txt')
    const testContent = 'Hello, this is a test file!'
    fs.writeFileSync(testFilePath, testContent, 'utf-8')

    const toolExecutor = new ToolExecutor(workspaceDir)
    await toolExecutor.initialize()
    toolExecutor.registerTools([...fileSystemTools])

    const result = await toolExecutor.executeTool('readFile', { filePath: 'test.txt' })

    console.log('readFile result:', result)
    expect(result).toHaveProperty('result')
    const parsedResult = JSON.parse(result.result as string)
    expect(parsedResult.success).toBe(true)
    expect(parsedResult.content).toBe(testContent)
  })

  it('should execute writeFile tool', async () => {
    const testFilePath = 'write-test.txt'
    const testContent = 'This is content written by writeFile tool'

    const toolExecutor = new ToolExecutor(workspaceDir)
    await toolExecutor.initialize()
    toolExecutor.registerTools([...fileSystemTools])

    const result = await toolExecutor.executeTool('writeFile', {
      filePath: testFilePath,
      content: testContent,
    })

    expect(result).toHaveProperty('result')
    const parsedResult = JSON.parse(result.result as string)
    expect(parsedResult.success).toBe(true)

    const fullFilePath = path.join(workspaceDir, testFilePath)
    const fileContent = fs.readFileSync(fullFilePath, 'utf-8')
    expect(fileContent).toBe(testContent)
  })

  it('should execute listDir tool', async () => {
    fs.writeFileSync(path.join(workspaceDir, 'file1.txt'), 'content1', 'utf-8')
    fs.writeFileSync(path.join(workspaceDir, 'file2.txt'), 'content2', 'utf-8')
    fs.mkdirSync(path.join(workspaceDir, 'subdir'))

    const toolExecutor = new ToolExecutor(workspaceDir)
    await toolExecutor.initialize()
    toolExecutor.registerTools([...fileSystemTools])

    const result = await toolExecutor.executeTool('listDir', { dirPath: '.' })

    expect(result).toHaveProperty('result')
    const parsedResult = JSON.parse(result.result as string)
    expect(parsedResult.success).toBe(true)
    expect(Array.isArray(parsedResult.files)).toBe(true)
    expect(parsedResult.files).toContain('file1.txt')
    expect(parsedResult.files).toContain('file2.txt')
    expect(parsedResult.files).toContain('subdir')
  })

  it('should execute getWorkspace tool', async () => {
    const toolExecutor = new ToolExecutor(workspaceDir)
    await toolExecutor.initialize()
    toolExecutor.registerTools([...fileSystemTools])

    const result = await toolExecutor.executeTool('getWorkspace', {})

    expect(result).toHaveProperty('result')
    const parsedResult = JSON.parse(result.result as string)
    expect(parsedResult.success).toBe(true)
    expect(parsedResult.workspace).toBe(workspaceDir)
  })

  it('should handle errors when reading non-existent file', async () => {
    const toolExecutor = new ToolExecutor(workspaceDir)
    await toolExecutor.initialize()
    toolExecutor.registerTools([...fileSystemTools])

    const result = await toolExecutor.executeTool('readFile', {
      filePath: 'non-existent-file.txt',
    })

    expect(result).toHaveProperty('result')
    const parsedResult = JSON.parse(result.result as string)
    expect(parsedResult.success).toBe(false)
    expect(parsedResult.error).toBeDefined()
  })

  it('should prevent path traversal attacks', async () => {
    const toolExecutor = new ToolExecutor(workspaceDir)
    await toolExecutor.initialize()
    toolExecutor.registerTools([...fileSystemTools])

    const result = await toolExecutor.executeTool('readFile', { filePath: '../etc/passwd' })

    expect(result).toHaveProperty('result')
    const parsedResult = JSON.parse(result.result as string)
    expect(parsedResult.success).toBe(false)
    expect(parsedResult.error).toContain('Access denied')
  })

  it('should execute multiple tools in sequence', async () => {
    const toolExecutor = new ToolExecutor(workspaceDir)
    await toolExecutor.initialize()
    toolExecutor.registerTools([...fileSystemTools])

    // 先写入文件
    const writeResult = await toolExecutor.executeTool('writeFile', {
      filePath: 'multi-test.txt',
      content: 'Multi-tool test',
    })
    const parsedWrite = JSON.parse(writeResult.result as string)
    expect(parsedWrite.success).toBe(true)

    // 然后读取文件
    const readResult = await toolExecutor.executeTool('readFile', {
      filePath: 'multi-test.txt',
    })
    const parsedRead = JSON.parse(readResult.result as string)
    expect(parsedRead.success).toBe(true)
    expect(parsedRead.content).toBe('Multi-tool test')

    // 最后获取工作空间
    const workspaceResult = await toolExecutor.executeTool('getWorkspace', {})
    const parsedWorkspace = JSON.parse(workspaceResult.result as string)
    expect(parsedWorkspace.success).toBe(true)
    expect(parsedWorkspace.workspace).toBe(workspaceDir)
  })
})
