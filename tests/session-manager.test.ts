import { Session, SessionManager } from '../src/session/manager'
import { readFile, rm } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { describe, it, beforeEach, afterEach, expect } from 'vitest'

describe('SessionManager', () => {
  const testSessionDir = join(homedir(), '.roxy-test-sessions')
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager(testSessionDir)
  })

  afterEach(async () => {
    // 清理测试目录
    try {
      await rm(testSessionDir, { recursive: true, force: true })
    } catch (err) {
      // 忽略清理错误
    }
  })

  it('should create a new session', () => {
    const session = new Session('test-session')
    expect(session.id).toBe('test-session')
    expect(session.messages).toHaveLength(0)
  })

  it('should add messages to session', () => {
    const session = new Session('test-session')
    session.addMessage('user', 'Hello')
    expect(session.messages).toHaveLength(1)
    expect(session.messages[0].role).toBe('user')
    expect(session.messages[0].content).toBe('Hello')
  })

  it('should save and load session correctly', async () => {
    const sessionId = 'test-save-load'
    const session = await manager.getOrCreate(sessionId)

    // 添加一些消息
    session.addMessage('user', 'Hello')
    session.addMessage('assistant', 'Hi there!')

    // 保存会话
    await manager.save(session)

    // 创建一个新的管理器实例来模拟重新加载
    const newManager = new SessionManager(testSessionDir)
    const loadedSession = await newManager.getOrCreate(sessionId)

    expect(loadedSession.messages).toHaveLength(2)
    expect(loadedSession.messages[0].role).toBe('user')
    expect(loadedSession.messages[0].content).toBe('Hello')
    expect(loadedSession.messages[1].role).toBe('assistant')
    expect(loadedSession.messages[1].content).toBe('Hi there!')
  })

  it('should incrementally save new messages', async () => {
    const sessionId = 'test-incremental'
    const session = await manager.getOrCreate(sessionId)

    // 添加第一条消息并保存
    session.addMessage('user', 'First message')
    await manager.save(session)

    // 添加第二条消息并保存
    session.addMessage('assistant', 'Second message')
    await manager.save(session)

    // 读取文件内容验证是否正确追加
    const filePath = join(testSessionDir, `${sessionId}.jsonl`)
    const content = await readFile(filePath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    expect(lines).toHaveLength(2)

    const firstMsg = JSON.parse(lines[0])
    const secondMsg = JSON.parse(lines[1])

    expect(firstMsg.role).toBe('user')
    expect(firstMsg.content).toBe('First message')
    expect(secondMsg.role).toBe('assistant')
    expect(secondMsg.content).toBe('Second message')
  })

  it('should handle empty session correctly', async () => {
    const session = await manager.getOrCreate('empty-session')
    expect(session.messages).toHaveLength(0)

    // 尝试保存空会话不应该出错
    await manager.save(session)
    expect(session.messages).toHaveLength(0)
  })

  it('should clear session correctly', () => {
    const session = new Session('test-clear')
    session.addMessage('user', 'Hello')
    expect(session.messages).toHaveLength(1)

    session.clear()
    expect(session.messages).toHaveLength(0)
  })
})
