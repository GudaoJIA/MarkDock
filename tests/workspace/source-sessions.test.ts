import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import type { fileClient } from '../../src/features/workspace/shared/client';
import { WorkspaceError } from '../../src/features/workspace/shared/types';
import { WorkspaceController } from '../../src/features/workspace/state/sessions';
import { readEditingMode } from '../../src/features/workspace/state/view-preferences';

function setup(failureStatus = 403) {
  const root = `/source-${crypto.randomUUID()}`;
  const disk = new Map([['A.md', {content:'Original\r\n',version:'1'}],['B.md',{content:'Other',version:'1'}]]);
  const writes: string[]=[];
  let gate: Promise<void> | undefined;
  let fail = false;
  const client: typeof fileClient = {browse: async () => { throw new Error('unused'); },
    settings:async()=>{throw new Error('unused');},saveSettings:async()=>{throw new Error('unused');},
    trashList: async () => { throw new Error('Unexpected trashList'); },
    trash: async () => { throw new Error('Unexpected trash'); },
    restore: async () => { throw new Error('Unexpected restore'); },
    purge: async () => { throw new Error('Unexpected purge'); },
    open: async root => ({id:root,root,name:'test'}),
    tree: async () => [...disk.keys()].map(path=>({path,name:path,kind:'file'})),
    read: async (_id,path) => ({path,...disk.get(path)!}),
    save: async (_id,path,content,version) => {
      if(gate) await gate;
      if(fail) throw new WorkspaceError('failed',failureStatus);
      if(disk.get(path)?.version!==version) throw new WorkspaceError('conflict',409);
      const file={content,version:String(Number(version)+1)};
      disk.set(path,file);writes.push(content);return {path,...file};
    },
    rename: async (_id,path,name)=>{disk.set(name,disk.get(path)!);disk.delete(path);return {path:name,mappings:[{from:path,to:name}],files:[]};},
    move: async (_id,path,parent)=>{const next=parent+'/'+path;disk.set(next,disk.get(path)!);disk.delete(path);return {path:next,mappings:[{from:path,to:next}],files:[]};},
    create: async (_id,_parent,name,_kind,content='')=>{disk.set(name,{content,version:'1'});return {path:name};},

  };
  const controller=new WorkspaceController(client,{create:createDocumentEditor});
  return {root,controller,disk,writes,gate:(value:Promise<void>)=>{gate=value},fail:(value:boolean)=>{fail=value}};
}

test('mode switches do not write or wait for slow saves; latest source and rich edits win', async()=>{
  const f=setup(); const c=f.controller;
  try {
    await c.open(f.root);await c.select('A.md');const d=c.active!;
    c.switchMode(d);c.switchMode(d);assert.deepEqual(f.writes,[]);assert.equal(d.state,'saved');
    let release!:()=>void;f.gate(new Promise(resolve=>{release=resolve}));
    c.switchMode(d);d.document!.editSource('First\r\n');const save=c.flush(d);
    c.switchMode(d);assert.equal(d.document!.mode,'rich');
    d.editor.tf.select(d.editor.api.end([0])!);d.editor.tf.insertText(' rich');c.changed(d);
    c.switchMode(d);d.document!.editSource('Latest\r\n');release();assert.equal(await save,true);
    assert.deepEqual(f.writes,['First\r\n','Latest\r\n']);assert.equal(d.serialize(),'Latest\r\n');
    d.document!.undo();assert.equal(d.serialize(),'First rich\r\n');
    d.document!.undo();assert.equal(d.serialize(),'First\r\n');
    d.document!.undo();assert.equal(d.serialize(),'Original\r\n');
  } finally {c.dispose()}
});

test('composition defers only the mode change without an error or a save',async()=>{
  const f=setup();const c=f.controller;
  try {
    await c.open(f.root);await c.select('A.md');const d=c.active!;
    c.switchMode(d);c.composition(d,true);d.document!.editSource('中');c.switchMode(d);
    assert.equal(d.document!.mode,'source');assert.equal(c.error,'');assert.deepEqual(f.writes,[]);
    d.document!.editSource('中文');c.composition(d,false);assert.equal(d.document!.mode,'rich');
    assert.equal(c.error,'');assert.deepEqual(f.writes,[]);d.document!.undo();assert.equal(d.serialize(),'Original\r\n');
  } finally {c.dispose()}
});

