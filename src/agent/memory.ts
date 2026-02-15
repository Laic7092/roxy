import { readFile } from 'fs/promises'
import { join } from 'path'

const MEMORY_FILENAME = 'MEMORY.md'

export class Memory {
  workspace
  constructor(workspace) {
    this.workspace = workspace
  }
  async getMemory(): Promise<string> {
    try {
      return await readFile(join(this.workspace, MEMORY_FILENAME), 'utf-8')
    } catch (error) {
      console.warn(`Warning: Could not read memory file, returning empty string: ${error.message}`)
      return ''
    }
  }
  setMemory() {
    // do sth
  }
}
