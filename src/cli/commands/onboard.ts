import { Command } from 'commander'
import { initAll, CONFIG_PATH, WROKSPACE_PATH } from '../../config/manager'
import chalk from 'chalk'

export const OnboardCommand = new Command('onboard')

OnboardCommand.description('Initialize workspace and config')
  .option('-f, --force', 'Force re-initialization')
  .action(async (options) => {
    console.log(chalk.cyan('\n🚀 Roxy Onboarding\n'))

    try {
      await initAll(options.force)
      console.log(chalk.green('\n✅ Initialization complete!\n'))
      console.log(chalk.gray(`Config:   ${CONFIG_PATH}`))
      console.log(chalk.gray(`Workspace: ${WROKSPACE_PATH}/\n`))
      console.log(chalk.yellow('Next: Edit config and add API keys, then run `roxy agent`\n'))
    } catch (error) {
      console.error(chalk.red('❌ Failed:'), error.message)
      process.exit(1)
    }
  })