test('save failure and conflict preserve source drafts and permit mode changes; reload resets history',async()=>{
  const f=setup();const c=f.controller;
  try {
    await c.open(f.root);await c.select('A.md');const d=c.active!;
    c.switchMode(d);d.document!.editSource('<Local />');f.fail(true);
    assert.equal(await c.flush(d),false);assert.equal(d.state,'error');c.switchMode(d);assert.equal(d.serialize(),'<Local />');
    f.fail(false);f.disk.set('A.md',{content:'External',version:'2'});await c.poll();assert.equal(d.state,'conflict');
    c.switchMode(d);assert.equal(d.serialize(),'<Local />');assert.equal(await c.flush(d),false);
    await c.copy('Copy.md');assert.equal(f.disk.get('Copy.md')?.content,'<Local />');assert.equal(f.disk.get('A.md')?.content,'External');
    assert.equal(c.active!.document!.canUndo,false);
    await c.select('A.md');c.switchMode(c.active!);c.active!.editor.tf.insertText('test');c.changed(c.active!);
    await c.reload();assert.equal(c.active!.serialize(),'External');assert.equal(c.active!.document!.canUndo,false);
  } finally {c.dispose()}
});

test('document switches and path-only rename/move preserve history and remap the mode preference',async()=>{
  const f=setup();const c=f.controller;
  try {
    await c.open(f.root);await c.select('A.md');const d=c.active!;
    c.switchMode(d);d.document!.editSource('Edited');
    await c.select('B.md');assert.equal(c.active!.document!.mode,'rich');await c.select('A.md');assert.equal(c.active,d);
    await c.rename('A.md','Renamed.md');assert.equal(c.active,d);assert.equal(readEditingMode(f.root,'Renamed.md'),'source');
    await c.move('Renamed.md','nested');assert.equal(c.active,d);assert.equal(readEditingMode(f.root,'nested/Renamed.md'),'source');
    assert.equal(readEditingMode(f.root,'Renamed.md'),'rich');
    d.document!.undo();assert.equal(d.serialize(),'Original\r\n');await c.flush(d);
    assert.equal(f.disk.get('nested/Renamed.md')?.content,'Original\r\n');
    await c.reload();assert.equal(c.active!.document!.mode,'source');assert.equal(c.active!.document!.canUndo,false);
  } finally {c.dispose()}
});

test('reselecting an externally updated saved document releases its old history and preserves other histories', async () => {
  const f = setup(); const c = f.controller;
  try {
    await c.open(f.root); await c.select('A.md');
    const old = c.active!; c.switchMode(old); old.document!.editSource('Saved local edit');
    await c.flush(old); assert.ok(c.history.bytes > 0);
    await c.select('B.md'); const other = c.active!;
    c.switchMode(other); other.document!.editSource('Other saved edit'); await c.flush(other);
    const otherBytes = other.document!.historyStats!.bytes;
    f.disk.set('A.md', {content: 'External replacement', version: 'external'});
    await c.select('A.md');
    assert.notEqual(c.active, old); assert.equal(c.active!.serialize(), 'External replacement');
    assert.equal(c.history.bytes, otherBytes);
    assert.equal(other.document!.canUndo, true);
    assert.deepEqual(f.writes, ['Saved local edit', 'Other saved edit']);
    c.dispose(); assert.equal(c.history.bytes, 0);
  } finally { c.dispose(); }
});

 test('expired login preserves the source draft and undo history until an authenticated retry saves it', async()=>{
 const f=setup(401); const c=f.controller;
 try {
 await c.open(f.root); await c.select('A.md'); const d=c.active!;
 c.switchMode(d); d.document!.editSource('Local draft after session expiry');
 f.fail(true); assert.equal(await c.flush(d),false); assert.equal(d.state,'error');
 assert.equal(d.serialize(),'Local draft after session expiry'); assert.equal(d.document!.canUndo,true);
 assert.equal(f.disk.get('A.md')!.content,'Original\r\n');
 f.fail(false); assert.equal(await c.flush(d),true); assert.equal(c.active,d);
 assert.equal(f.disk.get('A.md')!.content,'Local draft after session expiry'); assert.equal(d.document!.canUndo,true);
 }finally{c.dispose();}
 });
