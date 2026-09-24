import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileService } from '../../src/features/workspace/server/files';
import { FileTransaction, recoverTransactions } from '../../src/features/workspace/server/file-transaction';
import { makeDirectories } from '../../src/features/workspace/server/durable-fs';

// Scope all injected I/O to a temporary fixture and restore the primitive even on failure.
async function instrument(root: string, run: (events: string[], fail: (predicate: (target: string) => boolean) => void) => Promise<void>) {
  const probe = await fs.open(root, 'r');
  const prototype = Object.getPrototypeOf(probe); const original = prototype.sync; await probe.close();
  const events: string[] = []; let predicate = (_target: string) => false;
  async function locate(target: string, dev: number, ino: number): Promise<string | undefined> {
    const stat = await fs.lstat(target);
    if (stat.dev === dev && stat.ino === ino) return target;
    if (stat.isDirectory()) for (const name of await fs.readdir(target)) {
      const found = await locate(path.join(target, name), dev, ino); if (found) return found;
    }
  }
  prototype.sync = async function(this: fs.FileHandle) {
    const stat = await this.stat(); const target = await locate(root, stat.dev, stat.ino);
    if (target) {
      events.push(target);
      if (predicate(target)) throw Object.assign(new Error('injected sync failure'), {code: 'EIO'});
    }
    return original.call(this);
  };
  try { await run(events, next => { predicate = next; }); } finally { prototype.sync = original; }
}
async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-durable-')));
  try { await run(root); } finally { await fs.rm(root, {recursive: true, force: true}); }
}

test('save syncs its backup before replacement; late directory failure reports uncertainty and preserves bytes', async () => fixture(async root => {
  const file = path.join(root, 'note.md'); await fs.writeFile(file, 'original');
  const service = new FileService(undefined, [root]); const workspace = await service.open(root); const before = await service.read(workspace.id, 'note.md');
  await instrument(root, async (events, fail) => {
    let fired = false;
    fail(target => target === root && !fired && events.some(x => path.basename(x).startsWith('.noteai-') && x.endsWith('.tmp') && path.dirname(x) === root) && (fired = true));
    await assert.rejects(service.save(workspace.id, 'note.md', 'saved', before.version), (e: any) => e.status === 503);
    assert.equal(fired, true); assert.equal(await fs.readFile(file, 'utf8'), 'saved');
    const backupDir = path.join(root, '.noteai-backups'); const backup = (await fs.readdir(backupDir)).find(n => n.endsWith('note.md'))!;
    assert.equal(await fs.readFile(path.join(backupDir, backup), 'utf8'), 'original');
    const staged = events.findIndex(x => path.basename(x).startsWith('.noteai-') && x.endsWith('.tmp') && path.dirname(x) === root);
    assert.ok(events.indexOf(path.join(backupDir, backup)) < staged);
    assert.ok(events.indexOf(backupDir) < staged);
    fail(() => false);
    await assert.rejects(service.save(workspace.id, 'note.md', 'retry', before.version), (e: any) => e.status === 409);
    assert.equal(await fs.readFile(file, 'utf8'), 'saved');
  });
}));

test('failed backup sync prevents replacing original, and new-file sync failure never publishes a partial file', async () => fixture(async root => {
  const file = path.join(root, 'note.md'); await fs.writeFile(file, 'original');
  const service = new FileService(undefined, [root]); const workspace = await service.open(root); const before = await service.read(workspace.id, 'note.md');
  await instrument(root, async (_events, fail) => {
    fail(target => target.includes('.noteai-backups') && target.endsWith('.tmp'));
    await assert.rejects(service.save(workspace.id, 'note.md', 'edited', before.version));
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    fail(target => path.basename(target).startsWith('.noteai-create-'));
    await assert.rejects(service.create(workspace.id, '', 'new.md', 'file', 'complete'));
    await assert.rejects(fs.stat(path.join(root, 'new.md')), (e: any) => e.code === 'ENOENT');
    fail(() => false); await service.save(workspace.id, 'note.md', 'edited', before.version);
    assert.equal(await fs.readFile(file, 'utf8'), 'edited');
  });
}));

