import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Authentication } from '../src/features/auth/server/authentication';
import { safePath } from '../src/features/workspace/server/file-transaction';

function promptPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error('需要交互终端，或使用 --password-file /绝对路径。');
  process.stderr.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (cancelled: boolean) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
      if (cancelled) reject(new Error('已取消。'));
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\u0004') {
          finish(true);
          return;
        }
        if (char === '\r' || char === '\n') {
          finish(false);
          return;
        }
        if (char === '\u007f' || char === '\b')
          value = [...value].slice(0, -1).join('');
        else if (char >= ' ' && [...value].length < 129) value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
async function main() {
  const args = process.argv.slice(2);
  let reset = false,
    passwordFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--reset' && !reset) reset = true;
    else if (args[i] === '--password-file' && !passwordFile && args[i + 1])
      passwordFile = args[++i];
    else
      throw new Error(
        '用法：auth-password [--reset] [--password-file /绝对路径]'
      );
  }
  let password: string;
  if (passwordFile) {
    if (!path.isAbsolute(passwordFile))
      throw new Error('密码文件须使用绝对路径。');
    await safePath(
      path.parse(passwordFile).root,
      path.relative(path.parse(passwordFile).root, passwordFile)
    );
    const handle = await fs.open(
      passwordFile,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024 || (stat.mode & 0o077) !== 0)
        throw new Error('密码文件须为不超过 1 KiB 的普通文件，权限为 0600。');
      password = (await handle.readFile('utf8')).replace(/\r?\n$/, '');
    } finally {
      await handle.close();
    }
  } else {
    password = await promptPassword('密码（15–128 个字符，不回显）：');
    const confirmation = await promptPassword('再次输入密码：');
    if (password !== confirmation) throw new Error('两次密码不一致。');
  }
  await new Authentication().setPassword(password, reset);
  console.log('登录密码已保存。重置后旧会话失效，请重新登录。');
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : '密码设置失败。');
  process.exitCode = 1;
});
