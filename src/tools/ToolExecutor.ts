import { readdir, stat } from 'fs/promises'
import { join, extname, basename, dirname } from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import { createLogger, LogLevel } from '../utils/logger'

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
  private logger: ReturnType<typeof createLogger>
  private initializationPromise: Promise<void>

  constructor(workspace: string) {
    this.workspace = workspace
    // 默认只显示 INFO 及以上级别的日志到控制台
    this.logger = createLogger(workspace, { 
      logToConsole: true,
      enabledLevels: [LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.SUCCESS]
    })
    // 初始化工具注册，并保存 Promise 以供后续等待
    this.initializationPromise = this.initializeTools(__dirname)
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
                    await this.logger.warn(
                      `Tool ${exportedItem.name} is already registered and will be overwritten.`,
                    )
                  }
                  this.tools.set(exportedItem.name, exportedItem)
                  await this.logger.debug(`Tool registered: ${exportedItem.name}`)
                }

                // 检查是否为工具数组
                if (Array.isArray(exportedItem) && exportedItem.length > 0) {
                  for (const tool of exportedItem) {
                    if (this.isToolFunctionFormat(tool)) {
                      if (this.tools.has(tool.name)) {
                        await this.logger.warn(
                          `Tool ${tool.name} is already registered and will be overwritten.`,
                        )
                      }
                      this.tools.set(tool.name, tool)
                      await this.logger.debug(`Tool registered: ${tool.name}`)
                    }
                  }
                }
              }
            } catch (importError) {
              await this.logger.error(`Error importing tool file ${filePath}`, {
                error: importError instanceof Error ? importError.message : String(importError),
              })
            }
          }
        }
      }

      await this.logger.debug(`Tool scanning completed. Total tools: ${this.tools.size}`)
    } catch (error) {
      await this.logger.error('Error auto-registering tools', {
        error: error instanceof Error ? error.message : String(error),
      })
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
  async getToolDefinitions(): Promise<any[]> {
    // 等待初始化完成
    await this.initializationPromise
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
   * @param providedId 如果 AI 提供了 ID 则使用该 ID，否则生成新 ID
   */
  async executeTool(
    toolName: string,
    argumentsObj: any,
    providedId?: string,
    context?: { channelId?: string; sessionId?: string },
  ): Promise<{ result: any; tool_call_id: string }> {
    // 等待初始化完成
    await this.initializationPromise

    await this.logger.debug(`Executing tool: ${toolName}`, {
      arguments: argumentsObj,
      context,
    })

    // 对于 spawn_subagent，设置执行上下文
    if (toolName === 'spawn_subagent' && context) {
      const { setExecContext } = await import('./SpawnTool')
      setExecContext(context)
    }
    const tool = this.tools.get(toolName)

    if (!tool) {
      await this.logger.error(`Tool not found: ${toolName}`)
      return {
        result: { success: false, error: `Tool '${toolName}' not found` },
        tool_call_id: providedId || `call_${uuidv4()}`,
      }
    }

    try {
      const { success, ...rest } = await tool.execute(argumentsObj, this.workspace)
      const result = Object.entries(rest)[0]
        ? this.formatToolOutput(Object.entries(rest)[0][1])
        : 'success'

      await this.logger.debug(`Tool executed successfully: ${toolName}`, {
        result: result.substring(0, 100) + (result.length > 100 ? '...' : ''),
      })

      return {
        result,
        tool_call_id: providedId || `call_${uuidv4()}`,
      }
    } catch (error) {
      await this.logger.error(`Tool execution failed: ${toolName}`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
        tool_call_id: providedId || `call_${uuidv4()}`,
      }
    }
  }

  /**
   * 执行多个工具调用
   * @param toolCalls 工具调用数组，每个元素包含 name, arguments 和可选的 id
   */
  async executeTools(
    toolCalls: Array<{ name: string; arguments: string; id?: string }>,
    context?: { channelId?: string; sessionId?: string },
  ): Promise<
    Array<{
      result: any
      tool_call_id: string
      name: string
    }>
  > {
    // 等待初始化完成
    await this.initializationPromise

    await this.logger.debug(`Executing ${toolCalls.length} tool(s)`, {
      tools: toolCalls.map((t) => t.name),
    })

    const results = await Promise.all(
      toolCalls.map(async ({ name, arguments: argsStr, id }) => {
        try {
          const args = JSON.parse(argsStr)
          const { result, tool_call_id } = await this.executeTool(name, args, id, context)

          return {
            result,
            tool_call_id,
            name,
          }
        } catch (error) {
          await this.logger.error(`Invalid arguments for tool: ${name}`, {
            error: error instanceof Error ? error.message : String(error),
          })
          return {
            result: {
              success: false,
              error: `Invalid arguments for tool '${name}': ${error instanceof Error ? error.message : String(error)}`,
            },
            tool_call_id: id || `call_${uuidv4()}`,
            name,
          }
        }
      }),
    )

    const successCount = results.filter((r) => !r.result?.success === false).length
    await this.logger.debug(
      `Tool execution completed: ${successCount}/${toolCalls.length} successful`,
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
      this.logger.warn(`Tool ${toolDefinition.name} is already registered and will be overwritten.`)
    }

    this.tools.set(toolDefinition.name, toolDefinition)
    this.logger.debug(`Tool registered: ${toolDefinition.name}`)
    return true
  }

  /**
   * 注销工具
   * @param toolName 工具名称
   * @returns 是否注销成功
   */
  unregisterTool(toolName: string): boolean {
    const existed = this.tools.has(toolName)
    const result = this.tools.delete(toolName)
    if (result) {
      this.logger.debug(`Tool unregistered: ${toolName}`)
    }
    return result
  }
}
