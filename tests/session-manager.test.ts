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
      console.error(err)
    }
  })

  it('should create a new session', () => {
    const session = new Session('test-session')
    expect(session.key).toBe('test-session')
    expect(session.messages).toHaveLength(0)
    expect(session.lastConsolidated).toBe(0)
  })

  it('should add messages to session', () => {
    const session = new Session('test-session')
    session.addMessage('user', 'Hello')
    expect(session.messages).toHaveLength(1)
    expect(session.messages[0].role).toBe('user')
    expect(session.messages[0].content).toBe('Hello')
  })

  it('should save and load session correctly', async () => {
    const sessionKey = 'test-save-load'
    const session = await manager.getOrCreate(sessionKey)

    session.addMessage('user', 'Hello')
    session.addMessage('assistant', 'Hi there!')

    await manager.save(session)

    const newManager = new SessionManager(testSessionDir)
    const loadedSession = await newManager.getOrCreate(sessionKey)

    expect(loadedSession.messages).toHaveLength(2)
    expect(loadedSession.messages[0].role).toBe('user')
    expect(loadedSession.messages[0].content).toBe('Hello')
    expect(loadedSession.messages[1].role).toBe('assistant')
    expect(loadedSession.messages[1].content).toBe('Hi there!')
  })

  it('should incrementally save new messages', async () => {
    const sessionKey = 'test-incremental'
    const session = await manager.getOrCreate(sessionKey)

    session.addMessage('user', 'First message')
    await manager.save(session)

    session.addMessage('assistant', 'Second message')
    await manager.save(session)

    const filePath = join(testSessionDir, `${sessionKey}.jsonl`)
    const content = await readFile(filePath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    // 第一行是 metadata，后面是消息
    expect(lines).toHaveLength(3)

    const metadata = JSON.parse(lines[0])
    expect(metadata._type).toBe('metadata')

    const firstMsg = JSON.parse(lines[1])
    const secondMsg = JSON.parse(lines[2])

    expect(firstMsg.role).toBe('user')
    expect(firstMsg.content).toBe('First message')
    expect(secondMsg.role).toBe('assistant')
    expect(secondMsg.content).toBe('Second message')
  })

  it('should handle empty session correctly', async () => {
    const sessionKey = 'empty-session'
    const session = await manager.getOrCreate(sessionKey)
    expect(session.messages).toHaveLength(0)

    await manager.save(session)
    expect(session.messages).toHaveLength(0)
  })

  it('should clear session correctly', () => {
    const session = new Session('test-clear')
    session.addMessage('user', 'Hello')
    expect(session.messages).toHaveLength(1)

    session.clear()
    expect(session.messages).toHaveLength(0)
    expect(session.lastConsolidated).toBe(0)
  })

  it('should get history with lastConsolidated', () => {
    const session = new Session('test-history')
    session.addMessage('user', 'Message 1')
    session.addMessage('assistant', 'Response 1')
    session.addMessage('user', 'Message 2')
    session.addMessage('assistant', 'Response 2')

    // 模拟合并了前 2 条消息
    session.lastConsolidated = 2

    const history = session.getHistory()
    expect(history).toHaveLength(2)
    expect(history[0].role).toBe('user')
    expect(history[0].content).toBe('Message 2')
  })

  it('should align history to user turn', () => {
    const session = new Session('test-align')
    session.addMessage('assistant', 'Orphan response')
    session.addMessage('user', 'User message')
    session.addMessage('assistant', 'Response')

    // lastConsolidated = 0，但第一条是 assistant，应该被跳过
    const history = session.getHistory()
    expect(history[0].role).toBe('user')
    expect(history[0].content).toBe('User message')
  })

  it('should list sessions', async () => {
    const session1 = await manager.getOrCreate('session-1')
    session1.addMessage('user', 'Test 1')
    await manager.save(session1)

    const session2 = await manager.getOrCreate('session-2')
    session2.addMessage('user', 'Test 2')
    await manager.save(session2)

    const sessions = await manager.listSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.key)).toContain('session-1')
    expect(sessions.map((s) => s.key)).toContain('session-2')
  })
})
