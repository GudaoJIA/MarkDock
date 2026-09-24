import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileService } from '../../src/features/workspace/server/files';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

test('parent and child saves share their write boundary, including separate service objects', async () => {
  for (const separate of [false, true]) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-lock-')));
    const release = deferred(); let saves: Promise<unknown>[] = [];
    try {
      const child = path.join(root, 'child'); await fs.mkdir(child);
      const filename = path.join(child, 'note.md'); await fs.writeFile(filename, 'original');
      const a = new FileService(undefined, [root]); const b = separate ? new FileService(undefined, [root]) : a;
      const parent = await a.open(root); const nested = await b.open(child);
      const before = await a.read(parent.id, 'child/note.md');
      const entered = deferred(); let reads = 0;
      for (const service of new Set([a, b])) {
        const original = (service as any).bytes.bind(service);
        (service as any).bytes = async (target: string) => {
          const result = await original(target);
          if (target === filename && ++reads === 1) { entered.resolve(); await release.promise; }
          return result;
        };
      }
      saves.push(a.save(parent.id, 'child/note.md', 'parent edit', before.version));
      await entered.promise;
      saves.push(b.save(nested.id, 'note.md', 'child edit', before.version));
      // Observe while the first writer is suspended, not just after both complete.
      await new Promise(r => setTimeout(r, 50)); const concurrentReads = reads;
      release.resolve(); const results = await Promise.allSettled(saves);
      assert.equal(concurrentReads, 1, 'child must wait for the parent write');
      assert.equal(results[0].status, 'fulfilled');
      assert.equal(results[1].status, 'rejected');
      assert.equal((results[1] as PromiseRejectedResult).reason.status, 409);
      assert.equal(await fs.readFile(filename, 'utf8'), 'parent edit');
    } finally { release.resolve(); await Promise.allSettled(saves); await fs.rm(root, {recursive: true, force: true}); }
  }
});

test('multi-file operations and failed recovery cannot be bypassed through a child workspace', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-busy-')));
  const release = deferred(); let deletion: Promise<unknown> | undefined;
  try {
    const child = path.join(root, 'child'); await fs.mkdir(child);
    await fs.writeFile(path.join(child, 'note.md'), 'original');
    const a = new FileService(undefined, [root]); const b = new FileService(undefined, [root]);
    const parent = await a.open(root); const nested = await b.open(child);
    const snapshot = await a.read(parent.id, 'child/note.md');
    const originalRead = a.read.bind(a); const entered = deferred();
    a.read = async (...args) => { entered.resolve(); await release.promise; return originalRead(...args); };
    deletion = a.trash(parent.id, 'child/note.md', snapshot.version);
    await entered.promise;
    const busy = (e: any) => e.status === 423;
    await assert.rejects(b.read(nested.id, 'note.md'), busy);
    await assert.rejects(b.create(nested.id, '', 'new.md', 'file'), busy);
    await assert.rejects(b.open(child), busy);
    release.resolve(); await deletion;
    const entry = (await a.trashList(parent.id))[0]; await a.restore(parent.id, entry.id);
    assert.equal((await b.read(nested.id, 'note.md')).content, 'original');
    const bad = path.join(root, '.noteai-operations', 'bad'); await fs.mkdir(bad);
    const journal = path.join(bad, 'journal.json'); await fs.writeFile(journal, '{broken');
    await assert.rejects(a.open(root));
    await assert.rejects(b.read(nested.id, 'note.md'), (e: any) => e.status === 409);
    await assert.rejects(b.open(child), (e: any) => e.status === 409);
    await fs.writeFile(journal, JSON.stringify({version: 1, state: 'rolled-back', attempted: 0, steps: []}));
    await a.open(root);
    assert.equal((await b.read(nested.id, 'note.md')).content, 'original');
  } finally { release.resolve(); await deletion?.catch(() => undefined); await fs.rm(root, {recursive: true, force: true}); }
});

test('external changes before final verification pause a save and preserve external content', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-external-')));
  try {
    const filename = path.join(root, 'note.md'); await fs.writeFile(filename, 'original');
    const service = new FileService(undefined, [root]); const workspace = await service.open(root);
    const snapshot = await service.read(workspace.id, 'note.md');
    const original = (service as any).bytes.bind(service); let reads = 0;
    (service as any).bytes = async (target: string) => {
      if (target === filename && ++reads === 2) await fs.writeFile(filename, 'external');
      return original(target);
    };
    await assert.rejects(service.save(workspace.id, 'note.md', 'local', snapshot.version), (e: any) => e.status === 409);
    assert.equal(await fs.readFile(filename, 'utf8'), 'external');
    assert.equal((await fs.readdir(root)).filter(name => name.endsWith('.tmp')).length, 0);
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test('unrelated roots proceed while overlapping waiters serialize and release after rejection', async () => {
  const { withWorkspaceLock } = await import('../../src/features/workspace/server/workspace-lock');
  const root = path.join(os.tmpdir(), 'markdock-queue-test');
  const entered = deferred(); const release = deferred(); const events: string[] = [];
  const first = withWorkspaceLock(root, async () => { entered.resolve(); await release.promise; throw new Error('expected'); });
  const outcome = first.catch(e => e.message); await entered.promise;
  const parent = withWorkspaceLock(path.dirname(root), async () => { events.push('parent'); });
  const child = withWorkspaceLock(path.join(root, 'child'), async () => { events.push('child'); });
  // Separate filesystem root avoids intersecting the queued parent's range.
  await withWorkspaceLock('/markdock-independent', async () => { events.push('independent'); });
  assert.deepEqual(events, ['independent']); release.resolve();
  assert.equal(await outcome, 'expected'); await Promise.all([parent, child]);
  assert.deepEqual(events, ['independent', 'parent', 'child']);
  const prefixGate = deferred(); const prefixEntered = deferred();
  const prefix = withWorkspaceLock(root, async () => { prefixEntered.resolve(); await prefixGate.promise; });
  await prefixEntered.promise;
  try { await withWorkspaceLock(root + '-other', async () => {}); } finally { prefixGate.resolve(); await prefix; }
});
