import { defineConfig } from 'tsdown'

export default defineConfig({
    entry: [
        'src/index.ts',
        'src/cli/index.ts',
        'src/agent/loop.ts',
        'src/provider/llm.ts',
        'src/config/manager.ts'
    ]
})