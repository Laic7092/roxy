import { Command } from 'commander';
import { AgentLoop } from '../../agent/loop';
import { loadConfig } from '../../config/manager';
import { SessionManager } from '../../session/manager';
import { LiteLLMProvider } from '../../provider/llm';
import { ContextMng } from '../../agent/context';

export const AgentCommand = new Command('agent');

AgentCommand
  .description('Start an interactive conversation with the AI agent')
  .option('-s, --session <sessionId>', 'Specify session ID to use (default: "default")')
  .option('-c, --clear', 'Clear the current session history')
  .action((options) => {
    console.log('🤖 Starting interactive agent session...');

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
        console.log('🗑️  Session history cleared');
      }

      // 初始化 AgentLoop 并传入会话
      const agentLoop = new AgentLoop({
        session,
        provider,
        ctx,
        model: curModel
      });

      console.log(`💬 Entering interactive mode (session: ${sessionId})`);
      console.log('Type your messages below (type "exit" to quit):\n');

      // 设置标准输入监听器
      process.stdin.setEncoding('utf8');

      // 显示提示符
      const showPrompt = () => {
        process.stdout.write('> ');
      };

      showPrompt(); // 显示初始提示符

      process.stdin.on('readable', async () => {
        let chunk;
        while ((chunk = process.stdin.read()) !== null) {
          const input = chunk.toString().trim();

          // 检查退出命令
          if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
            console.log('\n👋 Goodbye!');
            process.exit(0);
          }

          // 忽略空输入
          if (input === '') {
            showPrompt();
            continue;
          }

          // 将用户输入发送给 agent
          console.log(`\n[You]: ${input}`);
          
          // 定义流式数据回调函数，用于实时显示 AI 响应
          const handleStreamData = (data: string) => {
            process.stdout.write(data);
          };
          
          await agentLoop.msgHandler(input, handleStreamData);

          sessionManager.save(session)
          // 显示提示符等待下一个输入
          showPrompt();
        }
      });

      process.stdin.on('end', () => {
        console.log('\n👋 Session ended.');
      });

      // 处理 Ctrl+C
      process.on('SIGINT', () => {
        console.log('\n\n👋 Goodbye!');
        process.exit(0);
      });

    } catch (error) {
      if (error.message.includes('配置文件不存在')) {
        console.error('❌ Configuration not found. Please run "roxy onboard" first.');
      } else {
        console.error('❌ Failed to start agent:', error.message);
      }
      process.exit(1);
    }
  });