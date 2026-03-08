import { v4 as uuidv4 } from 'uuid'
import { log, logError } from '../utils/error-handler'
import { RoxyError, ErrorCode } from '../types/errors'

/**
 * ToolFunction - 工具函数定义
 *
 * 每个工具必须包含：
 * - name: 工具名称
 * - description: 工具描述
 * - parameters: JSON Schema 格式的参数定义
 * - execute: 执行函数，接收 args、workspace 和 context
 */
export interface ToolFunction {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
  execute: (
    args: any,
    workspace: string,
    context?: { channelId: string; sessionId: string },
  ) => Promise<any>
}

/**
 * ToolExecutionResult - 工具执行结果
 */
export interface ToolExecutionResult {
  result: any
  tool_call_id: string
}

/**
 * ToolExecutor - 工具执行器
 *
 * 职责：
 * - 管理工具注册
 * - 执行工具调用
 * - 处理工具错误
 *
 * 架构原则：
 * - 不自动扫描注册工具，由 Gateway 显式注册
 * - Context 通过 executeTool 参数传递，不内部存储
 * - 统一的错误处理和日志记录
 */
export class ToolExecutor {
  private tools: Map<string, ToolFunction> = new Map()
  private workspace: string
  private initialized = false

  constructor(workspace: string) {
    this.workspace = workspace
  }

  /**
   * 初始化工具执行器
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      log('warn', 'ToolExecutor already initialized', 'ToolExecutor')
      return
    }

    log('info', `Initializing ToolExecutor with workspace: ${this.workspace}`, 'ToolExecutor')
    this.initialized = true
    log('success', `ToolExecutor initialized with ${this.tools.size} tool(s)`, 'ToolExecutor')
  }

  /**
   * 注册单个工具
   */
  registerTool(tool: ToolFunction): void {
    if (this.tools.has(tool.name)) {
      log(
        'warn',
        `Tool '${tool.name}' is already registered and will be overwritten`,
        'ToolExecutor',
      )
    }
    this.tools.set(tool.name, tool)
    log('debug', `Tool registered: ${tool.name}`, 'ToolExecutor')
  }

  /**
   * 注册多个工具
   */
  registerTools(tools: ToolFunction[]): void {
    for (const tool of tools) {
      this.registerTool(tool)
    }
  }

  /**
   * 注销工具
   */
  unregisterTool(toolName: string): boolean {
    const result = this.tools.delete(toolName)
    if (result) {
      log('debug', `Tool unregistered: ${toolName}`, 'ToolExecutor')
    }
    return result
  }

