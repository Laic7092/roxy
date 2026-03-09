import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { promises as fs } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export async function getProjectRoot() {
  let currentDir = __dirname

  while (currentDir !== dirname(currentDir)) {
    try {
      await fs.access(resolve(currentDir, 'package.json'))
      return currentDir
    } catch {
      currentDir = dirname(currentDir)
    }
  }
  throw new Error('未找到 package.json')
}
