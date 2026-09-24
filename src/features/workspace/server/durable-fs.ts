import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceError } from '../shared/types';

function syncFailure(cause: unknown) {
  if (cause instanceof WorkspaceError && cause.status === 503) return cause;
  const error = new WorkspaceError(
    '磁盘同步失败，操作结果尚未确认。请保留草稿，检查文件和操作记录后再重试。',
    503
  );
  error.cause = cause;
  return error;
}
export async function syncHandle(handle: fs.FileHandle) {
  try {
    await handle.sync();
  } catch (cause) {
    throw syncFailure(cause);
  }
}

export async function syncDirectory(directory: string) {
  try {
    const handle = await fs.open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    try {
      await syncHandle(handle);
    } finally {
      await handle.close();
    }
  } catch (cause) {
    throw syncFailure(cause);
  }
}

export async function syncFile(filename: string) {
  const handle = await fs.open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    if (!(await handle.stat()).isFile())
      throw new WorkspaceError('请选择普通文件。');
    await syncHandle(handle);
  } finally {
    await handle.close();
  }
}

/** Sync child entries before their parents, including on a retry after mkdir. */
export async function makeDirectories(
  directory: string,
  boundary: string,
  mode?: number
) {
  const relative = path.relative(boundary, directory);
  if (
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  )
    throw new WorkspaceError('操作路径无效。', 403);
  const chain = [boundary];
  for (const part of relative.split(path.sep).filter(Boolean))
    chain.push(path.join(chain.at(-1)!, part));
  for (const target of chain) {
    try {
      await fs.mkdir(target, { mode });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new WorkspaceError('不支持符号链接或非目录路径。', 403);
  }
  for (const target of chain.reverse()) await syncDirectory(target);
}

export async function writeSynced(
  filename: string,
  data: string | Uint8Array,
  flag: 'wx' | 'w' = 'wx',
  mode?: number
) {
  const handle = await fs.open(
    filename,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_NOFOLLOW |
      (flag === 'wx' ? constants.O_EXCL : constants.O_TRUNC),
    mode
  );
  try {
    await handle.writeFile(data);
    if (mode !== undefined) await handle.chmod(mode);
    await syncHandle(handle);
  } finally {
    await handle.close();
  }
}

/** Publish a new complete file without replacing an existing destination. */
export async function createSynced(
  filename: string,
  data: string | Uint8Array,
  mode?: number
) {
  const temporary = path.join(
    path.dirname(filename),
    `.noteai-create-${randomUUID()}.tmp`
  );
  try {
    await writeSynced(temporary, data, 'wx', mode);
    await fs.link(temporary, filename);
    await syncDirectory(path.dirname(filename));
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

/** Destination first: do not confirm source removal before destination entry. */
export async function syncMoveDirectories(from: string, to: string) {
  await syncDirectory(path.dirname(to));
  if (path.dirname(from) !== path.dirname(to))
    await syncDirectory(path.dirname(from));
}
export async function renameSynced(from: string, to: string) {
  await fs.rename(from, to);
  await syncMoveDirectories(from, to);
}

/** Adopt copied or pre-existing resource trees only after their contents sync. */
export async function syncTree(target: string) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw new WorkspaceError('不支持符号链接。', 403);
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(target))
      await syncTree(path.join(target, name));
    await syncDirectory(target);
  } else if (stat.isFile()) await syncFile(target);
  else throw new WorkspaceError('资源目录包含非常规文件。', 403);
}
