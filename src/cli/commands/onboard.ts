import { Command } from 'commander';
import { initConfig } from '../../config/manager';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

export const OnboardCommand = new Command('onboard');

OnboardCommand
  .description('Initialize workspace and config.json')
  .option('-f, --force', 'Force re-initialization even if config exists')
  .action(async (options) => {
    console.log('🚀 Starting Roxy onboarding process...');

    try {
      // 检查配置文件是否存在
      const configPath = join(homedir(), '.roxy', 'config.json');

      if (existsSync(configPath) && !options.force) {
        console.log('⚠️  Configuration already exists. Use --force to reinitialize.');
        const currentConfig = readFileSync(configPath, 'utf-8');
        console.log('Current config:\n', currentConfig);
        return;
      }

      // 初始化配置
      await initConfig();

      console.log('\n✅ Workspace initialized successfully!');
      console.log(`📁 Configuration file created at: ${configPath}`);

      // 提示用户编辑配置文件
      console.log('\n📝 Next steps:');
      console.log(`   1. Open ${configPath} in your editor`);
      console.log('   2. Add your API keys to the providers section');
      console.log('   3. Save the file');
    } catch (error) {
      console.error('❌ Failed to initialize workspace:', error.message);
      process.exit(1);
    }
  });