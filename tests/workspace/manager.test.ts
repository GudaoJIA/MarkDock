import { ServiceSettingsStore } from '../../src/features/workspace/server/service-settings';
import { managementState, changePins } from '../../src/features/workspace/server/workspace-management';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { fileClient } from '../../src/features/workspace/shared/client';
import { FileService } from '../../src/features/workspace/server/files';
import { WorkspaceManager, WORKSPACES_KEY } from '../../src/features/workspace/state/manager';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import { WorkspaceError } from '../../src/features/workspace/shared/types';

async function setup() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'noteai-manager-')));
  const a = path.join(root, '甲'); const b = path.join(root, '乙');
  await fs.mkdir(a); await fs.mkdir(b);
  await fs.writeFile(path.join(a, '同名.md'), '甲内容\n');
  await fs.writeFile(path.join(b, '同名.md'), '乙内容\n');
  const store = new ServiceSettingsStore(path.join(root, 'config'));
  let service = new FileService(store);
  await store.update((await store.read()).revision, s => ({...s, pins:[a,b]}));
  let fail = false;
  let gate: Promise<void> | undefined;
  let treeGate: { entered: () => void; wait: Promise<void> } | undefined;
  const client: typeof fileClient = {browse: async () => { throw new Error('unused'); },
    settings:id=>service.settings(id),saveSettings:(...a)=>service.updateSettings(...a),
    trashList: async () => { throw new Error('Unexpected trashList'); },
    trash: async () => { throw new Error('Unexpected trash'); },
    restore: async () => { throw new Error('Unexpected restore'); },
    purge: async () => { throw new Error('Unexpected purge'); },
    open: (root) => service.open(root), tree: async (id) => { const tree = await service.tree(id); if (treeGate) { const pending = treeGate; treeGate = undefined; pending.entered(); await pending.wait; } return tree; }, read: (id, path) => service.read(id, path),
    move:(...args)=>service.move(...args), create: (...args) => service.create(...args), rename: (...args) => service.rename(...args),
    save: async (...args) => { if (gate) await gate; if (fail) throw new WorkspaceError('模拟保存失败', 403); return service.save(...args); },
  };
  const storage = new Map<string, string>();
  const port = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
  const make = () => new WorkspaceManager(client, { create: createDocumentEditor }, { read:()=>managementState(service), pins:(...args)=>changePins(service,...args) });
  const manager = make(); await manager.initialize(port);
  return { pauseTree: () => {
    let entered!: () => void; let release!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    treeGate = { entered, wait: new Promise<void>((resolve) => { release = resolve; }) };
    return { ready, release };
  }, root, a, b, manager, make, port, storage, client, restart: () => { service = new FileService(store); }, fail: (value: boolean) => { fail = value; }, gate: (value: Promise<void> | undefined) => { gate = value; }, cleanup: async () => { manager.dispose(); await fs.rm(root, { recursive: true, force: true }); } };
}

test('workspace switching isolates same-named documents, undo, selection and disk saves', async () => {
  const f = await setup();
  try {
    await f.manager.open(f.a);
    const a = f.manager.controller; const doc = a.active!;
    doc.editor.tf.select(doc.editor.api.end([])!); doc.editor.tf.insertText('新增');
    a.changed(doc); doc.scroll = 123; a.rememberSelection(doc, doc.editor.selection);
    f.manager.setExpanded(f.a, ['子目录']);
    assert.equal(await f.manager.open(f.b), true);
    assert.equal(f.manager.controller.active?.serialize(), '乙内容\n');
    assert.equal(await f.manager.open(f.a + '/.'), true);
    assert.equal(f.manager.controller, a); assert.equal(a.active, doc);
    assert.equal(doc.scroll, 123); assert.ok(doc.selection); assert.ok(doc.editor.history.undos.length);
    assert.equal(f.manager.records.length, 2);
    assert.deepEqual(f.manager.current?.expanded, ['子目录']);
    doc.editor.tf.undo(); a.changed(doc); await a.flush(doc);
    assert.equal(await fs.readFile(path.join(f.a, '同名.md'), 'utf8'), '甲内容\n');
    assert.equal(await fs.readFile(path.join(f.b, '同名.md'), 'utf8'), '乙内容\n');
  } finally { await f.cleanup(); }
});

