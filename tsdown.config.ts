import { defineConfig } from 'tsdown'
import { readdirSync } from 'fs'
import { join } from 'path'

// 动态获取工具目录下的所有工具文件
const toolsDir = 'src/tools'
const toolFiles = readdirSync(toolsDir)
  .filter(file => file.endsWith('.ts') && file !== 'ToolExecutor.ts' && file !== 'index.ts')
  .map(file => `${toolsDir}/${file}`)

export default defineConfig({
    entry: [
        'src/index.ts',
        'src/cli/index.ts',
        'src/agent/loop.ts',
        'src/provider/llm.ts',
        'src/config/manager.ts',
        'src/tools/ToolExecutor.ts',
        ...toolFiles
    ]
})