test('mkdir retries sync existing ancestors, and rollback retries after a rename sync failure', async () => fixture(async root => {
  await instrument(root, async (events, fail) => {
    const nested = path.join(root, 'one', 'two'); await makeDirectories(nested, root);
    assert.deepEqual(events.slice(-3), [nested, path.dirname(nested), root]);
    events.length = 0; await makeDirectories(nested, root);
    assert.deepEqual(events, [nested, path.dirname(nested), root]);
    const source = path.join(root, 'a.md'); await fs.writeFile(source, 'A');
    const tx = new FileTransaction(root); await tx.prepare(); await tx.move('a.md', 'one/a.md');
    fail(target => target === path.join(root, 'one'));
    await assert.rejects(tx.commit());
    // Rename may already have been rolled back, but journal must remain recoverable.
    const journal = JSON.parse(await fs.readFile(path.join(root, tx.directory, 'journal.json'), 'utf8'));
    assert.equal(journal.state, 'prepared');
    fail(() => false); await recoverTransactions(root);
    assert.equal(await fs.readFile(source, 'utf8'), 'A');
    await assert.rejects(fs.stat(path.join(root, 'one/a.md')));
    assert.equal(JSON.parse(await fs.readFile(path.join(root, tx.directory, 'journal.json'), 'utf8')).state, 'rolled-back');
  });
}));

test('failure after the committed journal rename does not roll back behind that marker', async () => fixture(async root => {
  await fs.writeFile(path.join(root, 'a.md'), 'A');
  const tx = new FileTransaction(root); await tx.prepare(); await tx.move('a.md', 'b.md');
  const journalPath = path.join(root, tx.directory, 'journal.json');
  await instrument(root, async (_events, fail) => {
    let syncs = 0;
    // prepared, attempted, committed: fail only the committed marker directory sync.
    fail(target => target === path.join(root, tx.directory) && ++syncs === 3);
    await assert.rejects(tx.commit(), (e: any) => e.status === 503);
    assert.equal(JSON.parse(await fs.readFile(journalPath, 'utf8')).state, 'committed');
    assert.equal(await fs.readFile(path.join(root, 'b.md'), 'utf8'), 'A');
    fail(() => false); await recoverTransactions(root);
    assert.equal(await fs.readFile(path.join(root, 'b.md'), 'utf8'), 'A');
    await assert.rejects(fs.stat(path.join(root, 'a.md')));
  });
}));

test('every commit sync boundary can fail once without losing the sole document during recovery', async () => {
  for (let failureAt = 1; failureAt <= 8; failureAt++) await fixture(async root => {
    await fs.writeFile(path.join(root, 'a.md'), 'A');
    const tx = new FileTransaction(root); await tx.prepare(); await tx.move('a.md', 'b.md');
    await instrument(root, async (_events, fail) => {
      let count = 0; fail(() => ++count === failureAt);
      await assert.rejects(tx.commit());
      fail(() => false); await recoverTransactions(root);
      const a = await fs.readFile(path.join(root, 'a.md'), 'utf8').catch(() => undefined);
      const b = await fs.readFile(path.join(root, 'b.md'), 'utf8').catch(() => undefined);
      assert.ok((a === 'A' && b === undefined) || (b === 'A' && a === undefined));
      const record = await fs.readFile(path.join(root, tx.directory, 'journal.json'), 'utf8').catch(() => undefined);
      if (record) assert.equal(JSON.parse(record).state, b ? 'committed' : 'rolled-back');
    });
  });
});

test('image publication syncs bytes before its directory and failed image sync does not publish', async () => fixture(async root => {
  await fs.writeFile(path.join(root, 'note.md'), 'note');
  const service = new FileService(undefined, [root]); const workspace = await service.open(root);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await instrument(root, async (events, fail) => {
    fail(target => path.basename(target).startsWith('.upload-'));
    await assert.rejects(service.uploadImage(workspace.id, 'note.md', png));
    const folder = path.join(root, 'note.assets', 'images'); assert.deepEqual(await fs.readdir(folder), []);
    fail(() => false); events.length = 0;
    await service.uploadImage(workspace.id, 'note.md', png);
    const dataIndex = events.findIndex(target => path.basename(target).startsWith('.upload-'));
    assert.ok(dataIndex >= 0 && events.lastIndexOf(folder) > dataIndex);
  });
}));

