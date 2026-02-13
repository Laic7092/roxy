import { readFile, writeFile, listDir, getWorkspace } from './FileSystemTools';
import { v4 as uuidv4 } from 'uuid';

export interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
  execute: (args: any, workspace: string) => Promise<any>;
}

export class ToolExecutor {
  private tools: Map<string, ToolFunction> = new Map();
  private workspace: string;

  constructor(workspace: string) {
    this.workspace = workspace;
    this.registerDefaultTools();
  }

  private registerDefaultTools() {
    // 注册文件读取工具
    this.tools.set('readFile', {
      name: 'readFile',
      description: 'Read content from a file in the workspace',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file to read (relative to workspace)'
          }
        },
        required: ['filePath']
      },
      execute: async (args: { filePath: string }, workspace: string) => {
        return await readFile(args.filePath, workspace);
      }
    });

    // 注册文件写入工具
    this.tools.set('writeFile', {
      name: 'writeFile',
      description: 'Write content to a file in the workspace',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file to write (relative to workspace)'
          },
          content: {
            type: 'string',
            description: 'Content to write to the file'
          }
        },
        required: ['filePath', 'content']
      },
      execute: async (args: { filePath: string; content: string }, workspace: string) => {
        return await writeFile(args.filePath, args.content, workspace);
      }
    });

    // 注册列出目录内容工具
    this.tools.set('listDir', {
      name: 'listDir',
      description: 'List contents of a directory in the workspace',
      parameters: {
        type: 'object',
        properties: {
          dirPath: {
            type: 'string',
            description: 'Path to the directory to list (relative to workspace, optional, defaults to workspace root)'
          }
        },
        required: []
      },
      execute: async (args: { dirPath?: string }, workspace: string) => {
        return await listDir(args.dirPath || '.', workspace);
      }
    });

    // 注册获取工作空间路径工具
    this.tools.set('getWorkspace', {
      name: 'getWorkspace',
      description: 'Get the current workspace path',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      execute: async (_, workspace: string) => {
        return { success: true, workspace: getWorkspace(workspace) };
      }
    });
  }

  /**
   * 获取所有可用工具的定义
   */
  getToolDefinitions(): any[] {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  /**
   * 执行指定的工具
   * @param toolName 工具名称
   * @param arguments 参数
   * @param providedId 如果AI提供了ID则使用该ID，否则生成新ID
   */
  async executeTool(toolName: string, argumentsObj: any, providedId?: string): Promise<{ result: any; tool_call_id: string }> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        result: { success: false, error: `Tool '${toolName}' not found` },
        tool_call_id: providedId || `call_${uuidv4()}`
      };
    }

    try {
      const { success, ...rest } = await tool.execute(argumentsObj, this.workspace);
      return {
        result: Object.entries(rest)[0] ? Object.entries(rest)[0][1] : 'suc',
        tool_call_id: providedId || `call_${uuidv4()}`
      };
    } catch (error) {
      return {
        result: { success: false, error: error.message },
        tool_call_id: providedId || `call_${uuidv4()}`
      };
    }
  }

  /**
   * 执行多个工具调用
   * @param toolCalls 工具调用数组，每个元素包含name, arguments和可选的id
   */
  async executeTools(toolCalls: Array<{ name: string; arguments: string; id?: string }>): Promise<Array<{
    result: any;
    tool_call_id: string;
    name: string;
  }>> {
    const results = await Promise.all(
      toolCalls.map(async ({ name, arguments: argsStr, id }) => {
        try {
          const args = JSON.parse(argsStr);
          const { result, tool_call_id } = await this.executeTool(name, args, id);

          return {
            result,
            tool_call_id,
            name
          };
        } catch (error) {
          return {
            result: { success: false, error: `Invalid arguments for tool '${name}': ${error.message}` },
            tool_call_id: id || `call_${uuidv4()}`,
            name
          };
        }
      })
    );

    return results;
  }
}