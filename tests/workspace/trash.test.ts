import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileService } from '../../src/features/workspace/server/files';
import { FileTransaction, recoverTransactions } from '../../src/features/workspace/server/file-transaction';
import { WorkspaceController } from '../../src/features/workspace/state/sessions';
import type { fileClient } from '../../src/features/workspace/shared/client';

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-trash-test-')));
  const service = new FileService(); const workspace = await service.open(root);
  await fs.mkdir(path.join(root, '目录/文章.assets/images'), { recursive: true });
  await fs.writeFile(path.join(root, '目录/文章.md'), '\uFEFF# 标题\r\n\r\n![图](文章.assets/images/a.png)\r\n');
  await fs.writeFile(path.join(root, '目录/文章.assets/images/a.png'), 'exact-image-bytes');
  await fs.mkdir(path.join(root, 'assets')); await fs.writeFile(path.join(root, 'assets/shared'), 'shared');
  const file = await service.read(workspace.id, '目录/文章.md');
  return { root, service, id: workspace.id, file, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
test('trash persists exact document and dedicated assets, stays hidden, restores across service restart', async () => {
  const f = await fixture();
  try {
    const entry = await f.service.trash(f.id, f.file.path, f.file.version);
    await assert.rejects(f.service.read(f.id, f.file.path));
    assert.equal((await f.service.search(f.id, '标题')).results.length, 0);
    await assert.rejects(f.service.read(f.id, `.noteai-trash/${entry.id}/document.md`));
    assert.equal(await fs.readFile(path.join(f.root, 'assets/shared'), 'utf8'), 'shared');
    await fs.rmdir(path.join(f.root, '目录'));
    const fresh = new FileService(); const workspace = await fresh.open(f.root);
    assert.equal((await fresh.trashList(workspace.id))[0].id, entry.id);
    await fresh.restore(workspace.id, entry.id);
    assert.equal((await fresh.read(workspace.id, f.file.path)).content, f.file.content);
    assert.equal(await fs.readFile(path.join(f.root, '目录/文章.assets/images/a.png'), 'utf8'), 'exact-image-bytes');
    assert.deepEqual(await fresh.trashList(workspace.id), []);
    await assert.rejects(fresh.restore(workspace.id, entry.id));
  } finally { await f.cleanup(); }
});
test('stale deletion and restore collisions never replace disk contents', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.trash(f.id, f.file.path, 'stale'), /外部修改/);
    const entry = await f.service.trash(f.id, f.file.path, f.file.version);
    await fs.writeFile(path.join(f.root, f.file.path), 'replacement');
    await assert.rejects(f.service.restore(f.id, entry.id), /同名/);
    assert.equal(await fs.readFile(path.join(f.root, f.file.path), 'utf8'), 'replacement');
    const second = await f.service.read(f.id, f.file.path);
    const again = await f.service.trash(f.id, f.file.path, second.version);
    assert.notEqual(again.id, entry.id);
    await fs.mkdir(path.join(f.root, '目录/文章.assets'));
    await assert.rejects(f.service.restore(f.id, entry.id), /同名/);
    assert.equal((await f.service.trashList(f.id)).length, 2);
  } finally { await f.cleanup(); }
});
test('purge is scoped, retryable and preserves independent backups; unsafe entries fail separately', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.root, '.noteai-backups')); await fs.writeFile(path.join(f.root, '.noteai-backups/keep'), 'backup');
    const first = await f.service.trash(f.id, f.file.path, f.file.version);
    await fs.writeFile(path.join(f.root, f.file.path), 'second');
    const second = await f.service.read(f.id, f.file.path);
    const next = await f.service.trash(f.id, f.file.path, second.version);
    const result = await f.service.purge(f.id, [first.id, '../outside']);
    assert.equal(result.failed.length, 1);
    assert.deepEqual((await f.service.trashList(f.id)).map(e => e.id), [next.id]);
    assert.deepEqual(await f.service.purge(f.id, [first.id]), { failed: [] });
    assert.equal(await fs.readFile(path.join(f.root, '.noteai-backups/keep'), 'utf8'), 'backup');
    const manifest = path.join(f.root, `.noteai-trash/${next.id}/entry.json`);
    await fs.writeFile(manifest, JSON.stringify({ ...next, path: '../../outside.md' }));
    await assert.rejects(f.service.restore(f.id, next.id), /记录无效/);
    assert.equal((await f.service.purge(f.id, [next.id])).failed.length, 1);
  } finally { await f.cleanup(); }
});
test('resource symlinks are rejected before moving and interrupted multi-file moves roll back', async () => {
  const f = await fixture();
  try {
    const link = path.join(f.root, '目录/文章.assets/link');
    await fs.symlink(path.join(f.root, 'assets'), link);
    await assert.rejects(f.service.trash(f.id, f.file.path, f.file.version), /符号链接/);
    assert.equal((await f.service.read(f.id, f.file.path)).content, f.file.content);
    await fs.unlink(link);
    const tx = new FileTransaction(f.root); await tx.prepare();
    await tx.move(f.file.path, `${tx.directory}/document.md`);
    await tx.move('目录/文章.assets', `${tx.directory}/assets`);
    await fs.writeFile(path.join(f.root, tx.directory, 'journal.json'), JSON.stringify({ version: 1, state: 'prepared', attempted: 1, steps: tx.steps }));
    await fs.rename(path.join(f.root, f.file.path), path.join(f.root, tx.directory, 'document.md'));
    await recoverTransactions(f.root);
    assert.equal((await f.service.read(f.id, f.file.path)).content, f.file.content);
  } finally { await f.cleanup(); }
});

