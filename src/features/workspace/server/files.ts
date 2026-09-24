import {
  checkCancelled,
  reportProgress,
  type ScanOptions,
} from '../shared/open-progress';
import { configuredDataRoots, dataBoundary } from './data-locations';
import {
  createSynced,
  makeDirectories,
  renameSynced,
  syncDirectory,
  syncFile,
  syncHandle,
  writeSynced,
} from './durable-fs';
import { assertWorkspaceRoot, checkRecoveryScope } from './recovery-discovery';
import { assertResourcePath, listResources } from './resource-listing';
import { type ServiceSettingsStore, serviceSettings } from './service-settings';

const FILE_EXTENSION = /\.[^.]*$/;
const UNSAFE_IMAGE_NAME = /[^\p{L}\p{N}._-]/gu;

import {
  resourceUrl,
  rules,
  type SettingsInput,
  uploadDirectory,
} from '../shared/resource-policy';
import {
  assertTransactionsSettled,
  recoverTransactions,
  safePath,
} from './file-transaction';
import {
  assertResourceDirectory,
  ownedResources,
  readSettings,
  saveSettings,
  validateSettings,
} from './project-settings';
import { relocate } from './relocate';
import { listTrash, purgeTrash, restoreTrash, trashDocument } from './trash';
import {
  overlappingRoots,
  withWorkspaceLock,
  workspaceOperations,
} from './workspace-lock';

const MD_EXTENSION = /\.md$/i;
const INVALID_NAME = /[/\\\0]/;

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { attachmentName, MAX_ATTACHMENT_BYTES } from '../shared/attachments';
import { imageExtension } from '../shared/image-format';
import {
  isAttachmentPath,
  isResourceDirectory,
} from '../shared/resource-paths';
import {
  rankResults,
  type SearchResponse,
  searchDocument,
} from '../shared/search';

import {
  type DirectoryListing,
  type DirectoryQuery,
  type FileSnapshot,
  type TreeEntry,
  type Workspace,
  WorkspaceError,
} from '../shared/types';

const MAX_BYTES = 5 * 1024 * 1024;
const BACKUPS = '.noteai-backups';
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject unsafe control characters in filenames.
const INVALID_ATTACHMENT_NAME = /[/\\\u0000-\u001f\u007f]/;
const hash = (content: Uint8Array | string) =>
  createHash('sha256').update(content).digest('hex');
const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

/** No process-global database: IDs are temporary capabilities for explicitly opened roots. */
export class FileService {
  readonly serviceConfig: ServiceSettingsStore;
  private readonly dataRoots: string[] | null;
  constructor(
    serviceConfig: ServiceSettingsStore = serviceSettings,
    dataRoots: string[] | null = configuredDataRoots()
  ) {
    this.serviceConfig = serviceConfig;
    this.dataRoots = dataRoots;
  }
  async locations(): Promise<{ root: string; name: string; error?: string }[]> {
    return Promise.all(
      (this.dataRoots ?? []).map(async (root) => {
        const location = { root, name: path.basename(root) || root };
        try {
          await this.noSymlinks(root);
          if (!(await fs.stat(root)).isDirectory())
            throw new Error('数据位置不是目录。');
          await fs.access(root, constants.R_OK);
          return location;
        } catch (error) {
          return { ...location, error: (error as Error).message };
        }
      })
    );
  }
  private readSettings(root: string) {
    return readSettings(root);
  }

