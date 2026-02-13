import { readFileSync } from "fs"
import { join } from "path"

const MEMORY_FILENAME = 'MEMORY.md'

export class Memory {
    workspace
    constructor(workspace) {
        this.workspace = workspace
    }
    getMemory() {
        return readFileSync(join(this.workspace, MEMORY_FILENAME), 'utf-8')
    }
    setMemory() {
        // do sth
    }
}