  /**
   * 获取所有可用工具的定义（用于 LLM API）
   */
  async getToolDefinitions(): Promise<any[]> {
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
   * 获取工具数量
   */
  getToolCount(): number {
    return this.tools.size
  }

  /**
   * 执行单个工具
   *
   * @param toolName 工具名称
   * @param argumentsObj 参数对象
   * @param providedId 可选的工具调用 ID（由 LLM 提供）
   * @param context 执行上下文（channelId, sessionId）
   */
  async executeTool(
    toolName: string,
    argumentsObj: any,
    providedId?: string,
    context?: { channelId: string; sessionId: string },
  ): Promise<ToolExecutionResult> {
    if (!this.initialized) {
      await this.initialize()
    }

    const toolCallId = providedId || `call_${uuidv4()}`

    log('debug', `Executing tool: ${toolName}`, 'ToolExecutor', {
      arguments: argumentsObj,
      context,
      toolCallId,
    })

    const tool = this.tools.get(toolName)

    if (!tool) {
      const error = new RoxyError(
        ErrorCode.TOOL_NOT_FOUND,
        `Tool '${toolName}' not found`,
        undefined,
        {
          toolName,
          availableTools: Array.from(this.tools.keys()),
        },
      )
      logError(error, 'error', 'ToolExecutor')
      // 返回字符串而不是对象，避免 LLM API 格式错误
      return {
        result: `Error: Tool '${toolName}' not found. Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
        tool_call_id: toolCallId,
      }
    }

    try {
      // 执行工具
      const resultObj = await tool.execute(argumentsObj, this.workspace, context)

      // 格式化输出
      const formattedResult = this.formatToolOutput(resultObj)

      log('debug', `Tool executed successfully: ${toolName}`, 'ToolExecutor', {
        result: formattedResult.substring(0, 100) + (formattedResult.length > 100 ? '...' : ''),
      })

      return {
        result: formattedResult,
        tool_call_id: toolCallId,
      }
    } catch (error) {
      const roxyError =
        error instanceof RoxyError
          ? error
          : new RoxyError(
              ErrorCode.TOOL_EXECUTION_FAILED,
              `Tool '${toolName}' execution failed`,
              error instanceof Error ? error : undefined,
              { toolName, arguments: argumentsObj },
            )

      logError(roxyError, 'error', 'ToolExecutor')

      // 返回字符串而不是对象
      return {
        result: `Error: ${roxyError.message}`,
        tool_call_id: toolCallId,
      }
    }
  }

  /**
   * 执行多个工具调用
   *
   * @param toolCalls 工具调用数组，每个元素包含 name, arguments 和可选的 id
   * @param context 执行上下文（channelId, sessionId）
   */
  async executeTools(
    toolCalls: Array<{ name: string; arguments: string | Record<string, any>; id?: string }>,
    context?: { channelId: string; sessionId: string },
  ): Promise<
    Array<{
      result: any
      tool_call_id: string
      name: string
    }>
  > {
    if (!this.initialized) {
      await this.initialize()
    }

    log('debug', `Executing ${toolCalls.length} tool(s)`, 'ToolExecutor', {
      tools: toolCalls.map((t) => t.name),
    })

    const results = await Promise.all(
      toolCalls.map(async ({ name, arguments: argsInput, id }) => {
        try {
          // 解析参数（支持字符串和对象两种格式）
          let args: any
          try {
            if (typeof argsInput === 'string') {
              args = JSON.parse(argsInput)
            } else if (typeof argsInput === 'object' && argsInput !== null) {
              args = argsInput
            } else {
              throw new Error('Arguments must be a string or object')
            }
          } catch (parseError) {
            throw new RoxyError(
              ErrorCode.TOOL_ARGUMENT_PARSE_ERROR,
              `Failed to parse arguments for tool '${name}'`,
              parseError instanceof Error ? parseError : undefined,
              { rawArguments: argsInput },
            )
          }

          // 执行工具
          const { result, tool_call_id } = await this.executeTool(name, args, id, context)

          return {
            result,
            tool_call_id,
            name,
          }
        } catch (error) {
          const roxyError =
            error instanceof RoxyError
              ? error
              : new RoxyError(
                  ErrorCode.TOOL_EXECUTION_FAILED,
                  `Failed to execute tool '${name}'`,
                  error instanceof Error ? error : undefined,
                  { toolName: name },
                )

          logError(roxyError, 'error', 'ToolExecutor')

          return {
            // 转换为字符串，因为 LLM API 期望 content 是字符串
            result: JSON.stringify({ success: false, error: roxyError.message }),
            tool_call_id: id || `call_${uuidv4()}`,
            name,
          }
        }
      }),
    )

    const successCount = results.filter((r) => !r.result?.success === false).length
    log(
      'debug',
      `Tool execution completed: ${successCount}/${toolCalls.length} successful`,
      'ToolExecutor',
    )

    return results
  }

  /**
   * 格式化工具输出
   *
   * 支持多种输出格式：
   * - null/undefined -> ''
   * - string -> 原样返回
   * - object -> JSON.stringify (紧凑格式，无缩进)
   * - 其他类型 -> String() 转换
   */
  formatToolOutput(output: unknown): string {
    if (output === null || output === undefined) {
      return ''
    }

    if (typeof output === 'string') {
      return output
    }

    if (typeof output === 'object') {
      // 使用紧凑格式，避免换行和引号转义问题
      return JSON.stringify(output)
    }

    return String(output)
  }

  /**
   * 检查工具是否存在
   */
  hasTool(toolName: string): boolean {
    return this.tools.has(toolName)
  }

  /**
   * 获取所有工具名称列表
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys())
  }

  /**
   * 清空所有工具
   */
  clearTools(): void {
    this.tools.clear()
    log('debug', 'All tools cleared', 'ToolExecutor')
  }
}