test('IME, image uploads, failed saves, conflicts and concurrent transitions retain the current workspace', async () => {
  const f = await setup();
  try {
    await f.manager.open(f.a); const a = f.manager.controller; const doc = a.active!;
    a.composition(doc, true); assert.equal(await f.manager.open(f.b), false);
    a.composition(doc, false);
    const finish = a.beginTask(doc)!; assert.equal(await f.manager.open(f.b), false); finish();
    doc.editor.tf.select(doc.editor.api.end([])!); doc.editor.tf.insertText('编辑'); a.changed(doc);
    f.fail(true); assert.equal(await f.manager.open(f.b), false); assert.equal(f.manager.controller, a);
    f.fail(false);
    let release!: () => void; f.gate(new Promise<void>((resolve) => { release = resolve; }));
    const switching = f.manager.open(f.b);
    assert.equal(await f.manager.open(f.a), false); assert.equal(f.manager.controller, a);
    release(); await switching; f.gate(undefined);
    await f.manager.open(f.a);
    doc.editor.tf.insertText('本地'); a.changed(doc);
    await fs.writeFile(path.join(f.a, '同名.md'), '外部版本');
    assert.equal(await f.manager.open(f.b), false);
    assert.equal(doc.state, 'conflict'); assert.equal(f.manager.controller, a);
    assert.equal(await fs.readFile(path.join(f.a, '同名.md'), 'utf8'), '外部版本');
  } finally { await f.cleanup(); }
});

test('returning to an externally edited workspace replaces only changed sessions', async () => {
  const f = await setup();
  try {
    await f.manager.open(f.a); const old = f.manager.controller.active!;
    await f.manager.open(f.b);
    await fs.writeFile(path.join(f.a, '同名.md'), '外部更新\n');
    await f.manager.open(f.a);
    assert.notEqual(f.manager.controller.active, old);
    assert.equal(f.manager.controller.active?.serialize(), '外部更新\n');
    assert.equal(f.manager.controller.active?.editor.history.undos.length, 0);
    await f.manager.open(f.b);
    await fs.rename(f.a, path.join(f.root, '已移走'));
    assert.equal(await f.manager.open(f.a), false);
    assert.equal(f.manager.activeRoot, f.b); assert.ok(f.manager.records.find((item) => item.root === f.a)?.error);
  } finally { await f.cleanup(); }
});

test('server pins and browser preferences restore the last document without creating directories', async () => {
  const f = await setup();
  const restored = f.make();
  try {
    await restored.initialize(f.port); await restored.open(f.a); assert.equal(restored.activeRoot, f.a);
    await fs.writeFile(path.join(f.a, '另一篇.md'), '第二篇\n');
    await restored.controller.select('另一篇.md');
    restored.setExpanded(f.a, []);
    assert.ok(f.storage.get(WORKSPACES_KEY));
    const refreshed = f.make();
    try {
      await refreshed.initialize(f.port);
      assert.equal(refreshed.controller.active?.path, '另一篇.md');
      assert.equal(refreshed.controller.active?.editor.history.undos.length, 0);
      assert.deepEqual(refreshed.current?.expanded, []);
      const saved = JSON.parse(f.storage.get(WORKSPACES_KEY)!);
      assert.equal(saved.records, undefined);
      assert(saved.preferences[f.a]);
    } finally { refreshed.dispose(); }
  } finally { restored.dispose(); await f.cleanup(); }
});


