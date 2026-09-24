import {
  makeDirectories,
  renameSynced,
  syncDirectory,
  syncHandle,
} from './durable-fs';
import { assertDirectoryTransactions } from './recovery-discovery';

const MARKDOWN = /\.md$/i;

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  isResourceDirectory,
  resourceDirectory,
} from '../shared/resource-paths';
import { type TrashEntry, WorkspaceError } from '../shared/types';
import {
  exists,
  FileTransaction,
  fingerprint,
  safePath,
} from './file-transaction';

const TRASH = '.noteai-trash';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function directory(id: string) {
  if (!ID.test(id)) throw new WorkspaceError('垃圾箱条目无效。', 400);
  return `${TRASH}/${id}`;
}
function validDocument(relative: unknown): relative is string {
  return (
    typeof relative === 'string' &&
    MARKDOWN.test(relative) &&
    !path.isAbsolute(relative) &&
    !relative.includes('\\') &&
    !relative.includes('\0') &&
    relative
      .split('/')
      .every(
        (part) => !!part && !part.startsWith('.') && !isResourceDirectory(part)
      )
  );
}
async function metadata(root: string, id: string): Promise<TrashEntry> {
  const entry = JSON.parse(
    await fs.readFile(
      await safePath(root, `${directory(id)}/entry.json`),
      'utf8'
    )
  );
  if (
    !entry ||
    typeof entry !== 'object' ||
    ![1, 2].includes(entry.version) ||
    entry.id !== id ||
    !validDocument(entry.path) ||
    typeof entry.deletedAt !== 'string' ||
    !Number.isFinite(Date.parse(entry.deletedAt)) ||
    typeof entry.assets !== 'boolean' ||
    !['trashed', 'deleting'].includes(entry.state)
  )
    throw new WorkspaceError('垃圾箱记录无效，请保留原文件并检查。', 409);
  if (
    entry.version === 2 &&
    (!Array.isArray(entry.resources) ||
      entry.resources.length > 2 ||
      new Set(entry.resources).size !== entry.resources.length ||
      entry.assets !== entry.resources.length > 0 ||
      entry.resources.some(
        (p: unknown) =>
          typeof p !== 'string' ||
          ![
            resourceDirectory(entry.path),
            entry.path.replace(MARKDOWN, ''),
          ].includes(p)
      ))
  )
    throw new WorkspaceError('垃圾箱资源记录无效。', 409);
  return entry;
}
async function writeRecord(
  root: string,
  relative: string,
  entry: TrashEntry,
  flag: 'wx' | 'w'
) {
  const handle = await fs.open(
    await safePath(root, relative, true),
    flag,
    0o600
  );
  try {
    await handle.writeFile(JSON.stringify(entry));
    await syncHandle(handle);
  } finally {
    await handle.close();
  }
}
export async function listTrash(root: string) {
  if (!(await exists(root, TRASH))) return [];
  const entries: TrashEntry[] = [];
  for (const id of await fs.readdir(await safePath(root, TRASH))) {
    if (!ID.test(id)) continue;
    if (await exists(root, `${directory(id)}/entry.json`))
      entries.push(await metadata(root, id));
  }
  return entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}
