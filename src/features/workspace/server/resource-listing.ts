import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ResourceEntry,
  ResourceListing,
} from '../shared/resource-listing';
import { isResourceDirectory } from '../shared/resource-paths';
import { type ProjectSettings, rules } from '../shared/resource-policy';
import { WorkspaceError } from '../shared/types';
import { safePath } from './file-transaction';

const markdown = /\.md$/i;
const visible = (name: string) =>
  !name.startsWith('.') && name !== 'node_modules';
const uploaded = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}--/i;
export async function resourceEntries(
  root: string,
  relative: string,
  signal?: AbortSignal
) {
  const directory = await safePath(root, relative);
  const entries: ResourceEntry[] = [];
  let count = 0;
  const handle = await fs.opendir(directory);
  for await (const item of handle) {
    signal?.throwIfAborted();
    if (!visible(item.name)) continue;
    if (++count > 5000)
      throw new WorkspaceError(
        '资源目录超过 5000 个条目，请选择更小的子目录。',
        413
      );
    if (!item.isFile() && !item.isDirectory()) continue;
    const target = path.join(directory, item.name);
    const stat = await fs.lstat(target);
    if (!stat.isFile() && !stat.isDirectory()) continue;
    entries.push({
      name: item.name,
      path: `${relative}/${item.name}`,
      kind: stat.isDirectory() ? 'directory' : 'file',
      ...(stat.isFile() ? { size: stat.size } : {}),
    });
  }
  return entries;
}

// Inspect only the requested ancestry, never recurse through resource descendants.
export async function assertResourcePath(
  root: string,
  relative: string,
  settings: ProjectSettings,
  directory: boolean,
  signal?: AbortSignal
) {
  const target = await safePath(root, relative);
  const parts = relative.split('/');
  if (
    !relative ||
    parts.some((p) => !visible(p) || !p || p === '..' || p === '.')
  )
    throw new WorkspaceError('资源路径无效。', 403);
  const folders = directory ? parts : parts.slice(0, -1);
  let owner = -1;
  for (let i = 0; i < folders.length; i++) {
    signal?.throwIfAborted();
    const prefix = folders.slice(0, i + 1).join('/');
    if (
      isResourceDirectory(folders[i]) ||
      rules(settings).some(
        (r) => r.mode === 'fixed' && [r.images, r.attachments].includes(prefix)
      )
    ) {
      owner = i;
      break;
    }
    if (rules(settings).some((r) => r.mode === 'sibling')) {
      const document = await safePath(root, `${prefix}.md`, true);
      if (
        await fs
          .stat(document)
          .then((s) => s.isFile())
          .catch(() => false)
      ) {
        owner = i;
        break;
      }
    }
  }
  if (owner < 0) throw new WorkspaceError('只能访问资源目录中的文件。', 403);
  for (let i = owner; i < folders.length; i++) {
    if (folders.slice(0, i + 1).some((p) => p.endsWith('.assets'))) continue;
    const entries = await resourceEntries(
      root,
      folders.slice(0, i + 1).join('/'),
      signal
    );
    if (
      entries.some(
        (e) =>
          e.kind === 'file' && markdown.test(e.name) && !uploaded.test(e.name)
      )
    )
      throw new WorkspaceError(
        '目录包含 Markdown 文档，不能作为资源目录浏览。',
        409
      );
  }
  return target;
}

export async function listResources(
  root: string,
  relative: string,
  settings: ProjectSettings,
  revision: string,
  cursor?: string,
  signal?: AbortSignal
): Promise<ResourceListing> {
  await assertResourcePath(root, relative, settings, true, signal);
  const entries = await resourceEntries(root, relative, signal);
  entries.sort(
    (a, b) =>
      Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
      a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) ||
      a.name.localeCompare(b.name)
  );
  const digest = createHash('sha256')
    .update(JSON.stringify([relative, revision, entries]))
    .digest('hex');
  let offset = 0;
  if (cursor) {
    const [version, raw] = cursor.split(':');
    offset = Number(raw);
    if (
      version !== digest ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= entries.length
    )
      throw new WorkspaceError('资源目录已变化，请刷新列表。', 409);
  }
  signal?.throwIfAborted();
  return {
    entries: entries.slice(offset, offset + 100),
    ...(offset + 100 < entries.length
      ? { nextCursor: `${digest}:${offset + 100}` }
      : {}),
  };
}
