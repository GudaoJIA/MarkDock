import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { WorkspaceError } from '../shared/types';
import {
  makeDirectories,
  renameSynced,
  syncDirectory,
  syncHandle,
  syncTree,
} from './durable-fs';
export const OPERATIONS = '.noteai-operations';
export type MoveStep = { from: string; to: string; fingerprint: string };
type Journal = {
  version: 1;
  state: 'prepared' | 'committed' | 'rolled-back';
  attempted: number;
  steps: MoveStep[];
};

const journalPath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !path.isAbsolute(value) &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      value
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..')
  );
const journalSchema = z
  .object({
    version: z.literal(1),
    state: z.enum(['prepared', 'committed', 'rolled-back']),
    attempted: z.number().int().nonnegative(),
    steps: z.array(
      z
        .object({
          from: journalPath,
          to: journalPath,
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .refine((step) => step.from !== step.to)
    ),
  })
  .strict()
  .refine((j) => j.attempted <= j.steps.length)
  .refine((j) => j.state !== 'committed' || j.attempted === j.steps.length)
  .refine((j) => j.state !== 'rolled-back' || j.attempted === 0);
export async function safePath(
  root: string,
  relative: string,
  missing = false
) {
  if (
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').includes('..') ||
    relative.includes('\0')
  )
    throw new WorkspaceError('操作路径无效。', 403);
  const target = path.join(root, relative);
  let current = path.parse(target).root;
  for (const part of target
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new WorkspaceError('不支持符号链接。', 403);
    } catch (error) {
      if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT')
        continue;
      throw error;
    }
  }
  return target;
}
export async function exists(root: string, relative: string) {
  try {
    await fs.lstat(await safePath(root, relative));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
export async function fingerprint(
  root: string,
  relative: string
): Promise<string> {
  const target = await safePath(root, relative);
  const stat = await fs.lstat(target);
  const hash = createHash('sha256');
  if (stat.isDirectory()) {
    hash.update('directory');
    for (const name of (await fs.readdir(target)).sort())
      hash.update(
        JSON.stringify([name, await fingerprint(root, `${relative}/${name}`)])
      );
  } else if (stat.isFile()) {
    hash.update(`file:${stat.mode & 0o777}:`);
    for await (const chunk of createReadStream(target)) hash.update(chunk);
  } else throw new WorkspaceError('资源目录包含非常规文件。', 403);
  return hash.digest('hex');
}
async function writeJournal(root: string, directory: string, journal: Journal) {
  const temporary = await safePath(root, `${directory}/journal.tmp`, true);
  const h = await fs.open(temporary, 'w', 0o600);
  try {
    await h.writeFile(JSON.stringify(journal));
    await syncHandle(h);
  } finally {
    await h.close();
  }
  await renameSynced(
    temporary,
    await safePath(root, `${directory}/journal.json`, true)
  );
}
async function rollback(root: string, directory: string, journal: Journal) {
  for (let index = journal.attempted - 1; index >= 0; index--) {
    const step = journal.steps[index];
    const from = await exists(root, step.from);
    const to = await exists(root, step.to);
    // Unexecuted steps may have their source produced by an earlier step.
    if (from && to)
      throw new WorkspaceError(
        '源位置与目标位置同时存在文件，恢复已暂停。',
        409
      );
    if (from) {
      // A previous rollback may have renamed successfully but failed its sync.
      await syncTree(await safePath(root, step.from));
      await syncDirectory(path.dirname(await safePath(root, step.from)));
      // A step that never ran may have had a nonexistent destination parent.
      if (await exists(root, path.posix.dirname(step.to)))
        await syncDirectory(await safePath(root, path.posix.dirname(step.to)));
      journal.attempted = index;
      await writeJournal(root, directory, journal);
      continue;
    }
    if (!to)
      throw new WorkspaceError('恢复所需的文件已丢失，请检查操作记录。', 409);
    if ((await fingerprint(root, step.to)) !== step.fingerprint)
      throw new WorkspaceError(
        '未完成操作涉及的文件已被外部修改，恢复已暂停。请保留 .noteai-operations 并检查文件。',
        409
      );
    await renameSynced(
      await safePath(root, step.to),
      await safePath(root, step.from, true)
    );
    journal.attempted = index;
    await writeJournal(root, directory, journal);
  }
  journal.state = 'rolled-back';
  await writeJournal(root, directory, journal);
}
async function readJournals(root: string) {
  const records: { directory: string; journal: Journal }[] = [];
  if (!(await exists(root, OPERATIONS))) return records;
  for (const name of await fs.readdir(await safePath(root, OPERATIONS))) {
    const directory = `${OPERATIONS}/${name}`;
    if (!(await exists(root, `${directory}/journal.json`))) continue;
    const raw = await fs.readFile(
      await safePath(root, `${directory}/journal.json`),
      'utf8'
    );
    let journal: Journal;
    try {
      journal = journalSchema.parse(JSON.parse(raw));
    } catch {
      throw new WorkspaceError(
        '文件操作记录无效，请保留记录并检查后再恢复。',
        409
      );
    }
    for (const step of journal.steps) {
      for (const relative of [step.from, step.to]) {
        // A transaction may use its own staged files, never another journal.
        if (
          relative === OPERATIONS ||
          (relative.startsWith(`${OPERATIONS}/`) &&
            (!relative.startsWith(`${directory}/`) ||
              ['journal.json', 'journal.tmp'].includes(
                path.basename(relative)
              )))
        )
          throw new WorkspaceError('文件操作记录包含无效恢复路径。', 409);
        if (journal.state === 'prepared') await safePath(root, relative, true);
      }
    }
    records.push({ directory, journal });
  }
  return records;
}

/** Read-only inspection must not perform even a successful recovery. */
export async function assertTransactionsSettled(root: string) {
  if (
    (await readJournals(root)).some(
      ({ journal }) => journal.state === 'prepared'
    )
  )
    throw new WorkspaceError(
      '存在未完成文件操作，请先恢复后再预览资源整理。',
      409
    );
}

export async function recoverTransactions(
  root: string,
  beforeRecover?: () => void
) {
  // Validate every record before the first recovery write.
  const records = await readJournals(root);
  let recovered = false;
  if (records.some(({ journal }) => journal.state === 'prepared'))
    beforeRecover?.();
  for (const { directory, journal } of records)
    if (journal.state === 'prepared') {
      await rollback(root, directory, journal);
      recovered = true;
    }
  return recovered;
}
export class FileTransaction {
  readonly directory = `${OPERATIONS}/${randomUUID()}`;
  readonly steps: MoveStep[] = [];
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  async prepare() {
    await makeDirectories(
      await safePath(this.root, this.directory, true),
      this.root
    );
  }
  async move(from: string, to: string) {
    this.steps.push({
      from,
      to,
      fingerprint: await fingerprint(this.root, from),
    });
  }
  async replace(source: string, target: string, content: string) {
    const n = this.steps.length;
    const prepared = `${this.directory}/new-${n}`;
    const backup = `${this.directory}/original-${n}`;
    const stat = await fs.stat(await safePath(this.root, source));
    const h = await fs.open(
      await safePath(this.root, prepared, true),
      'wx',
      stat.mode & 0o777
    );
    try {
      await h.writeFile(content);
      await h.chmod(stat.mode & 0o777);
      await syncHandle(h);
    } finally {
      await h.close();
    }
    this.steps.push({
      from: target,
      to: backup,
      fingerprint: await fingerprint(this.root, source),
    });
    this.steps.push({
      from: prepared,
      to: target,
      fingerprint: await fingerprint(this.root, prepared),
    });
  }
  async commit() {
    const journal: Journal = {
      version: 1,
      state: 'prepared',
      attempted: 0,
      steps: this.steps,
    };
    await writeJournal(this.root, this.directory, journal);
    try {
      for (const [index, step] of this.steps.entries()) {
        if (await exists(this.root, step.to))
          throw new WorkspaceError('目标位置已存在文件或资源目录。', 409);
        if ((await fingerprint(this.root, step.from)) !== step.fingerprint)
          throw new WorkspaceError('文件已在外部修改，操作已暂停。', 409);
        await syncTree(await safePath(this.root, step.from));
        journal.attempted = index + 1;
        await writeJournal(this.root, this.directory, journal);
        await renameSynced(
          await safePath(this.root, step.from),
          await safePath(this.root, step.to, true)
        );
      }
    } catch (error) {
      await rollback(this.root, this.directory, journal);
      throw error;
    }
    // If publishing the committed marker fails, disk may contain either marker.
    // Do not roll back using an in-memory state that contradicts that record.
    journal.state = 'committed';
    await writeJournal(this.root, this.directory, journal);
  }
}
