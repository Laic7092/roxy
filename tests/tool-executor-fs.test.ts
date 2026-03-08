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
    expect(result.result).toBe(testContent)
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
    expect(result.result).toBe(`File written: ${testFilePath}`)

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
    expect(result.result).toContain('file1.txt')
    expect(result.result).toContain('file2.txt')
    expect(result.result).toContain('subdir')
  })

  it('should execute getWorkspace tool', async () => {
    const toolExecutor = new ToolExecutor(workspaceDir)
    await toolExecutor.initialize()
    toolExecutor.registerTools([...fileSystemTools])

    const result = await toolExecutor.executeTool('getWorkspace', {})

    expect(result).toHaveProperty('result')
    expect(result.result).toBe(workspaceDir)
  })

  it('should handle errors when reading non-existent file', async () => {
    const toolExecutor = new ToolExecutor(workspaceDir)
    await toolExecutor.initialize()
    toolExecutor.registerTools([...fileSystemTools])

    const result = await toolExecutor.executeTool('readFile', {
      filePath: 'non-existent-file.txt',
    })

    expect(result).toHaveProperty('result')
    expect(result.result).toContain('Error:')
  })

  it('should prevent path traversal attacks', async () => {
    const toolExecutor = new ToolExecutor(workspaceDir)
    await toolExecutor.initialize()
    toolExecutor.registerTools([...fileSystemTools])

    const result = await toolExecutor.executeTool('readFile', { filePath: '../etc/passwd' })

    expect(result).toHaveProperty('result')
    expect(result.result).toContain('Error:')
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
    expect(writeResult.result).toContain('File written')

    // 然后读取文件
    const readResult = await toolExecutor.executeTool('readFile', {
      filePath: 'multi-test.txt',
    })
    expect(readResult.result).toBe('Multi-tool test')

    // 最后获取工作空间
    const workspaceResult = await toolExecutor.executeTool('getWorkspace', {})
    expect(workspaceResult.result).toBe(workspaceDir)
  })
})
