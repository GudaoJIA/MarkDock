import { defaultSettings } from '../../src/features/workspace/shared/resource-policy';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { fileClient } from '../../src/features/workspace/shared/client';
import { WorkspaceController } from '../../src/features/workspace/state/sessions';
import { WorkspaceError } from '../../src/features/workspace/shared/types';

function setup() {
  const disk = new Map([['A.md', { content: 'A', version: '1' }], ['B.md', { content: 'B', version: '1' }]]);
  const writes: string[] = [];
  let rejectSave = false;
  let gate: Promise<void> | undefined;
  const client: typeof fileClient = {browse: async () => { throw new Error('unused'); },
    settings:async()=>{throw new Error('unused');},saveSettings:async()=>{throw new Error('unused');},
    trashList: async () => { throw new Error('Unexpected trashList'); },
    trash: async () => { throw new Error('Unexpected trash'); },
    restore: async () => { throw new Error('Unexpected restore'); },
    purge: async () => { throw new Error('Unexpected purge'); },

    open: async (root) => ({ root, id: 'workspace', name: 'test' }),
    tree: async () => [...disk.keys()].map((path) => ({ name: path, path, kind: 'file' })),
    read: async (_id, path) => { const file = disk.get(path); if (!file) throw new WorkspaceError('missing', 404); return { path, ...file }; },
    save: async (_id, path, content, version) => {
      if (gate) await gate;
      if (rejectSave) throw new WorkspaceError('permission', 403);
      const old = disk.get(path)!;
      if (old.version !== version) throw new WorkspaceError('conflict', 409);
      const file = { content, version: String(Number(version) + 1) }; disk.set(path, file); writes.push(path);
      return { path, ...file };
    },
    create: async (_id, parent, name, _kind, content = '') => { const path = parent ? `${parent}/${name}` : name; disk.set(path, { content, version: '1' }); return { path }; },
    move: async (_id, source, parent) => {const next=`${parent}/${source}`;disk.set(next,disk.get(source)!);disk.delete(source);return {path:next,mappings:[{from:source,to:next}],files:[]};},
    rename: async (_id, path, name) => { disk.set(name, disk.get(path)!); disk.delete(path); return { path: name,mappings:[{from:path,to:name}],files:[] }; },
  };
  const controller = new WorkspaceController(client, { create: (file) => { const editor = { text: file.content }; return { editor, serialize: () => editor.text }; } });
  return { controller, client, disk, writes, fail: (value: boolean) => { rejectSave = value; }, gate: (value: Promise<void> | undefined) => { gate = value; } };
}

test('opening and switching does not write; edits, sessions and late saves stay with their document', async () => {
  const f = setup(); await f.controller.open('/workspace'); await f.controller.select('A.md');
  const a = f.controller.active!; a.scroll = 150;
  await f.controller.select('B.md'); await f.controller.select('A.md');
  assert.equal(f.controller.active, a); assert.equal(a.scroll, 150); assert.deepEqual(f.writes, []);
  let release!: () => void; f.gate(new Promise((resolve) => { release = resolve; }));
  a.editor.text = 'A first'; f.controller.changed(a);
  const save = f.controller.flush(a);
  a.editor.text = 'A last'; f.controller.changed(a);
  const switching = f.controller.select('B.md');
  assert.equal(f.controller.active, a); release();
  await save; await switching;
  assert.equal(f.disk.get('A.md')?.content, 'A last'); assert.equal(f.disk.get('B.md')?.content, 'B');
  assert.equal(f.controller.active?.path, 'B.md'); assert.deepEqual(f.writes, ['A.md', 'A.md']); f.controller.dispose();
});

test('IME and failed saves block switching, and retry preserves the edit', async () => {
  const f = setup(); await f.controller.open('/workspace'); await f.controller.select('A.md');
  const a = f.controller.active!; f.controller.composition(a, true); a.editor.text = '中文'; f.controller.changed(a);
  await f.controller.select('B.md'); assert.equal(f.controller.active, a); assert.deepEqual(f.writes, []); assert.equal(f.controller.hasUnsaved(), true);
  f.controller.composition(a, false); f.fail(true);
  await f.controller.select('B.md'); assert.equal(f.controller.active, a); assert.equal(a.state, 'error');
  f.fail(false); await f.controller.select('B.md'); assert.equal(f.disk.get('A.md')?.content, '中文'); f.controller.dispose();
});

test('external conflict never overwrites, local copy and clean external reload work', async () => {
  const f = setup(); await f.controller.open('/workspace'); await f.controller.select('A.md');
  const a = f.controller.active!; a.editor.text = 'local'; f.controller.changed(a);
  f.disk.set('A.md', { content: 'external', version: '2' }); await f.controller.poll();
  assert.equal(a.state, 'conflict'); assert.equal(await f.controller.flush(a), false);
  await f.controller.copy('A-copy.md'); assert.equal(f.disk.get('A.md')?.content, 'external'); assert.equal(f.disk.get('A-copy.md')?.content, 'local');
  f.disk.set('A-copy.md', { content: 'updated externally', version: '2' }); await f.controller.poll();
  assert.equal(f.controller.active?.editor.text, 'updated externally'); f.controller.dispose();
});

test('switch flushes edits and rename retains the session', async () => {
  const f = setup(); await f.controller.open('/workspace'); await f.controller.select('A.md');
  const a = f.controller.active!; a.editor.text = 'saved before switching'; f.controller.changed(a);
  await f.controller.select('B.md'); assert.equal(f.disk.get('A.md')?.content, 'saved before switching');
  await f.controller.select('A.md'); await f.controller.rename('A.md', 'Renamed.md');
  assert.equal(f.controller.active, a); assert.equal(a.path, 'Renamed.md');
  a.editor.text = 'renamed edit'; f.controller.changed(a); await f.controller.flush(a);
  assert.equal(f.disk.get('Renamed.md')?.content, 'renamed edit'); assert.equal(f.disk.has('A.md'), false); f.controller.dispose();
});

test('pending image tasks block switching and renaming until released, without losing document text', async () => {
  const f = setup(); await f.controller.open('/workspace'); await f.controller.select('A.md');
  const a = f.controller.active!;
  const finish = f.controller.beginTask(a)!;
  assert.equal(f.controller.hasUnsaved(), true);
  await f.controller.select('B.md'); assert.equal(f.controller.active, a);
  assert.equal(await f.controller.rename('A.md', 'renamed.md'), false);
  finish(); finish();
  assert.equal(f.controller.busy, false);
  await f.controller.select('B.md'); assert.equal(f.controller.active?.path, 'B.md');
  assert.equal(f.disk.get('A.md')?.content, 'A'); f.controller.dispose();
});


test('saving resource settings keeps all resident document objects and blocks on unsaved failures', async () => {
  const f=setup();
  f.client.saveSettings=async (_id,input)=>({settings:{...defaultSettings,...input},revision:'next'});
  await f.controller.open('/workspace'); await f.controller.select('A.md');
  const a=f.controller.active!;
  await f.controller.select('B.md'); const b=f.controller.active!;
  b.editor.text='unfinished'; f.controller.changed(b); f.fail(true);
  assert.equal(await f.controller.saveSettings({...defaultSettings},'absent'),false);
  assert.equal(f.controller.active,b);
  assert.equal(b.editor.text,'unfinished');
  f.fail(false);
  assert.equal(await f.controller.saveSettings({...defaultSettings},'absent'),true);
  assert.equal(f.controller.active,b); assert.equal(f.disk.get('B.md')?.content,'unfinished');
  await f.controller.select('A.md'); assert.equal(f.controller.active,a);
  f.controller.dispose();
});
