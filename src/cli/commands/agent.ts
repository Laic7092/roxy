import { Command } from 'commander';
import { AgentLoop } from '../../agent/loop';
import { loadConfig } from '../../config/manager';
import { SessionManager } from '../../session/manager';
import { LiteLLMProvider } from '../../provider/llm';
import { ContextMng } from '../../agent/context';
import chalk from 'chalk';
import readline from 'readline';
import ora from 'ora';

export const AgentCommand = new Command('agent');

AgentCommand
  .description('Start an interactive conversation with the AI agent')
  .option('-s, --session <sessionId>', 'Specify session ID to use (default: "default")')
  .option('-c, --clear', 'Clear the current session history')
  .action((options) => {
    console.log(chalk.blue('🤖 Starting interactive agent session...'));

    try {
      // 检查配置是否存在
      const { agents, providers, workspace } = loadConfig()

      const curProvider = agents.defaults.model.split('/')[0]
      const curModel = agents.defaults.model.split('/')[1]
      const { apiKey, baseURL } = providers[curProvider]
      const provider = new LiteLLMProvider({
        apiKey,
        baseURL,
        model: curModel
      })

      const ctx = new ContextMng({
        workspace,
      })

      // 初始化会话管理器和指定会话
      const sessionManager = new SessionManager();
      const sessionId = options.session || 'cli:default';
      const session = sessionManager.getOrCreate(sessionId);

      // 如果设置了清除选项，则清空会话历史
      if (options.clear) {
        session.clear();
        console.log(chalk.yellow('🗑️  Session history cleared'));
      }

      // 初始化 AgentLoop 并传入会话
      const agentLoop = new AgentLoop({
        session,
        provider,
        ctx,
        model: curModel
      });

      console.log(chalk.green(`💬 Entering interactive mode (session: ${sessionId})`));
      console.log(chalk.gray('Commands: /help, /clear, /history, /exit\n'));

      // 创建 readline 接口
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      // 显示提示符
      const showPrompt = () => {
        rl.setPrompt(chalk.cyan('> '));
        rl.prompt();
      };

      showPrompt(); // 显示初始提示符

      // 处理用户输入
      rl.on('line', async (input) => {
        const trimmedInput = input.trim();

        // 处理命令
        if (trimmedInput.startsWith('/')) {
          switch (trimmedInput) {
            case '/exit':
            case '/quit':
              console.log(chalk.blue('\n👋 Goodbye!'));
              process.exit(0);
              break;
            case '/clear':
              session.clear();
              console.log(chalk.yellow('🗑️  Session history cleared'));
              break;
            case '/history':
              console.log(chalk.gray('\n📜 Session History:'));
              session.messages.forEach((msg, index) => {
                if (msg.role === 'user') {
                  console.log(chalk.green(`[You]: ${msg.content}`));
                } else if (msg.role === 'assistant') {
                  console.log(chalk.blue(`[AI]: ${msg.content}`));
                }
              });
              break;
            case '/help':
              console.log(chalk.gray('\n📚 Available commands:'));
              console.log(chalk.gray('  /help    - Show this help message'));
              console.log(chalk.gray('  /clear  - Clear session history'));
              console.log(chalk.gray('  /history - Show session history'));
              console.log(chalk.gray('  /exit   - Exit the session'));
              break;
            default:
              console.log(chalk.red(`❌ Unknown command: ${trimmedInput}. Type /help for available commands.`));
          }
          showPrompt();
          return;
        }

        // 忽略空输入
        if (trimmedInput === '') {
          showPrompt();
          return;
        }

        // 将用户输入发送给 agent
        console.log(`\n${chalk.green('[You]:')} ${trimmedInput}`);

        // 显示加载指示器
        const spinner = ora({
          text: chalk.gray('Thinking'),
          spinner: 'clock'
        });
        spinner.start();

        // 定义流式数据回调函数，用于实时显示 AI 响应
        let aiResponse = '';
        const handleStreamData = (data: string) => {
          if (spinner.isSpinning) {
            spinner.stop();
          }
          aiResponse += data;
          process.stdout.write(chalk.blue(data));
        };

        try {
          await agentLoop.msgHandler(trimmedInput, handleStreamData);
          
          // 确保加载指示器停止
          if (spinner.isSpinning) {
            spinner.stop();
          }
          
          // 添加换行以分隔响应和提示符
          console.log('');

          // 将AI响应添加到会话中（如果尚未添加）
          if (aiResponse.trim()) {
            session.addMessage('assistant', aiResponse);
          }
        } catch (error) {
          // 确保加载指示器停止
          if (spinner.isSpinning) {
            spinner.stop();
          }
          
          console.error(chalk.red('\n❌ Error processing your request:'), error.message);
          
          // 提供重试选项
          const retry = await new Promise((resolve) => {
            const retryRl = readline.createInterface({
              input: process.stdin,
              output: process.stdout
            });
            
            retryRl.question(chalk.yellow('\n🔄 Retry? (y/n): '), (answer) => {
              retryRl.close();
              resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
            });
          });
          
          if (retry) {
            // 递归调用自身以重试
            rl.emit('line', input);
          }
        }

        sessionManager.save(session);

        // 显示提示符等待下一个输入
        showPrompt();
      }).on('close', () => {
        console.log(chalk.blue('\n👋 Session ended.'));
        process.exit(0);
      });

      // 处理 Ctrl+C
      process.on('SIGINT', () => {
        console.log(chalk.blue('\n\n👋 Goodbye!'));
        process.exit(0);
      });

    } catch (error) {
      if (error.message.includes('配置文件不存在')) {
        console.error(chalk.red('❌ Configuration not found. Please run "roxy onboard" first.'));
      } else {
        console.error(chalk.red('❌ Failed to start agent:'), error.message);
      }
      process.exit(1);
    }
  });