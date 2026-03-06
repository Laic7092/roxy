#!/usr/bin/env node

/**
 * Test script for cron tool execution
 */

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Import from dist
const { ToolExecutor } = await import('../dist/tools/ToolExecutor.mjs')

async function testCronTool() {
  console.log('🧪 Testing Cron Tool Execution\n')

  const workspace = join(__dirname, '..', 'test-workspace')
  const executor = new ToolExecutor(workspace)

  // Wait for tools to initialize
  await new Promise(resolve => setTimeout(resolve, 500))

  // Test 1: Add a cron job
  console.log('Test 1: Adding a cron job...')
  const result1 = await executor.executeTool('cron', {
    action: 'add',
    message: 'Test reminder',
    every_seconds: 300, // 5 minutes
  }, undefined, { channelId: 'test', sessionId: 'test' })

  console.log('Result:', JSON.stringify(result1, null, 2))

  if (result1.result && typeof result1.result === 'object' && result1.result.job_id) {
    console.log('✅ Test 1 passed: Cron job created\n')
  } else {
    console.log('❌ Test 1 failed: Unexpected result format\n')
  }

  // Test 2: List cron jobs
  console.log('Test 2: Listing cron jobs...')
  const result2 = await executor.executeTool('cron', {
    action: 'list',
  })

  console.log('Result:', JSON.stringify(result2, null, 2))

  if (result2.result && Array.isArray(result2.result.jobs)) {
    console.log('✅ Test 2 passed: Jobs listed\n')
  } else {
    console.log('❌ Test 2 failed: Unexpected result format\n')
  }

  // Test 3: Remove the cron job
  if (result1.result && result1.result.job_id) {
    console.log('Test 3: Removing cron job...')
    const result3 = await executor.executeTool('cron', {
      action: 'remove',
      job_id: result1.result.job_id,
    })

    console.log('Result:', JSON.stringify(result3, null, 2))

    if (result3.result && result3.result.message) {
      console.log('✅ Test 3 passed: Job removed\n')
    } else {
      console.log('❌ Test 3 failed: Unexpected result format\n')
    }
  }

  console.log('All tests completed!')
}

testCronTool().catch(console.error)
