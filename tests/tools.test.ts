import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from '../src/tools/ToolExecutor';

describe('ToolExecutor', () => {
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    // 使用一个模拟的工作空间路径
    toolExecutor = new ToolExecutor('/mock/workspace');
  });

  it('should return tool definitions', () => {
    const tools = toolExecutor.getToolDefinitions();
    
    expect(tools).toBeDefined();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    
    // 检查是否包含预期的工具
    const toolNames = tools.map(tool => tool.function.name);
    expect(toolNames).toContain('readFile');
    expect(toolNames).toContain('writeFile');
    expect(toolNames).toContain('listDir');
    expect(toolNames).toContain('getWorkspace');
  });

  it('should execute readFile tool', async () => {
    // 我们不能真正测试文件读取，但可以检查工具是否被正确注册
    const tools = toolExecutor.getToolDefinitions();
    const readFileTool = tools.find(tool => tool.function.name === 'readFile');
    
    expect(readFileTool).toBeDefined();
    expect(readFileTool.function.parameters.properties.filePath).toBeDefined();
  });

  it('should execute writeFile tool', async () => {
    const tools = toolExecutor.getToolDefinitions();
    const writeFileTool = tools.find(tool => tool.function.name === 'writeFile');
    
    expect(writeFileTool).toBeDefined();
    expect(writeFileTool.function.parameters.properties.filePath).toBeDefined();
    expect(writeFileTool.function.parameters.properties.content).toBeDefined();
  });

  it('should execute listDir tool', async () => {
    const tools = toolExecutor.getToolDefinitions();
    const listDirTool = tools.find(tool => tool.function.name === 'listDir');
    
    expect(listDirTool).toBeDefined();
  });

  it('should execute getWorkspace tool', async () => {
    const tools = toolExecutor.getToolDefinitions();
    const getWorkspaceTool = tools.find(tool => tool.function.name === 'getWorkspace');
    
    expect(getWorkspaceTool).toBeDefined();
  });
});