test('sessions save latest drafts before trash, block failed saves and uploads, and restore a fresh baseline', async () => {
  const f = await fixture();
  const service = f.service;
  const client: typeof fileClient = {browse: async () => { throw new Error('unused'); },settings:id=>f.service.settings(id),saveSettings:(...a)=>f.service.updateSettings(...a),
    open: root => service.open(root), read: (...args) => service.read(...args), tree: id => service.tree(id),
    save: (...args) => service.save(...args), create: (...args) => service.create(...args),
    rename: (...args) => service.rename(...args), move: (...args) => service.move(...args),
    trashList: id => service.trashList(id), trash: (...args) => service.trash(...args),
    restore: (...args) => service.restore(...args), purge: (...args) => service.purge(...args),
  };
  const controller = new WorkspaceController(client, { create: file => {
    const editor = { content: file.content }; return { editor, serialize: () => editor.content };
  }});
  try {
    await controller.open(f.root); await controller.select(f.file.path);
    const doc = controller.active!;
    const finish = controller.beginTask(doc)!;
    assert.equal(await controller.trash(doc.path), undefined); finish();
    doc.editor.content = '最新草稿'; controller.changed(doc);
    const save = client.save; client.save = async () => { throw new Error('保存失败'); };
    assert.equal(await controller.trash(doc.path), undefined);
    assert.equal(controller.active, doc);
    assert.equal(doc.editor.content, '最新草稿');
    client.save = save;
    // Explicit retry is the existing recovery path for a failed save.
    await controller.flush(doc);
    const entry = await controller.trash(doc.path);
    assert.ok(entry); assert.equal(controller.active, undefined);
    assert.equal(controller.documents.has(doc.path), false);
    const concurrent = await Promise.all([service.trashList(controller.workspace!.id), service.trashList(controller.workspace!.id)]);
    assert.equal(concurrent[0][0].id, entry.id);
    assert.equal(await controller.restoreTrash(entry.id), true);
    await controller.select(doc.path);
    assert.notEqual(controller.active, doc);
    assert.equal(controller.documents.get(doc.path)!.editor.content, '最新草稿');
  } finally { controller.dispose(); await f.cleanup(); }
});

test('partially deleted trash remains retryable and cannot restore; another workspace cannot access entries', async () => {
  const f = await fixture(); const other = await fixture();
  try {
    const entry = await f.service.trash(f.id, f.file.path, f.file.version);
    await assert.rejects(other.service.restore(other.id, entry.id));
    const dir = path.join(f.root, '.noteai-trash', entry.id);
    await fs.writeFile(path.join(dir, 'entry.json'), JSON.stringify({ ...entry, state: 'deleting' }));
    await fs.unlink(path.join(dir, 'document.md'));
    await assert.rejects(f.service.restore(f.id, entry.id), /不能恢复/);
    assert.equal((await f.service.trashList(f.id))[0].state, 'deleting');
    assert.deepEqual(await f.service.purge(f.id, [entry.id]), { failed: [] });
    assert.deepEqual(await f.service.trashList(f.id), []);
  } finally { await f.cleanup(); await other.cleanup(); }
});
