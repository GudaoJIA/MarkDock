import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  type ServiceSettings,
  type ServiceSnapshot,
  serviceSettingsSchema,
} from '../shared/service-settings';
import { WorkspaceError } from '../shared/types';
import { makeDirectories, renameSynced, syncHandle } from './durable-fs';

export class ServiceSettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  readonly directory: string;
  constructor(
    directory = process.env.MARKDOCK_DATA_DIR ||
      path.join(homedir(), '.config/markdock')
  ) {
    this.directory = directory;
    if (!path.isAbsolute(directory))
      throw new WorkspaceError('MARKDOCK_DATA_DIR 必须是绝对路径。');
  }
  private async check(target: string) {
    let current = path.parse(target).root;
    for (const part of target
      .slice(current.length)
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, part);
      try {
        if ((await fs.lstat(current)).isSymbolicLink())
          throw new WorkspaceError('服务配置路径不支持符号链接。', 403);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
    }
  }
  async read(): Promise<ServiceSnapshot> {
    const filename = path.join(this.directory, 'settings.json');
    await this.check(filename);
    try {
      if ((await fs.stat(filename)).size > 512 * 1024) throw new Error('size');
      const raw = await fs.readFile(filename, 'utf8');
      const settings = serviceSettingsSchema.parse(JSON.parse(raw));
      return {
        settings,
        revision: createHash('sha256').update(raw).digest('hex'),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return {
          settings: {
            version: 1,
            pins: [],
          },
          revision: 'absent',
        };
      throw new WorkspaceError(
        '服务配置无效或无法读取，请检查 MARKDOCK_DATA_DIR；不会重置配置。',
        409
      );
    }
  }
  async update(
    revision: string,
    change: (settings: ServiceSettings) => ServiceSettings
  ) {
    const operation = this.queue
      .catch(() => undefined)
      .then(async () => {
        const current = await this.read();
        if (current.revision !== revision)
          throw new WorkspaceError('管理设置已被修改，请刷新后重试。', 409);
        const next = serviceSettingsSchema.parse(
          change(structuredClone(current.settings))
        );
        await this.check(this.directory);
        await makeDirectories(
          this.directory,
          path.parse(this.directory).root,
          0o700
        );
        await this.check(this.directory);
        const temporary = path.join(
          this.directory,
          `.settings-${randomUUID()}.tmp`
        );
        try {
          const handle = await fs.open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`);
            await syncHandle(handle);
          } finally {
            await handle.close();
          }
          if ((await this.read()).revision !== revision)
            throw new WorkspaceError('管理设置已在外部修改，请重试。', 409);
          await renameSynced(
            temporary,
            path.join(this.directory, 'settings.json')
          );
          return await this.read();
        } finally {
          await fs.unlink(temporary).catch(() => undefined);
        }
      });
    this.queue = operation;
    return operation;
  }
}
export const serviceSettings = new ServiceSettingsStore();