test('settings publication sync failure is not success and retains complete settings for reload', async () => fixture(async root => {
  const { ServiceSettingsStore } = await import('../../src/features/workspace/server/service-settings');
  const service = new FileService(undefined, [root]); const workspace = await service.open(root);
  const settings = await service.settings(workspace.id);
  const {resources} = settings.settings;
  const input = {resources};
  const store = new ServiceSettingsStore(path.join(root, 'config'));
  await instrument(root, async (events, fail) => {
    fail(target => target === root && events.some(x => path.basename(x).startsWith('.markdock-')));
    await assert.rejects(service.updateSettings(workspace.id, input, settings.revision), (e: any) => e.status === 503);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, '.markdock.json'), 'utf8')).version, 2);
    fail(() => false); const current = await service.settings(workspace.id);
    assert.notEqual(current.revision, 'absent');
    const initial = await store.read(); events.length = 0;
    fail(target => target === store.directory && events.some(x => path.basename(x).startsWith('.settings-')));
    await assert.rejects(store.update(initial.revision, s => s), (e: any) => e.status === 503);
    assert.equal(JSON.parse(await fs.readFile(path.join(store.directory, 'settings.json'), 'utf8')).version, 1);
    fail(() => false); assert.notEqual((await store.read()).revision, initial.revision);
  });
}));

test('purge sync failure keeps deleting metadata until data deletion is confirmed and retry completes', async () => fixture(async root => {
  await fs.writeFile(path.join(root, 'note.md'), 'note');
  const service = new FileService(undefined, [root]); const workspace = await service.open(root);
  const file = await service.read(workspace.id, 'note.md'); const entry = await service.trash(workspace.id, 'note.md', file.version);
  const directory = path.join(root, '.noteai-trash', entry.id);
  await instrument(root, async (_events, fail) => {
    let count = 0; fail(target => target === directory && ++count === 2);
    const result = await service.purge(workspace.id, [entry.id]); assert.equal(result.failed.length, 1);
    assert.equal((await service.trashList(workspace.id))[0].state, 'deleting');
    fail(() => false); assert.deepEqual((await service.purge(workspace.id, [entry.id])).failed, []);
    assert.deepEqual(await service.trashList(workspace.id), []);
    await assert.rejects(fs.stat(directory));
  });
}));

test('fresh service recovers after SIGKILL at journal and business-rename boundaries (not a power-loss test)', async () => {
  const { spawnSync } = await import('node:child_process');
  for (const phase of ['prepared', 'attempted', 'moved', 'committed']) await fixture(async root => {
    await fs.writeFile(path.join(root, 'a.md'), 'A');
    const moduleUrl = new URL('../../src/features/workspace/server/file-transaction.ts', import.meta.url).href;
    const script = path.join(root, 'crash-probe.ts');
    await fs.writeFile(script, `
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import { FileTransaction } from ${JSON.stringify(moduleUrl)};
      const root = process.argv[2], phase = process.argv[3];
      const tx = new FileTransaction(root); await tx.prepare(); await tx.move('a.md', 'b.md');
      const journalPath = path.join(root, tx.directory, 'journal.json');
      const probe = await fs.open(root, 'r'); const prototype = Object.getPrototypeOf(probe); const sync = prototype.sync; await probe.close();
      prototype.sync = async function() {
        const stat = await this.stat(); const journal = await fs.readFile(journalPath, 'utf8').then(JSON.parse).catch(() => undefined);
        const moved = await fs.stat(path.join(root, 'b.md')).then(() => true, () => false);
        if (stat.isDirectory() && journal && (
          (phase === 'prepared' && journal.state === 'prepared' && journal.attempted === 0) ||
          (phase === 'attempted' && journal.state === 'prepared' && journal.attempted === 1 && !moved) ||
          (phase === 'moved' && journal.state === 'prepared' && moved) ||
          (phase === 'committed' && journal.state === 'committed')
        )) process.kill(process.pid, 'SIGKILL');
        return sync.call(this);
      };
      await tx.commit();
    `);
    const result = spawnSync(process.execPath, ['--no-env-file', 'run', script, root, phase], {encoding: 'utf8', timeout: 10000, env: {PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test'}});
    assert.equal(result.signal, 'SIGKILL', result.stderr);
    const service = new FileService(undefined, [root]); const workspace = await service.open(root);
    const surviving = phase === 'committed' ? 'b.md' : 'a.md';
    assert.equal((await service.read(workspace.id, surviving)).content, 'A');
    await assert.rejects(fs.stat(path.join(root, surviving === 'a.md' ? 'b.md' : 'a.md')));
  });
});