test('switching renews server workspace IDs before saving retained edits', async () => {
  const f = await setup();
  try {
    await f.manager.open(f.a);
    const doc = f.manager.controller.active!;
    doc.editor.tf.select(doc.editor.api.end([])!); doc.editor.tf.insertText('重启后修改');
    f.manager.controller.changed(doc);
    f.restart();
    assert.equal(await f.manager.open(f.b), true);
    assert.match(await fs.readFile(path.join(f.a, '同名.md'), 'utf8'), /重启后修改/);
    await f.manager.open(f.a);
    assert.equal(f.manager.controller.active, doc);
  } finally { await f.cleanup(); }
});


test('a poll started before switching cannot update an inactive workspace', async () => {
  const f = await setup();
  try {
    await f.manager.open(f.a);
    const a = f.manager.controller;
    const pending = f.pauseTree();
    const poll = a.poll(); await pending.ready;
    await f.manager.open(f.b);
    await fs.unlink(path.join(f.a, '同名.md'));
    pending.release(); await poll;
    assert.equal(a.active?.state, 'saved');
    assert.equal(f.manager.activeRoot, f.b);
  } finally { await f.cleanup(); }
});

test('sign-out saves all resident workspaces and refuses IME, uploads, conflicts and failed saves without discarding drafts', async () => {
  const f = await setup(); let calls=0;
  try {
    await f.manager.open(f.a);const a=f.manager.controller;const doc=a.active!;
    await f.manager.open(f.b); const b=f.manager.controller;
    a.switchMode(doc); doc.document!.editSource('unsaved inactive workspace'); a.changed(doc);
    doc.composing=true;
    assert.equal(await f.manager.logout(async()=>{calls++;}),false);assert.equal(calls,0);
    doc.composing=false;b.busy=true;
    assert.equal(await f.manager.logout(async()=>{calls++;}),false);b.busy=false;
    f.fail(true);
    assert.equal(await f.manager.logout(async()=>{calls++;}),false);assert.equal(calls,0);assert.equal(doc.serialize(),'unsaved inactive workspace');
    f.fail(false);
    assert.equal(await f.manager.logout(async()=>{calls++;assert.equal(a.busy,true);assert.equal(b.busy,true);}),true);
    assert.equal(calls,1);assert.equal(await fs.readFile(path.join(f.a,'同名.md'),'utf8'),'unsaved inactive workspace');assert.equal(f.manager.controller,b);assert.equal(a.active,doc);
    doc.state='conflict'; assert.equal(await f.manager.logout(async()=>{calls++;}),false);assert.equal(calls,1);
  } finally {await f.cleanup();}
});

test('cancelled tree loading preserves current workspace, target session and drafts; late completion cannot switch', async () => {
  const f = await setup();
  try {
    await f.manager.open(f.a);
    const a = f.manager.controller;
    const original = a.active;
    await f.manager.open(f.b);
    const b = f.manager.controller;
    const gate = f.pauseTree();
    const opening = f.manager.open(f.a);
    await gate.ready;
    assert.equal(f.manager.opening?.stage, 'tree');
    f.manager.cancelOpen();
    gate.release();
    assert.equal(await opening, false);
    assert.equal(f.manager.controller, b);
    assert.equal(a.active, original);
    assert.equal(f.manager.error, '');
    assert.equal(f.manager.busy, false);
    assert.equal(f.manager.opening, undefined);
    assert.equal(await f.manager.open(f.a), true);
  } finally { await f.cleanup(); }
});

test('failed initial document read does not leave a half-applied target session', async () => {
  const f = await setup();
  try {
    await f.manager.open(f.a);
    const a = f.manager.controller;
    const read = f.client.read;
    f.client.read = async () => { throw new Error('simulated read failure'); };
    assert.equal(await f.manager.open(f.b), false);
    assert.equal(f.manager.controller, a);
    assert.equal(f.manager.busy, false);
    f.client.read = read;
    assert.equal(await f.manager.open(f.b), true);
  } finally { await f.cleanup(); }
});

