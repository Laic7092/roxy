import { kMaxLength } from 'buffer'
import { readdir, stat } from 'fs/promises'
import { join, extname, basename, dirname } from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface ToolFunction {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
  execute: (args: any, workspace: string) => Promise<any>
}

export class ToolExecutor {
  private tools: Map<string, ToolFunction> = new Map()
  private workspace: string

  constructor(workspace: string) {
    this.workspace = workspace
    // 异步初始化工具注册，不阻塞构造函数
    this.initializeTools(__dirname)
  }

  /**
   * 初始化工具注册
   */
  private async initializeTools(toolsDir: string) {
    await this.autoRegisterTools(toolsDir)
  }

  /**
   * 自动扫描并注册工具目录下的所有工具
   */
  async autoRegisterTools(toolsDir: string) {
    try {
      const files = await readdir(toolsDir)

      for (const file of files) {
        const filePath = join(toolsDir, file)
        const stats = await stat(filePath)

        if (stats.isDirectory()) {
          // 递归扫描子目录
          await this.autoRegisterTools(filePath)
        } else if (
          stats.isFile() &&
          (extname(file) === '.ts' ||
            extname(file) === '.js' ||
            extname(file) === '.mjs' ||
            extname(file) === '.cjs')
        ) {
          // 跳过自身和其他非工具文件
          if (
            basename(file, extname(file)) !== 'ToolExecutor' &&
            basename(file, extname(file)) !== 'index' &&
            basename(file, extname(file)) !== 'ToolRegistry' &&
            basename(file, extname(file)) !== 'ToolRegistrar'
          ) {
            try {
              // 动态导入工具文件
              const module = await import(`file://${filePath}`)

              // 查找导出的工具函数
              for (const key in module) {
                const exportedItem = module[key]

                // 检查是否为工具函数格式
                if (this.isToolFunctionFormat(exportedItem)) {
                  if (this.tools.has(exportedItem.name)) {
                    console.warn(
                      `Tool ${exportedItem.name} is already registered and will be overwritten.`,
                    )
                  }
                  this.tools.set(exportedItem.name, exportedItem)
                }

                // 检查是否为工具数组
                if (Array.isArray(exportedItem) && exportedItem.length > 0) {
                  for (const tool of exportedItem) {
                    if (this.isToolFunctionFormat(tool)) {
                      if (this.tools.has(tool.name)) {
                        console.warn(
                          `Tool ${tool.name} is already registered and will be overwritten.`,
                        )
                      }
                      this.tools.set(tool.name, tool)
                    }
                  }
                }
              }
            } catch (importError) {
              console.error(`Error importing tool file ${filePath}:`, importError)
            }
          }
        }
      }
    } catch (error) {
      console.error('Error auto-registering tools:', error)
    }
  }

  /**
   * 检查对象是否符合工具函数格式
   */
  private isToolFunctionFormat(obj: any): obj is ToolFunction {
    return (
      obj &&
      typeof obj.name === 'string' &&
      typeof obj.description === 'string' &&
      obj.parameters &&
      typeof obj.execute === 'function'
    )
  }

  /**
   * 获取所有可用工具的定义
   */
  getToolDefinitions(): any[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }

  /**
   * 执行指定的工具
   * @param toolName 工具名称
   * @param argumentsObj 参数对象
   * @param providedId 如果AI提供了ID则使用该ID，否则生成新ID
   */
  async executeTool(
    toolName: string,
    argumentsObj: any,
    providedId?: string,
  ): Promise<{ result: any; tool_call_id: string }> {
    const tool = this.tools.get(toolName)

    if (!tool) {
      return {
        result: { success: false, error: `Tool '${toolName}' not found` },
        tool_call_id: providedId || `call_${uuidv4()}`,
      }
    }

    try {
      const { success, ...rest } = await tool.execute(argumentsObj, this.workspace)
      return {
        result: Object.entries(rest)[0]
          ? this.formatToolOutput(Object.entries(rest)[0][1])
          : 'success',
        tool_call_id: providedId || `call_${uuidv4()}`,
      }
    } catch (error) {
      return {
        result: { success: false, error: error.message },
        tool_call_id: providedId || `call_${uuidv4()}`,
      }
    }
  }

  /**
   * 执行多个工具调用
   * @param toolCalls 工具调用数组，每个元素包含name, arguments和可选的id
   */
  async executeTools(toolCalls: Array<{ name: string; arguments: string; id?: string }>): Promise<
    Array<{
      result: any
      tool_call_id: string
      name: string
    }>
  > {
    const results = await Promise.all(
      toolCalls.map(async ({ name, arguments: argsStr, id }) => {
        try {
          const args = JSON.parse(argsStr)
          const { result, tool_call_id } = await this.executeTool(name, args, id)

          return {
            result,
            tool_call_id,
            name,
          }
        } catch (error) {
          return {
            result: {
              success: false,
              error: `Invalid arguments for tool '${name}': ${error.message}`,
            },
            tool_call_id: id || `call_${uuidv4()}`,
            name,
          }
        }
      }),
    )

    return results
  }

  formatToolOutput(output: unknown): string {
    if (output === null || output === undefined) {
      return ''
    }

    if (typeof output === 'string') {
      return output
    }

    if (typeof output === 'object') {
      return JSON.stringify(output, null, 2)
    }

    return String(output)
  }

  /**
   * 注册新工具
   * @param toolDefinition 工具定义
   * @returns 是否注册成功
   */
  registerTool(toolDefinition: ToolFunction): boolean {
    if (this.tools.has(toolDefinition.name)) {
      console.warn(`Tool ${toolDefinition.name} is already registered and will be overwritten.`)
    }

    this.tools.set(toolDefinition.name, toolDefinition)
    return true
  }

  /**
   * 注销工具
   * @param toolName 工具名称
   * @returns 是否注销成功
   */
  unregisterTool(toolName: string): boolean {
    return this.tools.delete(toolName)
  }
}
