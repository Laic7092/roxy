import { readFile } from 'fs/promises'
import { join } from 'path'
import { log } from '../utils/error-handler'

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
      log('warn', `Could not read memory file, returning empty string: ${error.message}`, 'memory')
      return ''
    }
  }
  setMemory() {
    // do sth
  }
}
