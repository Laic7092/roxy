import { defineConfig } from 'tsdown'
import { readdirSync } from 'fs'
import { cp } from 'node:fs/promises'
import { join } from 'node:path'

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
        'src/web/server.ts',
        ...toolFiles
    ],
    hooks: {
        'build:done': async () => {
            try {
                console.log('📄 Copying index.html to dist/web/...')
                await cp(
                    join(process.cwd(), 'src/web/index.html'),
                    join(process.cwd(), 'dist/web/index.html')
                )
                console.log('✅ index.html copied successfully!')
            } catch (err) {
                console.error('❌ Failed to copy index.html:', err)
            }
        }
    }
})