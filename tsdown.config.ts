import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/cli/index.ts',
    'src/agent/loop.ts',
    'src/provider/openai.ts',
    'src/config/manager.ts',
    'src/tools/ToolExecutor.ts',
    'src/gateway/gateway.ts',
    'src/gateway/types.ts',
  ],
})
