import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { deployment } from '../src/features/workspace/server/deployment.mjs';

// Validate before loading standalone/server.js, which binds immediately.
try {
  const config = deployment();
  if (!config.origin || !config.roots?.length)
    throw new Error('容器必须显式配置 HTTPS 站点、允许根和配置目录。');
  if (process.getuid?.() === 0)
    throw new Error('请使用非 root UID/GID 运行 MarkDock 容器。');
  const data = process.env.MARKDOCK_DATA_DIR;
  for (const directory of [data, ...config.roots]) {
    const canonical = await fs.realpath(directory);
    if (canonical !== path.resolve(directory))
      throw new Error('挂载目录不能通过符号链接访问。');
    if (!(await fs.stat(directory)).isDirectory())
      throw new Error('挂载路径必须是已存在的目录。');
    await fs.access(
      directory,
      constants.R_OK | constants.W_OK | constants.X_OK
    );
  }
  for (const root of config.roots) {
    const relative = path.relative(root, data);
    if (
      !relative ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== '..' &&
        !path.isAbsolute(relative))
    )
      throw new Error('服务配置目录必须位于工作区允许根之外。');
  }
  process.env.HOSTNAME = config.hostname;
  process.env.PORT = String(config.port);
  await import('../server.js');
} catch (error) {
  console.error(error instanceof Error ? error.message : '容器启动失败。');
  process.exitCode = 1;
}