test('unpinning the active workspace saves first and clears the visible workspace without destroying history', async () => {
  const f = await setup();
  try {
    await f.manager.open(f.a);
    const controller = f.manager.controller;
    const doc = controller.active!;
    doc.editor.tf.select(doc.editor.api.end([])!);
    doc.editor.tf.insertText('取消固定前修改'); controller.changed(doc);
    let release!: () => void;
    f.gate(new Promise<void>(resolve => { release = resolve; }));
    const removing = f.manager.pin(f.a, true);
    assert.equal(f.manager.busy, true);
    assert.equal(await f.manager.open(f.b), false);
    assert.equal(f.manager.controller, controller);
    release();
    assert.equal(await removing, true); f.gate(undefined);
    assert.equal(f.manager.activeRoot, undefined);
    assert.equal(f.manager.current, undefined);
    assert.equal(f.manager.controller, f.manager.empty);
    assert.deepEqual(f.manager.controller.tree, []);
    assert.equal(f.manager.controller.active, undefined);
    assert.equal(f.manager.records.some(record => record.root === f.a), false);
    assert.equal(JSON.parse(f.storage.get(WORKSPACES_KEY)!).activeRoot, undefined);
    assert.match(await fs.readFile(path.join(f.a, '同名.md'), 'utf8'), /取消固定前修改/);
    assert.equal(await f.manager.pin(f.a), true);
    assert.equal(await f.manager.open(f.a), true);
    assert.equal(f.manager.controller.active, doc);
    assert.ok(doc.editor.history.undos.length);
  } finally { await f.cleanup(); }
});

test('unpinning refuses composition, uploads, save failures and conflicts without losing the current workspace', async () => {
  const f = await setup();
  try {
    await f.manager.open(f.a);
    const controller = f.manager.controller; const doc = controller.active!;
    controller.composition(doc, true);
    assert.equal(await f.manager.pin(f.a, true), false);
    controller.composition(doc, false);
    const finish = controller.beginTask(doc)!;
    assert.equal(await f.manager.pin(f.a, true), false); finish();
    doc.editor.tf.select(doc.editor.api.end([])!); doc.editor.tf.insertText('保留草稿'); controller.changed(doc);
    f.fail(true); assert.equal(await f.manager.pin(f.a, true), false); f.fail(false);
    assert.equal(f.manager.controller, controller);
    assert.equal(f.manager.busy, false); assert.equal(controller.busy, false);
    assert.ok(f.manager.records.some(record => record.root === f.a));
    assert.match(doc.serialize(), /保留草稿/);
    await fs.writeFile(path.join(f.a, '同名.md'), '外部修改');
    assert.equal(await f.manager.pin(f.a, true), false);
    assert.equal(f.manager.controller, controller); assert.equal(doc.state, 'conflict');
    assert.equal(await fs.readFile(path.join(f.a, '同名.md'), 'utf8'), '外部修改');
  } finally { await f.cleanup(); }
});

test('inactive or remotely removed pins do not close the editor; failed unpin retains the current workspace', async () => {
  const f = await setup(); const other = f.make();
  try {
    await f.manager.open(f.a); const controller = f.manager.controller;
    assert.equal(await f.manager.pin(f.b, true), true);
    assert.equal(f.manager.controller, controller);
    await other.initialize();
    assert.equal(await other.pin(f.b), true);
    assert.equal(await f.manager.pin(f.a, true), false);
    assert.equal(f.manager.controller, controller);
    assert.equal(f.manager.busy, false); assert.equal(controller.busy, false);
    assert.equal(await other.pin(f.a, true), true);
    await f.manager.refreshManagement();
    assert.equal(f.manager.controller, controller);
    assert.equal(f.manager.activeRoot, f.a);
  } finally { other.dispose(); await f.cleanup(); }
});