  async browse(query: DirectoryQuery): Promise<DirectoryListing> {
    const requested = query.path ?? this.dataRoots?.[0];
    if (requested === undefined)
      throw new WorkspaceError('请先选择数据位置或输入目录路径。');
    if (!path.isAbsolute(requested) || requested.includes('\0'))
      throw new WorkspaceError('请输入目录的绝对路径。');
    const absolute = path.resolve(requested);
    dataBoundary(absolute, this.dataRoots);
    await this.noSymlinks(absolute);
    if (!(await fs.stat(absolute)).isDirectory())
      throw new WorkspaceError('请选择一个目录。');
    const root = dataBoundary(absolute, this.dataRoots);
    const relative = path.relative(root, absolute);
    const current = absolute;
    const parts = relative.split(path.sep).filter(Boolean);
    const breadcrumbs = [
      {
        name: root,
        path: root,
      },
    ];
    for (let i = 0; i < parts.length; i++) {
      breadcrumbs.push({
        name: parts[i],
        path: path.join(root, ...parts.slice(0, i + 1)),
      });
    }
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    const directories = entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          entry.name !== 'node_modules'
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
      .map((entry) => ({
        name: entry.name,
        path: path.join(absolute, entry.name),
      }));
    return {
      path: current,
      parent: breadcrumbs.length > 1 ? breadcrumbs.at(-2)!.path : null,
      breadcrumbs,
      directories,
    };
  }
  async settings(id: string) {
    return this.readSettings(this.workspace(id).root);
  }
  async updateSettings(id: string, input: SettingsInput, revision: string) {
    return this.trashOperation(id, async (root) => {
      const result = await saveSettings(root, input, revision);
      this.roots.get(id)!.settings = result;
      return result;
    });
  }
  private async assertDocumentLocation(id: string, relative: string) {
    const root = this.workspace(id).root;
    const { settings } = await this.readSettings(root);
    for (const rule of rules(settings)) {
      if (
        rule.mode === 'fixed' &&
        [rule.images, rule.attachments].some(
          (d) => relative === d || relative.startsWith(`${d}/`)
        )
      )
        throw new WorkspaceError('不能编辑资源目录中的文档。', 403);
      if (rule.mode === 'sibling') {
        const parts = relative.split('/');
        for (let i = 1; i <= parts.length; i++) {
          const directory = parts.slice(0, i).join('/');
          if (
            await fs
              .stat(await safePath(root, `${directory}.md`, true))
              .then((x) => x.isFile())
              .catch(() => false)
          ) {
            throw new WorkspaceError('同名文档与目录的归属存在冲突。', 409);
          }
        }
      }
    }
  }
  private async trashOperation<T>(
    id: string,
    action: (root: string) => Promise<T>
  ) {
    const workspace = this.roots.get(id);
    if (!workspace)
      throw new WorkspaceError('工作区已失效，请重新打开目录。', 401);
    const { root } = workspace;
    return this.exclusive(root, async () => {
      this.workspace(id);
      this.changing.add(root);
      try {
        return await this.operationContext.run(root, () => action(root));
      } catch (error) {
        try {
          await recoverTransactions(root);
        } catch {
          this.recoveryBlocked.add(root);
        }
        throw error;
      } finally {
        this.changing.delete(root);
      }
    });
  }
  trashList(id: string) {
    return this.trashOperation(id, listTrash);
  }
  trash(id: string, relative: string, version: string) {
    return this.trashOperation(id, async (root) => {
      const file = await this.read(id, relative);
      if (file.version !== version)
        throw new WorkspaceError('文件已在外部修改，请重新加载后再删除。', 409);
      const { settings } = await this.readSettings(root);
      return trashDocument(
        root,
        relative,
        await ownedResources(root, relative, settings)
      );
    });
  }
  restore(id: string, entry: string) {
    return this.trashOperation(id, (root) => restoreTrash(root, entry));
  }
  purge(id: string, entries: string[]) {
    return this.trashOperation(id, async (root) => {
      const failed: { id: string; error: string }[] = [];
      for (const entry of new Set(entries)) {
        try {
          await purgeTrash(root, entry);
        } catch (error) {
          failed.push({
            id: entry,
            error: error instanceof Error ? error.message : '删除失败。',
          });
        }
      }
      return { failed };
    });
  }
  private readonly recoveryBlocked = workspaceOperations.recoveryBlocked;
  private readonly changing = workspaceOperations.changing;
  private readonly operationContext = workspaceOperations.context;
  private readonly roots = new Map<string, Workspace>();
  private readonly backedUp = new Set<string>();

  private async exclusive<T>(
    root: string,
    action: () => Promise<T>,
    onWait?: () => void
  ): Promise<T> {
    return withWorkspaceLock(root, action, onWait);
  }

  private workspace(id: string) {
    const workspace = this.roots.get(id);
    if (!workspace)
      throw new WorkspaceError('工作区已失效，请重新打开目录。', 401);
    dataBoundary(workspace.root, this.dataRoots);
    if (
      [...this.recoveryBlocked].some((root) =>
        overlappingRoots(root, workspace.root)
      )
    )
      throw new WorkspaceError(
        '文件操作恢复遇到冲突，请检查 .noteai-operations 后重新打开工作区。',
        409
      );
    if (
      [...this.changing].some(
        (root) =>
          overlappingRoots(root, workspace.root) &&
          this.operationContext.getStore() !== root
      )
    )
      throw new WorkspaceError('文件移动处理中，请稍后重试。', 423);
    return workspace;
  }

