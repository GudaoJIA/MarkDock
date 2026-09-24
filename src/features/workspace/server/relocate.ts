import { assertDirectoryTransactions } from './recovery-discovery';

const URL_SUFFIX = /[?#].*$/;

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resourceDirectory } from '../shared/resource-paths';
import {
  defaultSettings,
  type ProjectSettings,
  resourceTarget,
  rules,
} from '../shared/resource-policy';
import {
  type FileSnapshot,
  type PathChange,
  type RelocationResult,
  WorkspaceError,
} from '../shared/types';
import {
  exists,
  FileTransaction,
  fingerprint,
  safePath,
} from './file-transaction';
import {
  hasUnsupportedLinks,
  linkSpans,
  localTarget,
  relativeLink,
  rewriteLinks,
} from './link-paths';
import { ownedResources } from './project-settings';

const MD = /\.md$/i;
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const mappedPath = (value: string, mappings: PathChange[]) => {
  for (const change of [...mappings].sort(
    (a, b) => b.from.length - a.from.length
  ))
    if (value === change.from || value.startsWith(`${change.from}/`))
      return change.to + value.slice(change.from.length);
  return value;
};
type Port = {
  root: string;
  settings?: ProjectSettings;
  read: (relative: string) => Promise<FileSnapshot>;
  paths: () => Promise<string[]>;
};
export async function relocate(
  port: Port,
  source: string,
  target: string,
  version?: string,
  migrateOnly = false
): Promise<RelocationResult> {
  const root = port.root;
  const settings = port.settings ?? defaultSettings;
  const resolveLink = (document: string, url: string) => {
    if (url.startsWith('/') && !url.startsWith('//')) {
      const target = resourceTarget(document, url, settings);
      return target
        ? { path: target, suffix: url.match(URL_SUFFIX)?.[0] ?? '' }
        : undefined;
    }
    return localTarget(document, url);
  };
  const sourceStat = await fs.stat(await safePath(root, source));
  const directory = sourceStat.isDirectory();
  if (!directory && !MD.test(source))
    throw new WorkspaceError('只能移动 Markdown 文档。');
  if (source === target && !migrateOnly)
    return { path: target, mappings: [], files: [] };
  if (target.startsWith(`${source}/`))
    throw new WorkspaceError('不能将目录移入自身。');
  if (!migrateOnly && (await exists(root, target)))
    throw new WorkspaceError('目标已存在同名文件或文件夹。', 409);
  await safePath(root, path.posix.dirname(target));
  const paths = await port.paths();
  const snapshots: FileSnapshot[] = [];
  for (const item of paths) snapshots.push(await port.read(item));
  const current = snapshots.find((file) => file.path === source);
  if (version && current?.version !== version)
    throw new WorkspaceError('文件已在外部修改，请重新载入。', 409);
  const mappings: PathChange[] = migrateOnly
    ? []
    : [{ from: source, to: target }];
  const owned = directory ? [] : await ownedResources(root, source, settings);
  const resourceMoves = owned.map((from) => ({
    from,
    to:
      from === resourceDirectory(source)
        ? resourceDirectory(target)
        : target.replace(MD, ''),
  }));
  for (const change of resourceMoves)
    if (
      !migrateOnly &&
      change.from !== change.to &&
      (await exists(root, change.to))
    )
      throw new WorkspaceError('目标资源目录已存在。', 409);
  const oldAssets = resourceDirectory(source);
  const newAssets = resourceDirectory(target);
  const hasAssets = owned.includes(oldAssets);
  if (
    !directory &&
    !migrateOnly &&
    (await exists(root, newAssets)) &&
    oldAssets !== newAssets
  )
    throw new WorkspaceError('目标已存在同名资源目录。', 409);
  if (hasAssets && !migrateOnly)
    mappings.unshift({ from: oldAssets, to: newAssets });
  if (!migrateOnly)
    for (const change of resourceMoves)
      if (change.from !== oldAssets) mappings.unshift(change);
  if (directory) await assertDirectoryTransactions(root, source);
  for (const resource of owned)
    await assertDirectoryTransactions(root, resource);
  const transaction = new FileTransaction(root);
  await transaction.prepare();
  // Staging retains old assets and rollback originals; shared legacy resources are copied, never deleted.
  const legacy = new Map<string, string>();
  if (!directory && current) {
    if (hasUnsupportedLinks(current.content))
      throw new WorkspaceError(
        '文档含 HTML 或双链资源语法，无法安全调整路径。'
      );
    for (const span of linkSpans(current.content)) {
      const resolved = resolveLink(source, span.url);
      if (!resolved) continue;
      const parts = resolved.path.split('/');
      const kind = parts.slice(0, -1).includes('附件')
        ? 'file'
        : parts.slice(0, -1).includes('assets')
          ? 'images'
          : undefined;
      if (!kind || legacy.has(resolved.path)) continue;
      if (
        !migrateOnly &&
        rules(settings).some(
          (r) =>
            r.mode === 'fixed' &&
            [r.images, r.attachments].some((d) =>
              resolved.path.startsWith(`${d}/`)
            )
        )
      )
        continue;
      const file = await safePath(root, resolved.path);
      if (!(await fs.stat(file)).isFile())
        throw new WorkspaceError('引用资源不是普通文件。');
      const filename = path.posix.basename(resolved.path);
      legacy.set(resolved.path, `${newAssets}/${kind}/${filename}`);
    }
  }
  if (legacy.size) {
    const staged = `${transaction.directory}/assets`;
    if (hasAssets)
      await fs.cp(
        await safePath(root, oldAssets),
        await safePath(root, staged, true),
        {
          recursive: true,
          errorOnExist: true,
          force: false,
          verbatimSymlinks: true,
        }
      );
    else await fs.mkdir(await safePath(root, staged, true));
    // Validate even unreferenced files before adopting a resource directory.
    await fingerprint(root, staged);
    for (const [original, next] of legacy) {
      const inside = `${staged}/${path.posix.relative(newAssets, next)}`;
      await fs.mkdir(path.dirname(await safePath(root, inside, true)), {
        recursive: true,
      });
      if (await exists(root, inside))
        throw new WorkspaceError('迁移资源与已有资源重名，请先检查目录。', 409);
      const before = await fingerprint(root, original);
      await fs.copyFile(
        await safePath(root, original),
        await safePath(root, inside, true)
      );
      const stat = await fs.stat(await safePath(root, original));
      await fs.chmod(await safePath(root, inside), stat.mode & 0o777);
      if (
        (await fingerprint(root, inside)) !== before ||
        (await fingerprint(root, original)) !== before
      )
        throw new WorkspaceError('资源已在外部修改，迁移已暂停。', 409);
    }
    if (hasAssets)
      await transaction.move(
        oldAssets,
        `${transaction.directory}/previous-assets`
      );
    await transaction.move(staged, newAssets);
  } else if (hasAssets && !migrateOnly)
    await transaction.move(oldAssets, newAssets);
  if (!migrateOnly) {
    for (const change of resourceMoves)
      if (change.from !== oldAssets)
        await transaction.move(change.from, change.to);
    await transaction.move(source, target);
  }
  const files: FileSnapshot[] = [];
  for (const snapshot of snapshots) {
    const nextDocument = mappedPath(snapshot.path, mappings);
    const affected =
      snapshot.path === source || snapshot.path.startsWith(`${source}/`);
    if (
      hasUnsupportedLinks(snapshot.content) &&
      (affected ||
        snapshot.content.includes(source) ||
        snapshot.content.includes(oldAssets) ||
        snapshot.content.includes(
          encodeURIComponent(path.posix.basename(source))
        ) ||
        snapshot.content.includes(path.posix.basename(source)))
    )
      throw new WorkspaceError(
        `“${snapshot.path}”包含无法安全更新的 HTML 或双链。`
      );
    const content = rewriteLinks(snapshot.content, (url) => {
      let resolved: ReturnType<typeof localTarget>;
      try {
        resolved = resolveLink(snapshot.path, url);
      } catch (error) {
        if (affected) throw error;
        return;
      }
      if (!resolved) return;
      const nextResource =
        snapshot.path === source && legacy.has(resolved.path)
          ? legacy.get(resolved.path)!
          : mappedPath(resolved.path, mappings);
      if (nextDocument === snapshot.path && nextResource === resolved.path)
        return;
      if (url.startsWith('/')) return;
      const nextLink = relativeLink(
        nextDocument,
        nextResource,
        resolved.suffix
      );
      if (
        nextLink === relativeLink(snapshot.path, resolved.path, resolved.suffix)
      )
        return;
      return nextLink;
    });
    if (affected) {
      for (const span of linkSpans(snapshot.content)) {
        const resolved = resolveLink(snapshot.path, span.url);
        if (resolved && !(await exists(root, resolved.path)))
          throw new WorkspaceError(`引用文件不存在：${resolved.path}`, 404);
      }
    }
    if (content !== snapshot.content) {
      await transaction.replace(snapshot.path, nextDocument, content);
      files.push({ path: nextDocument, content, version: hash(content) });
    } else if (nextDocument !== snapshot.path)
      files.push({ ...snapshot, path: nextDocument });
  }
  // Compare every scanned document again: backlinks may have changed during planning.
  for (const snapshot of snapshots)
    if ((await port.read(snapshot.path)).version !== snapshot.version)
      throw new WorkspaceError('工作区文档发生外部变化，请重试。', 409);
  if (transaction.steps.length) await transaction.commit();
  return { path: target, mappings, files };
}
