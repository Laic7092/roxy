#!/usr/bin/env node

import { Command } from 'commander'
import { OnboardCommand } from './commands/onboard'
import { AgentCommand } from './commands/agent'
import { WebCommand } from './commands/web'

const program = new Command()

program.name('roxy').description('AI Assistant CLI').version('1.0.0')

// 注册子命令
program.addCommand(OnboardCommand)
program.addCommand(AgentCommand)
program.addCommand(WebCommand)

program.parse(process.argv)
