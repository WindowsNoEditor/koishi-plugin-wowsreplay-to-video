import { Context, Schema, h } from 'koishi';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';

export interface Config {
  pythonPath: string;
  replayMessages: string[];
}

export const Config: Schema<Config> = Schema.object({
  pythonPath: Schema.string().default('D:/wows/renderer/venv/Scripts/python.exe').description('Python 执行路径'),
  replayMessages: Schema.array(Schema.string()).default([
    '这把是不是你打得有问题？',
    '你潜艇觉得是我的锅，那就是我的锅。',
    '你AP打断别人的占点呀，我阐释你的梦',
    '他都已经玩潜艇了，你为什么不顺从他呢？',
  ]).description('复盘时的随机评论句子'),
});

export const name = 'koishi-plugin-wowsreplay-to-video';

export const inject = {
  required: ['http'],
};

export function apply(ctx: Context, config: Config) {
  ctx.command('replay <fileUrl>', '上传 wowsreplay 文件链接生成视频')
    .alias('复盘')
    .action(async ({ session }, fileUrl) => {
      if (!fileUrl) return '请提供一个文件链接！可以使用wowsreplay.mihoyo.su上传.wowsreplay文件，然后将生成的链接发送至此';
      let replayUrl: URL;
      try {
        replayUrl = new URL(fileUrl);
      } catch {
        return '请提供有效的 HTTP(S) 文件链接！';
      }
      if (!['http:', 'https:'].includes(replayUrl.protocol)) return '请提供有效的 HTTP(S) 文件链接！';
      if (!replayUrl.pathname.endsWith('.wowsreplay')) return '请提供后缀为 .wowsreplay 的文件链接！';

      const pythonPath = config.pythonPath;

      if (!pythonPath) {
        return 'Python 路径未配置，请在后台设置。';
      }

      // 每个请求使用独立目录，远程文件名不参与本地路径或命令构造。
      const tempDir = fs.mkdtempSync(path.join(tmpdir(), 'wowsreplay-'));
      const replayPath = path.join(tempDir, 'replay.wowsreplay');
      const mp4Path = path.join(tempDir, 'replay.mp4');

      try {
        // 异步下载文件
        await downloadFile(replayUrl, replayPath);

        // 执行 Python 渲染脚本
        await runPythonScript(pythonPath, replayPath);

        if (!fs.existsSync(mp4Path)) {
          return '视频生成失败，请检查脚本逻辑或环境配置。';
        }

        const video_temp = fs.readFileSync(mp4Path);		
		const randomMessage = getRandomMessage(config.replayMessages);
		session.send(randomMessage)
        return h.video(video_temp, 'video/mp4')

      } finally {
        // 同时清理渲染器生成的附属文件。
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
}

function getRandomMessage(messages: string[]): string {
  const randomIndex = Math.floor(Math.random() * messages.length);
  return messages[randomIndex];
}

// 异步执行 Python 渲染脚本
function runPythonScript(pythonPath: string, replayPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 必须直接执行程序并传递参数数组，不能让 shell 解释路径中的字符。
    execFile(pythonPath, ['-m', 'render', '--replay', replayPath], { shell: false }, (error, stdout, stderr) => {
      if (error) {
        console.error('执行出错：', stderr);
        return reject(error);
      }
      resolve();
    });
  });
}

// 异步下载文件
async function downloadFile(url: URL, dest: string): Promise<void> {
  const protocol = url.protocol === 'https:' ? https : http;

  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    protocol.get(url, resolve).on('error', reject);
  });
  if (response.statusCode !== 200) {
    response.destroy();
    throw new Error(`下载失败，状态码：${response.statusCode}`);
  }
  // 等待下载流和文件流关闭后再进行渲染或清理。
  await pipeline(response, fs.createWriteStream(dest, { flags: 'wx' }));
}
