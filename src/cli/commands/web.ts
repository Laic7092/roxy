import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WebCommand = new Command('web');

WebCommand
  .description('Start the web server for the AI assistant')
  .option('-p, --port <port>', 'Port to run the server on', '3000')
  .option('--host <host>', 'Host to bind the server to', '127.0.0.1')
  .option('--no-open', 'Do not automatically open the browser')
  .action(async (options) => {
    console.log('🌐 Starting Roxy web server...');

    try {
      // 获取构建后的服务器文件路径
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const serverPath = join(__dirname, '..', 'web', 'server.mjs');

      // 准备环境变量和参数
      const env = { ...process.env };

      // 设置端口和主机作为环境变量
      env.PORT = options.port;
      env.HOST = options.host;

      // 启动服务器进程
      const serverProcess = spawn('node', [serverPath], {
        env,
        stdio: 'inherit' // 继承父进程的stdio，这样输出会直接显示在终端
      });

      // 监听服务器进程事件
      serverProcess.on('error', (err) => {
        console.error('❌ Failed to start web server:', err.message);
        process.exit(1);
      });

      serverProcess.on('close', (code) => {
        console.log(`\n✅ Web server exited with code ${code}`);
        process.exit(code || 0);
      });

      // 处理进程退出信号
      process.on('SIGTERM', () => {
        serverProcess.kill('SIGTERM');
      });

      process.on('SIGINT', () => {
        serverProcess.kill('SIGINT');
      });

      options.open = false
      // 如果需要，自动打开浏览器
      if (options.open) {
        setTimeout(() => {
          const platform = process.platform;
          const url = `http://${options.host}:${options.port}`;

          let command: string;
          let args: string[];

          switch (platform) {
            case 'darwin': // macOS
              command = 'open';
              args = [url];
              break;
            case 'win32': // Windows
              command = 'cmd';
              args = ['/c', 'start', url];
              break;
            case 'android': // Termux on Android
              command = 'termux-open-url';
              args = [url];
              break;
            default: // Linux and others
              command = 'xdg-open';
              args = [url];
          }

          spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
        }, 1000); // 等待服务器启动后再打开浏览器
      }

    } catch (error) {
      console.error('❌ Failed to start web server:', error.message);
      process.exit(1);
    }
  });