  private async noSymlinks(absolute: string) {
    const parsed = path.parse(absolute);
    let current = parsed.root;
    for (const part of absolute
      .slice(parsed.root.length)
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, part);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink())
        throw new WorkspaceError('不支持符号链接，请打开真实目录或文件。', 403);
    }
  }

  private async resolve(id: string, relative: string, allowMissing = false) {
    const workspace = this.workspace(id);
    if (
      path.isAbsolute(relative) ||
      relative.includes('\\') ||
      relative.includes('\0') ||
      relative
        .split('/')
        .some(
          (part) =>
            part === '..' || part.startsWith('.') || part === 'node_modules'
        )
    ) {
      throw new WorkspaceError('文件路径无效或超出了工作区。', 403);
    }
    const target = path.resolve(workspace.root, relative);
    if (
      target !== workspace.root &&
      !target.startsWith(`${workspace.root}${path.sep}`)
    )
      throw new WorkspaceError('文件路径超出了工作区。', 403);
    await this.noSymlinks(workspace.root);
    await this.noSymlinks(allowMissing ? path.dirname(target) : target);
    if (allowMissing) {
      try {
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink())
          throw new WorkspaceError('不支持符号链接。', 403);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    return target;
  }

  async open(
    root: string,
    { recover = true, ...options }: { recover?: boolean } & ScanOptions = {}
  ): Promise<Workspace> {
    checkCancelled(options);
    if (!path.isAbsolute(root))
      throw new WorkspaceError('请输入目录的绝对路径。');
    const absolute = path.resolve(root);
    dataBoundary(absolute, this.dataRoots);
    assertWorkspaceRoot(absolute);
    const boundary =
      this.dataRoots === null
        ? path.parse(absolute).root
        : this.dataRoots
            .filter((candidate) => {
              const relative = path.relative(candidate, absolute);
              return (
                relative === '' ||
                (!path.isAbsolute(relative) &&
                  relative !== '..' &&
                  !relative.startsWith(`..${path.sep}`))
              );
            })
            .sort((a, b) => a.length - b.length)[0];
    await this.noSymlinks(absolute);
    if (!(await fs.stat(absolute)).isDirectory())
      throw new WorkspaceError('请选择一个目录。');
    const existing = [...this.roots.values()].find(
      (item) => item.root === absolute
    );
    if ([...this.changing].some((root) => overlappingRoots(root, absolute)))
      throw new WorkspaceError('工作区正在处理文件，请稍后重试。', 423);
    await this.exclusive(
      absolute,
      async () => {
        await checkRecoveryScope(absolute, boundary, undefined, options);
        // A different root must be recovered at its own journal location.
        if (
          [...this.recoveryBlocked].some(
            (root) => root !== absolute && overlappingRoots(root, absolute)
          )
        )
          throw new WorkspaceError(
            '文件操作恢复遇到冲突，请检查 .noteai-operations 后重新打开工作区。',
            409
          );
        checkCancelled(options);
        this.changing.add(absolute);
        let recovered = false;
        try {
          if (recover)
            recovered = await this.operationContext.run(absolute, () =>
              recoverTransactions(absolute, () => {
                checkCancelled(options);
                reportProgress(options, {
                  stage: 'recovering',
                  cancellable: false,
                });
              })
            );
          else
            await this.operationContext.run(absolute, () =>
              assertTransactionsSettled(absolute)
            );
          this.recoveryBlocked.delete(absolute);
        } catch (error) {
          if (!(options.signal?.aborted && error === options.signal.reason))
            this.recoveryBlocked.add(absolute);
          throw error;
        } finally {
          this.changing.delete(absolute);
        }
        // Recovery can restore directories that were staged inside an internal tree.
        if (recovered)
          await checkRecoveryScope(absolute, boundary, undefined, options);
      },
      () => reportProgress(options, { stage: 'waiting', cancellable: false })
    );
    checkCancelled(options);
    const settings = await this.readSettings(absolute);
    checkCancelled(options);
    if (existing) {
      existing.settings = settings;
      return existing;
    }
    const workspace = {
      id: randomUUID(),
      settings,
      root: absolute,
      name: path.basename(absolute) || absolute,
    };
    this.roots.set(workspace.id, workspace);
    return workspace;
  }

  async tree(
    id: string,
    options?: ScanOptions,
    includeResources = false
  ): Promise<TreeEntry[]> {
    checkCancelled(options);
    reportProgress(options, { stage: 'tree', entries: 0, cancellable: true });
    const { settings } = await this.settings(id);
    const root = await this.resolve(id, '');
    let count = 0;
    let inspected = 0;
    const walk = async (
      directory: string,
      prefix = '',
      depth = 0
    ): Promise<TreeEntry[]> => {
      checkCancelled(options);
      if (depth > 30)
        throw new WorkspaceError('目录层级太深，请打开更小的子目录。');
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const result: TreeEntry[] = [];
      for (const entry of entries) {
        checkCancelled(options);
        reportProgress(options, {
          stage: 'tree',
          entries: ++inspected,
          cancellable: true,
        });
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.isSymbolicLink()
        )
          continue;
        if (
          !entry.isDirectory() &&
          !(entry.isFile() && MD_EXTENSION.test(entry.name))
        )
          continue;
        if (++count > 5000)
          throw new WorkspaceError(
            '目录超过 5000 个条目，请打开更小的子目录。'
          );
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        let resource = entry.isDirectory() && isResourceDirectory(entry.name);
        if (entry.isDirectory() && !resource) {
          if (
            rules(settings).some(
              (r) =>
                r.mode === 'fixed' &&
                [r.images, r.attachments].some((d) => relative === d)
            )
          ) {
            await assertResourceDirectory(this.workspace(id).root, relative);
            resource = true;
          }
          if (
            rules(settings).some((r) => r.mode === 'sibling') &&
            entries.some((e) => e.isFile() && e.name === `${entry.name}.md`)
          ) {
            try {
              await assertResourceDirectory(this.workspace(id).root, relative);
              resource = true;
            } catch {
              /* Ambiguous content stays visible; mutations reject it. */
            }
          }
        }
        if (resource && !includeResources) continue;
        const target = await this.resolve(id, relative);
        result.push({
          name: entry.name,
          path: relative,
          kind: entry.isDirectory() ? 'directory' : 'file',
          ...(resource
            ? { resource: true }
            : entry.isDirectory()
              ? { children: await walk(target, relative, depth + 1) }
              : {}),
        });
      }
      return result.sort(
        (a, b) =>
          Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
          a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
      );
    };
    return walk(root);
  }

  private async bytes(target: string, limit = MAX_BYTES) {
    const handle = await fs.open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new WorkspaceError('请选择普通文件。');
      if (stat.size > limit)
        throw new WorkspaceError('文件过大，请使用其他工具打开。', 413);
      return { data: await handle.readFile(), stat };
    } finally {
      await handle.close();
    }
  }

  async read(id: string, relative: string): Promise<FileSnapshot> {
    if (!MD_EXTENSION.test(relative))
      throw new WorkspaceError('只支持 .md 文档。');
    await this.assertDocumentLocation(id, relative);
    const target = await this.resolve(id, relative);
    const { data } = await this.bytes(target);
    let content: string;
    try {
      content = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(data);
    } catch {
      throw new WorkspaceError('文档不是 UTF-8 编码，无法安全编辑。', 422);
    }
    return { path: relative, content, version: hash(data) };
  }

  async save(
    id: string,
    relative: string,
    content: string,
    version: string
  ): Promise<FileSnapshot> {
    const workspace = this.workspace(id);
    return this.exclusive(workspace.root, async () => {
      if (!MD_EXTENSION.test(relative))
        throw new WorkspaceError('只支持 .md 文档。');
      if (Buffer.byteLength(content) > MAX_BYTES)
        throw new WorkspaceError('文档超过 5 MB，无法保存。', 413);
      await this.assertDocumentLocation(id, relative);
      const target = await this.resolve(id, relative);
      const { data, stat } = await this.bytes(target);
      if (hash(data) !== version)
        throw new WorkspaceError('文件已在外部修改，自动保存已暂停。', 409);
      if (hash(content) === version)
        return { path: relative, content, version };
      const backupKey = `${workspace.root}/${relative}`;
      if (!this.backedUp.has(backupKey)) {
        const directory = path.join(workspace.root, BACKUPS);
        await makeDirectories(directory, workspace.root);
        await this.noSymlinks(directory);
        const backup = path.join(
          directory,
          `${hash(relative).slice(0, 12)}-${version.slice(0, 12)}-${path.basename(relative)}`
        );
        try {
          await createSynced(backup, data, stat.mode & 0o777);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        if (!(await this.bytes(backup)).data.equals(data))
          throw new WorkspaceError(
            '原文备份内容不一致，请保留备份并检查后再保存。',
            409
          );
        await syncFile(backup);
        await syncDirectory(directory);
        this.backedUp.add(backupKey);
      }
      const temporary = path.join(
        path.dirname(target),
        `.noteai-${randomUUID()}.tmp`
      );
      try {
        const handle = await fs.open(temporary, 'wx', stat.mode & 0o777);
        try {
          await handle.writeFile(content, 'utf8');
          await handle.chmod(stat.mode & 0o777);
          await syncHandle(handle);
        } finally {
          await handle.close();
        }
        await this.resolve(id, relative);
        if (hash((await this.bytes(target)).data) !== version)
          throw new WorkspaceError('文件已在外部修改，自动保存已暂停。', 409);
        await renameSynced(temporary, target);
      } finally {
        await fs.unlink(temporary).catch((error) => {
          if (!isMissing(error)) throw error;
        });
      }
      return { path: relative, content, version: hash(content) };
    });
  }

  private validateName(name: string, kind: 'file' | 'directory') {
    if (
      !name.trim() ||
      name !== name.trim() ||
      INVALID_NAME.test(name) ||
      name.startsWith('.') ||
      name === 'node_modules' ||
      (kind === 'directory' && isResourceDirectory(name))
    )
      throw new WorkspaceError('名称不能为空，不能以点开头或包含路径分隔符。');
    if (kind === 'file' && !MD_EXTENSION.test(name))
      throw new WorkspaceError('文档名称必须以 .md 结尾。');
  }

  async create(
    id: string,
    parent: string,
    name: string,
    kind: 'file' | 'directory',
    content = ''
  ) {
    const workspace = this.workspace(id);
    return this.exclusive(workspace.root, async () => {
      this.validateName(name, kind);
      if (Buffer.byteLength(content) > MAX_BYTES)
        throw new WorkspaceError('文档过大。', 413);
      const destination = parent;
      const relative = destination ? `${destination}/${name}` : name;
      if (destination.split('/').some(isResourceDirectory))
        throw new WorkspaceError('不能在资源目录中新建文档或文件夹。', 403);
      await this.assertDocumentLocation(id, relative);
      const target = await this.resolve(id, relative, true);
      if (kind === 'directory') {
        await fs.mkdir(target);
        await syncDirectory(target);
        await syncDirectory(path.dirname(target));
      } else await createSynced(target, content);
      return { path: relative };
    });
  }

  private async relocateDocument(
    id: string,
    relative: string,
    target: string,
    version?: string,
    migrateOnly = false
  ) {
    const workspace = this.workspace(id);
    return this.exclusive(workspace.root, async () => {
      this.changing.add(workspace.root);
      try {
        return await this.operationContext.run(workspace.root, async () => {
          const settings = (await this.settings(id)).settings;
          if (
            (await fs.stat(await this.resolve(id, relative))).isDirectory() &&
            rules(settings).some(
              (r) =>
                r.mode === 'fixed' &&
                [r.images, r.attachments, r.publicRoot]
                  .filter(Boolean)
                  .some((d) => d === relative || d.startsWith(`${relative}/`))
            )
          )
            throw new WorkspaceError(
              '目录包含固定资源或站点根，不能移动。',
              409
            );
          await this.assertDocumentLocation(id, relative);
          await this.assertDocumentLocation(id, target);
          await this.resolve(id, relative);
          await this.resolve(id, target, true);
          const paths = async () => {
            const result: string[] = [];
            const walk = (entries: TreeEntry[]) => {
              for (const e of entries) {
                if (e.resource) continue;
                if (e.kind === 'file') result.push(e.path);
                else walk(e.children ?? []);
              }
            };
            walk(await this.tree(id));
            return result;
          };
          return relocate(
            {
              root: workspace.root,
              read: async (p) => {
                const { data } = await this.bytes(await this.resolve(id, p));
                return {
                  path: p,
                  content: new TextDecoder('utf-8', {
                    fatal: true,
                    ignoreBOM: true,
                  }).decode(data),
                  version: hash(data),
                };
              },
              paths,
              settings: (await this.settings(id)).settings,
            },
            relative,
            target,
            version,
            migrateOnly
          );
        });
      } catch (error) {
        try {
          await recoverTransactions(workspace.root);
        } catch (recovery) {
          this.recoveryBlocked.add(workspace.root);
          throw recovery;
        }
        throw error;
      } finally {
        this.changing.delete(workspace.root);
      }
    });
  }
  async move(id: string, relative: string, parent: string, version: string) {
    const destination = parent;
    if (relative.split('/').some(isResourceDirectory))
      throw new WorkspaceError('不能直接移动资源目录中的文件。');
    if (!MD_EXTENSION.test(relative))
      throw new WorkspaceError('只能拖动 Markdown 文档。');
    if (destination.split('/').some(isResourceDirectory))
      throw new WorkspaceError('不能将文档移入资源目录。');
    if (!(await fs.stat(await this.resolve(id, destination))).isDirectory())
      throw new WorkspaceError('请选择目标文件夹。');
    return this.relocateDocument(
      id,
      relative,
      path.posix.join(destination, path.posix.basename(relative)),
      version
    );
  }
  async migrateResources(id: string, relative: string) {
    return this.relocateDocument(id, relative, relative, undefined, true);
  }
  async rename(id: string, relative: string, name: string, version?: string) {
    if (!relative) throw new WorkspaceError('不能重命名工作区根目录。');
    if (relative.split('/').some(isResourceDirectory))
      throw new WorkspaceError('资源目录由所属文档管理。');
    const stat = await fs.stat(await this.resolve(id, relative));
    this.validateName(name, stat.isDirectory() ? 'directory' : 'file');
    return this.relocateDocument(
      id,
      relative,
      path.posix.join(path.posix.dirname(relative), name),
      version
    );
  }

  async asset(id: string, relative: string) {
    const mime: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.avif': 'image/avif',
    };
    const type = mime[path.extname(relative).toLowerCase()];
    if (!type) throw new WorkspaceError('不支持预览此资源格式。', 415);
    const target = await this.resolve(id, relative);
    return { data: (await this.bytes(target, 20 * 1024 * 1024)).data, type };
  }

  private async resourceFolder(
    id: string,
    document: string,
    kind: 'images' | 'attachments'
  ) {
    const root = this.workspace(id).root;
    const snapshot = await this.readSettings(root);
    await validateSettings(
      root,
      {
        resources: snapshot.settings.resources,
      },
      snapshot.settings
    );
    await ownedResources(root, document, snapshot.settings);
    const directory = uploadDirectory(
      document,
      kind,
      snapshot.settings.resources
    );
    const folder = await safePath(root, directory, true);
    if (
      await fs
        .stat(folder)
        .then(() => true)
        .catch(() => false)
    )
      await assertResourceDirectory(root, directory);
    await makeDirectories(folder, root);
    await this.noSymlinks(folder);
    return { folder, directory, ...snapshot };
  }

  async uploadImage(
    id: string,
    document: string,
    data: Uint8Array,
    signal?: AbortSignal,
    originalName?: string,
    expectedRevision?: string
  ) {
    const extension = imageExtension(data);
    const revision = (await this.settings(id)).revision;
    if (expectedRevision && expectedRevision !== revision)
      throw new WorkspaceError('资源设置已变化，请重新打开文档后上传。', 409);
    const workspace = this.workspace(id);
    return this.exclusive(workspace.root, async () => {
      await this.read(id, document);
      signal?.throwIfAborted();
      const resource = await this.resourceFolder(id, document, 'images');
      if (resource.revision !== revision)
        throw new WorkspaceError('资源设置已变化，请重新上传。', 409);
      const { directory, folder: absolute } = resource;
      const safeName = originalName
        ?.replace(UNSAFE_IMAGE_NAME, '_')
        .slice(0, 100);
      const name = safeName
        ? `${randomUUID()}--${safeName.replace(FILE_EXTENSION, '')}.${extension}`
        : `${randomUUID()}.${extension}`;
      const relative = `${directory}/${name}`;
      const target = await this.resolve(id, relative, true);
      const temporary = path.join(absolute, `.upload-${randomUUID()}`);
      try {
        await writeSynced(temporary, data, 'wx', 0o600);
        signal?.throwIfAborted();
        await this.noSymlinks(absolute);
        if ((await this.settings(id)).revision !== revision)
          throw new WorkspaceError('资源设置已变化，请重新上传。', 409);
        await renameSynced(temporary, target);
      } finally {
        await fs.unlink(temporary).catch(() => undefined);
      }
      return {
        path: relative,
        url: resourceUrl(document, relative, resource.settings.resources),
      };
    });
  }

  async uploadAttachment(
    id: string,
    document: string,
    name: string,
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
    expectedRevision?: string
  ) {
    if (
      !name.trim() ||
      name === '.' ||
      name === '..' ||
      INVALID_ATTACHMENT_NAME.test(name)
    )
      throw new WorkspaceError('附件文件名无效，请重命名后重试。');
    if (Buffer.byteLength(name) > 217)
      throw new WorkspaceError('附件文件名过长，请缩短后重试。');
    const workspace = this.workspace(id);
    const revision = (await this.settings(id)).revision;
    if (expectedRevision && expectedRevision !== revision)
      throw new WorkspaceError('资源设置已变化，请重新打开文档后上传。', 409);
    return this.exclusive(workspace.root, async () => {
      signal?.throwIfAborted();
      await this.read(id, document);
      const resource = await this.resourceFolder(id, document, 'attachments');
      if (resource.revision !== revision)
        throw new WorkspaceError('资源设置已变化，请重新上传。', 409);
      const { directory, folder: absolute } = resource;
      const storedName = `${randomUUID()}--${name}`;
      const relative = `${directory}/${storedName}`;
      const target = await this.resolve(id, relative, true);
      const temporary = path.join(absolute, `.attachment-${randomUUID()}`);
      const handle = await fs.open(temporary, 'wx', 0o600);
      const reader = body.getReader();
      const abort = () => {
        void reader.cancel().catch(() => undefined);
      };
      signal?.addEventListener('abort', abort, { once: true });
      let size = 0;
      try {
        while (true) {
          signal?.throwIfAborted();
          const chunk = await reader.read();
          signal?.throwIfAborted();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_ATTACHMENT_BYTES)
            throw new WorkspaceError('附件不能超过 100 MB。', 413);
          let offset = 0;
          while (offset < chunk.value.byteLength) {
            const { bytesWritten } = await handle.write(
              chunk.value,
              offset,
              chunk.value.byteLength - offset
            );
            if (!bytesWritten)
              throw new WorkspaceError('附件写入失败，请检查磁盘空间。');
            offset += bytesWritten;
          }
        }
        await syncHandle(handle);
        await handle.close();
        signal?.throwIfAborted();
        await this.noSymlinks(absolute);
        await this.read(id, document);
        signal?.throwIfAborted();
        if ((await this.settings(id)).revision !== revision)
          throw new WorkspaceError('资源设置已变化，请重新上传。', 409);
        await renameSynced(temporary, target);
        return {
          path: relative,
          url: resourceUrl(document, relative, resource.settings.resources),
          name,
          size,
        };
      } finally {
        signal?.removeEventListener('abort', abort);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        await handle.close().catch(() => undefined);
        await fs.unlink(temporary).catch(() => undefined);
      }
    });
  }

  async resourceImage(id: string, relative: string, signal?: AbortSignal) {
    const { settings } = await this.settings(id);
    await this.resolve(id, relative);
    await assertResourcePath(
      this.workspace(id).root,
      relative,
      settings,
      false,
      signal
    );
    const image = await this.asset(id, relative);
    imageExtension(image.data);
    return image;
  }

  async resources(
    id: string,
    relative: string,
    cursor?: string,
    signal?: AbortSignal
  ) {
    const { settings, revision } = await this.settings(id);
    await this.resolve(id, relative);
    return listResources(
      this.workspace(id).root,
      relative,
      settings,
      revision,
      cursor,
      signal
    );
  }

  async resourceDownload(
    id: string,
    relative: string,
    signal?: AbortSignal,
    metadataOnly = false
  ) {
    const { settings } = await this.settings(id);
    await this.resolve(id, relative);
    await assertResourcePath(
      this.workspace(id).root,
      relative,
      settings,
      false,
      signal
    );
    const result = await this.downloadFile(id, relative, signal, metadataOnly);
    return { ...result, name: path.basename(relative) };
  }

  async attachment(
    id: string,
    relative: string,
    signal?: AbortSignal,
    metadataOnly = false
  ) {
    const { settings } = await this.settings(id);
    const parts = relative.split('/');
    let ownedMatch = false;
    for (const rule of rules(settings))
      if (rule.mode !== 'fixed')
        for (let i = 0; i < parts.length - 1; i++) {
          const folder = parts.slice(0, i + 1).join('/');
          if (rule.mode === 'assets' && !folder.endsWith('.assets')) continue;
          const document = `${rule.mode === 'assets' ? folder.slice(0, -7) : folder}.md`;
          if (
            !relative.startsWith(
              `${uploadDirectory(document, 'attachments', rule)}/`
            )
          )
            continue;
          const file = await safePath(this.workspace(id).root, document, true);
          if (
            await fs
              .stat(file)
              .then((s) => s.isFile())
              .catch(() => false)
          ) {
            await assertResourceDirectory(this.workspace(id).root, folder);
            ownedMatch = true;
          }
        }
    if (
      !isAttachmentPath(relative) &&
      !ownedMatch &&
      !rules(settings).some(
        (r) => r.mode === 'fixed' && relative.startsWith(`${r.attachments}/`)
      )
    )
      throw new WorkspaceError('只能下载附件目录中的文件。', 403);
    return this.downloadFile(id, relative, signal, metadataOnly);
  }

  private async downloadFile(
    id: string,
    relative: string,
    signal?: AbortSignal,
    metadataOnly = false
  ) {
    const target = await this.resolve(id, relative);
    signal?.throwIfAborted();
    const handle = await fs.open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new WorkspaceError('请选择普通附件文件。');
      signal?.throwIfAborted();
      if (metadataOnly) {
        await handle.close();
        return {
          stream: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          }),
          size: stat.size,
          name: attachmentName(path.basename(relative)),
        };
      }
      const source = handle.createReadStream({
        autoClose: true,
        highWaterMark: 64 * 1024,
      });
      const stream = Readable.toWeb(source, {
        strategy: {
          highWaterMark: 64 * 1024,
          size: (chunk: Uint8Array) => chunk.byteLength,
        },
      }) as ReadableStream<Uint8Array>;
      const abort = () => {
        source.destroy();
      };
      signal?.addEventListener('abort', abort, { once: true });
      source.once('close', () => signal?.removeEventListener('abort', abort));
      return {
        stream,
        size: stat.size,
        name: attachmentName(path.basename(relative)),
      };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async search(
    id: string,
    query: string,
    exclude: string[] = [],
    signal?: AbortSignal
  ): Promise<SearchResponse> {
    const paths: string[] = [];
    const excluded = new Set(exclude);
    const collect = (entries: TreeEntry[]) => {
      for (const entry of entries) {
        if (entry.resource) continue;
        if (entry.kind === 'file' && !excluded.has(entry.path))
          paths.push(entry.path);
        if (entry.children) collect(entry.children);
      }
    };
    collect(await this.tree(id));
    const results: SearchResponse['results'] = [];
    const skipped: SearchResponse['skipped'] = [];
    let cursor = 0;
    if (!query.trim()) return { results, skipped, truncated: false };
    if (query.length > 200)
      throw new WorkspaceError('搜索词不能超过 200 个字符。');
    await Promise.all(
      Array.from({ length: Math.min(4, paths.length) }, async () => {
        while (cursor < paths.length && !signal?.aborted) {
          const relative = paths[cursor++];
          try {
            const file = await this.read(id, relative);
            const result = searchDocument(relative, file.content, query);
            if (result) results.push(result);
          } catch {
            skipped.push({
              path: relative,
              reason: '文件无法读取或超出大小／编码限制',
            });
          }
        }
      })
    );
    return {
      results: rankResults(results).slice(0, 200),
      skipped,
      truncated: results.length > 200,
    };
  }
}
