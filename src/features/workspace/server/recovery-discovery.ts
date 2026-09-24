import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  checkCancelled,
  reportProgress,
  type ScanOptions,
} from '../shared/open-progress';
import { WorkspaceError } from '../shared/types';
import {
  assertTransactionsSettled,
  OPERATIONS,
  safePath,
} from './file-transaction';
import { workspaceOperations } from './workspace-lock';

const INTERNAL = new Set([OPERATIONS, '.noteai-trash', '.noteai-backups']);
const MAX_ENTRIES = 100_000;
const MAX_DEPTH = 128;

export function assertWorkspaceRoot(root: string) {
  if (root.split(path.sep).some((part) => INTERNAL.has(part)))
    throw new WorkspaceError('不能将备份、垃圾箱或事务目录作为工作区。', 403);
}

/** Read-only; caller holds the overlapping-root lock. Never recover a foreign root. */
export async function checkRecoveryScope(
  selectedRoot: string,
  allowedBoundary: string,
  maxEntries = MAX_ENTRIES,
  options?: ScanOptions & { includeExcluded?: boolean }
) {
  if (!path.isAbsolute(selectedRoot) || !path.isAbsolute(allowedBoundary))
    throw new WorkspaceError('操作路径无效。', 403);
  const root = path.resolve(selectedRoot);
  const boundary = path.resolve(allowedBoundary);
  const relative = path.relative(boundary, root);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new WorkspaceError('操作路径无效。', 403);
  checkCancelled(options);
  let entries = 0;
  reportProgress(options, { stage: 'checking', entries, cancellable: true });
  const consume = () => {
    checkCancelled(options);
    if (++entries > maxEntries)
      throw new WorkspaceError(
        '恢复检查范围过大，请选择更小的工作区目录。',
        413
      );
    reportProgress(options, { stage: 'checking', entries, cancellable: true });
  };
  async function inspect(owner: string) {
    if (owner === root) return;
    try {
      await assertTransactionsSettled(owner);
      workspaceOperations.recoveryBlocked.delete(owner);
    } catch (cause) {
      workspaceOperations.recoveryBlocked.add(owner);
      const error = new WorkspaceError(
        `发现其他工作区的未完成或无效操作记录，请先处理原工作区：${owner}`,
        409
      );
      error.cause = cause;
      throw error;
    }
  }
  // Only ancestors inside the deployment boundary; never scan their siblings.
  for (let cursor = root; cursor !== boundary; ) {
    checkCancelled(options);
    const ancestor = path.dirname(cursor);
    await inspect(ancestor);
    cursor = ancestor;
  }
  async function walk(directory: string, depth: number) {
    checkCancelled(options);
    if (depth > MAX_DEPTH)
      throw new WorkspaceError(
        '恢复检查范围过大，请选择更小的工作区目录。',
        413
      );
    await safePath(root, path.relative(root, directory));
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new WorkspaceError(
        '恢复检查未完成，请检查目录权限和路径后重试。',
        409
      );
    let hasRecords = false;
    for await (const entry of await fs.opendir(directory)) {
      checkCancelled(options);
      if (
        entry.name !== OPERATIONS &&
        !options?.includeExcluded &&
        (entry.name.startsWith('.') || entry.name === 'node_modules')
      )
        continue;
      consume();
      if (entry.name === OPERATIONS) {
        hasRecords = true;
        // Inspect even a symlinked journal directory: it must fail closed.
        await inspect(directory);
      }
      if (INTERNAL.has(entry.name) || entry.isSymbolicLink()) continue;
      // Directory entries already identify ordinary files and special devices.
      // Avoid one filesystem round trip per dependency/build file. Unknown
      // entry types still require lstat; all directories retain safePath checks.
      if (
        entry.isFile() ||
        entry.isBlockDevice() ||
        entry.isCharacterDevice() ||
        entry.isFIFO() ||
        entry.isSocket()
      )
        continue;
      const target = path.join(directory, entry.name);
      // lstat also covers filesystems whose dirent has unknown type.
      const child = await fs.lstat(target);
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) await walk(target, depth + 1);
    }
    if (!hasRecords && directory !== root)
      workspaceOperations.recoveryBlocked.delete(directory);
  }
  try {
    await walk(root, 0);
  } catch (cause) {
    checkCancelled(options);
    if (cause instanceof WorkspaceError) throw cause;
    const error = new WorkspaceError(
      '恢复检查未完成，请检查目录权限和路径后重试。',
      409
    );
    error.cause = cause;
    throw error;
  }
}

/** Destructive whole-directory operations include hidden data; opening does not. */
export async function assertDirectoryTransactions(
  root: string,
  relative: string
) {
  const target = await safePath(root, relative);
  await assertTransactionsSettled(target);
  await checkRecoveryScope(target, target, undefined, {
    includeExcluded: true,
  });
}