export async function trashDocument(
  root: string,
  relative: string,
  owned?: string[]
) {
  if (!validDocument(relative))
    throw new WorkspaceError('只能删除工作区中的 Markdown 文件。');
  if (!(await fs.stat(await safePath(root, relative))).isFile())
    throw new WorkspaceError('只能删除文件。');
  const resource = resourceDirectory(relative);
  const assets = await exists(root, resource);
  if (assets && !(await fs.stat(await safePath(root, resource))).isDirectory())
    throw new WorkspaceError('专属资源路径不是目录。', 409);
  const resources = owned ?? (assets ? [resource] : []);
  for (const location of resources)
    await assertDirectoryTransactions(root, location);
  const entry: TrashEntry = {
    version: owned ? 2 : 1,
    ...(owned ? { resources } : {}),
    id: randomUUID(),
    path: relative,
    deletedAt: new Date().toISOString(),
    assets: resources.length > 0,
    state: 'trashed',
  };
  const dir = directory(entry.id);
  const transaction = new FileTransaction(root);
  await transaction.prepare();
  await makeDirectories(await safePath(root, dir, true), root);
  const record = `${transaction.directory}/trash-entry.json`;
  await writeRecord(root, record, entry, 'wx');
  await transaction.move(relative, `${dir}/document.md`);
  for (const [i, location] of resources.entries())
    await transaction.move(
      location,
      `${dir}/${owned ? `resource-${i}` : 'assets'}`
    );
  await transaction.move(record, `${dir}/entry.json`);
  await transaction.commit();
  return entry;
}
export async function restoreTrash(root: string, id: string) {
  const entry = await metadata(root, id);
  if (entry.state !== 'trashed')
    throw new WorkspaceError('该条目已开始彻底删除，不能恢复。', 409);
  const resource = resourceDirectory(entry.path);
  const resources =
    entry.version === 2 ? entry.resources! : entry.assets ? [resource] : [];
  if (
    (await exists(root, entry.path)) ||
    (await Promise.all(resources.map((p) => exists(root, p)))).some(Boolean)
  )
    throw new WorkspaceError(
      '原位置存在同名文件或资源目录，请处理后重试。',
      409
    );
  for (const [i] of resources.entries())
    await assertDirectoryTransactions(
      root,
      `${directory(id)}/${entry.version === 2 ? `resource-${i}` : 'assets'}`
    );
  await makeDirectories(
    await safePath(root, path.posix.dirname(entry.path), true),
    root
  );
  const transaction = new FileTransaction(root);
  await transaction.prepare();
  const dir = directory(id);
  await transaction.move(`${dir}/document.md`, entry.path);
  for (const [i, location] of resources.entries())
    await transaction.move(
      `${dir}/${entry.version === 2 ? `resource-${i}` : 'assets'}`,
      location
    );
  await transaction.move(
    `${dir}/entry.json`,
    `${transaction.directory}/restored-entry.json`
  );
  await transaction.commit();
  return { path: entry.path };
}
async function removeTree(root: string, relative: string) {
  if (!(await exists(root, relative))) return;
  const target = await safePath(root, relative);
  const stat = await fs.lstat(target);
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(target))
      await removeTree(root, `${relative}/${name}`);
    await fs.rmdir(target);
  } else if (stat.isFile()) await fs.unlink(target);
  else throw new WorkspaceError('垃圾箱包含非常规文件，删除已停止。', 403);
  await syncDirectory(path.dirname(target));
}
export async function purgeTrash(root: string, id: string) {
  const dir = directory(id);
  if (!(await exists(root, `${dir}/entry.json`))) {
    // A prior purge may have completed deletion before its final sync failed.
    if (await exists(root, dir)) {
      const target = await safePath(root, dir);
      if ((await fs.readdir(target)).length !== 0)
        throw new WorkspaceError('垃圾箱记录无效，请保留原文件并检查。', 409);
      await fs.rmdir(target);
    }
    if (await exists(root, TRASH))
      await syncDirectory(await safePath(root, TRASH));
    return;
  }
  const entry = await metadata(root, id);
  await fingerprint(root, dir);
  const temporary = `${dir}/entry.tmp`;
  await writeRecord(root, temporary, { ...entry, state: 'deleting' }, 'w');
  await renameSynced(
    await safePath(root, temporary),
    await safePath(root, `${dir}/entry.json`)
  );
  for (const name of await fs.readdir(await safePath(root, dir))) {
    if (name !== 'entry.json') await removeTree(root, `${dir}/${name}`);
  }
  await fs.unlink(await safePath(root, `${dir}/entry.json`));
  await syncDirectory(await safePath(root, dir));
  await fs.rmdir(await safePath(root, dir));
  await syncDirectory(await safePath(root, TRASH));
}
