import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolExecutor } from '../src/tools/ToolExecutor';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('ToolExecutor FileSystem Operations', () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roxy-test-'));
    workspaceDir = path.join(tempDir, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    // 清理临时目录
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should execute readFile tool', async () => {
    // 创建一个测试文件在工作空间内
    const testFilePath = path.join(workspaceDir, 'test.txt');
    const testContent = 'Hello, this is a test file!';
    fs.writeFileSync(testFilePath, testContent, 'utf-8');

    // 创建ToolExecutor实例，使用临时工作空间
    const toolExecutor = new ToolExecutor(workspaceDir);

    // 执行readFile工具（使用相对于工作空间的路径）
    const result = await toolExecutor.executeTool('readFile', { filePath: 'test.txt' });

    expect(result).toHaveProperty('result');
    expect(result.result.success).toBe(true);
    expect(result.result.content).toBe(testContent);
  });

  it('should execute writeFile tool', async () => {
    const testFilePath = 'write-test.txt'; // 相对于工作空间的路径
    const testContent = 'This is content written by writeFile tool';

    // 创建ToolExecutor实例，使用临时工作空间
    const toolExecutor = new ToolExecutor(workspaceDir);

    // 执行writeFile工具
    const result = await toolExecutor.executeTool('writeFile', { 
      filePath: testFilePath, 
      content: testContent 
    });

    expect(result).toHaveProperty('result');
    expect(result.result.success).toBe(true);

    // 验证文件是否已创建且内容正确
    const fullFilePath = path.join(workspaceDir, testFilePath);
    const fileContent = fs.readFileSync(fullFilePath, 'utf-8');
    expect(fileContent).toBe(testContent);
  });

  it('should execute listDir tool', async () => {
    // 在工作空间中创建一些文件
    fs.writeFileSync(path.join(workspaceDir, 'file1.txt'), 'content1', 'utf-8');
    fs.writeFileSync(path.join(workspaceDir, 'file2.txt'), 'content2', 'utf-8');
    fs.mkdirSync(path.join(workspaceDir, 'subdir'));

    // 创建ToolExecutor实例，使用临时工作空间
    const toolExecutor = new ToolExecutor(workspaceDir);

    // 执行listDir工具
    const result = await toolExecutor.executeTool('listDir', { dirPath: '.' }); // 相对于工作空间的路径

    expect(result).toHaveProperty('result');
    expect(result.result.success).toBe(true);
    expect(Array.isArray(result.result.files)).toBe(true);
    expect(result.result.files).toContain('file1.txt');
    expect(result.result.files).toContain('file2.txt');
    expect(result.result.files).toContain('subdir');
  });

  it('should execute getWorkspace tool', async () => {
    // 创建ToolExecutor实例，使用临时工作空间
    const toolExecutor = new ToolExecutor(workspaceDir);

    // 执行getWorkspace工具
    const result = await toolExecutor.executeTool('getWorkspace', {});

    expect(result).toHaveProperty('result');
    expect(result.result.success).toBe(true);
    expect(result.result.workspace).toBe(workspaceDir);
  });

  it('should handle errors when reading non-existent file', async () => {
    // 创建ToolExecutor实例，使用临时工作空间
    const toolExecutor = new ToolExecutor(workspaceDir);

    // 执行readFile工具尝试读取不存在的文件
    const result = await toolExecutor.executeTool('readFile', { filePath: 'non-existent-file.txt' });

    expect(result).toHaveProperty('result');
    expect(result.result.success).toBe(false);
    expect(result.result.error).toBeDefined();
  });

  it('should prevent path traversal attacks', async () => {
    // 创建ToolExecutor实例，使用临时工作空间
    const toolExecutor = new ToolExecutor(workspaceDir);

    // 尝试使用路径遍历访问工作空间外的文件
    const result = await toolExecutor.executeTool('readFile', { filePath: '../etc/passwd' });

    expect(result).toHaveProperty('result');
    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('Access denied');
  });

  it('should execute multiple tools in sequence', async () => {
    // 创建ToolExecutor实例，使用临时工作空间
    const toolExecutor = new ToolExecutor(workspaceDir);

    // 执行一系列工具调用
    const toolsToExecute = [
      { name: 'getWorkspace', arguments: {} },
      { name: 'writeFile', arguments: { filePath: 'multi-test.txt', content: 'Multi-tool test' } },
      { name: 'readFile', arguments: { filePath: 'multi-test.txt' } }
    ];

    const results = await toolExecutor.executeTools(toolsToExecute);

    expect(results).toHaveLength(3);
    
    // 检查每个结果
    expect(results[0].name).toBe('getWorkspace');
    expect(results[0].result.success).toBe(true);
    expect(results[0].result.workspace).toBe(workspaceDir);
    
    expect(results[1].name).toBe('writeFile');
    expect(results[1].result.success).toBe(true);
    
    expect(results[2].name).toBe('readFile');
    expect(results[2].result.success).toBe(true);
    expect(results[2].result.content).toBe('Multi-tool test');
  });
});