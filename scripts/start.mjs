import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { deployment } from '../src/features/workspace/server/deployment.mjs';

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve('next/package.json'));
process.env.NODE_ENV ??= 'production';
nextRequire('@next/env').loadEnvConfig(process.cwd(), false);
try {
  if (process.argv.length > 2)
    throw new Error('使用 MARKDOCK_HOST 和 PORT 配置监听地址，不接受额外启动参数。');
  const { hostname, port } = deployment();
  const child = spawn(
    process.execPath,
    [require.resolve('next/dist/bin/next'), 'start', '--hostname', hostname, '--port', String(port)],
    { stdio: 'inherit', env: process.env }
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => child.kill(signal));
  child.on('error', () => {
    console.error('无法启动 Next.js 服务。');
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
