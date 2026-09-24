import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileService } from '../../src/features/workspace/server/files';
import { ServiceSettingsStore } from '../../src/features/workspace/server/service-settings';
import { changePins, managementState } from '../../src/features/workspace/server/workspace-management';
import { fileClient, type managementClient } from '../../src/features/workspace/shared/client';
import { WorkspaceManager, WORKSPACES_KEY } from '../../src/features/workspace/state/manager';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
test('unpinning and remote list refresh preserve current drafts; restart never resurrects removed pins',async()=>{
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'markdock-pinned-')));const folder=path.join(root,'notes');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'a.md'),'# A\n');
const service=new FileService(new ServiceSettingsStore(path.join(root,'config')));
await service.serviceConfig.update((await service.serviceConfig.read()).revision,s=>({...s,pins:[folder]}));
const api:typeof managementClient={read:()=>managementState(service),pins:(...args)=>changePins(service,...args)};
const client:typeof fileClient={...fileClient,open:root=>service.open(root),tree:id=>service.tree(id),read:(...a)=>service.read(...a),save:(...a)=>service.save(...a),settings:id=>service.settings(id)};
const data=new Map<string,string>([[WORKSPACES_KEY,JSON.stringify({preferences:{}})]]);const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)}};
const a=new WorkspaceManager(client,{create:createDocumentEditor},api);const b=new WorkspaceManager(client,{create:createDocumentEditor},api);
try{await a.initialize(storage);assert.equal(a.records.length,1);assert.equal(a.activeRoot,undefined);assert(await a.open(folder));const controller=a.controller;const doc=controller.active!;doc.editor.tf.select(doc.editor.api.end([])!);doc.editor.tf.insertText('draft');controller.changed(doc);controller.composition(doc,true);
await b.initialize();assert(await b.pin(folder,true));await a.refreshManagement();assert.equal(a.records.length,0);assert.equal(a.controller,controller);assert.equal(a.current?.root,folder);assert.equal(controller.active,doc);assert(controller.hasUnsaved());assert.equal(JSON.parse(data.get(WORKSPACES_KEY)!).activeRoot,undefined);
const c=new WorkspaceManager(client,{create:createDocumentEditor},api);try{await c.initialize(storage);assert.equal(c.records.length,0);assert.equal(c.activeRoot,undefined);}finally{c.dispose();}
controller.composition(doc,false);assert(await a.pin(folder));assert.equal(a.controller,controller);assert.equal(a.records.length,1);
const firstBytes=doc.document!.historyStats!.bytes;assert(firstBytes>0);assert.equal(a.history.bytes,firstBytes);
const secondFolder=path.join(root,'other');await fs.mkdir(secondFolder);await fs.writeFile(path.join(secondFolder,'b.md'),'# B\n');
assert(await a.open(secondFolder));const second=a.controller.active!;second.document!.switchMode('source');second.document!.editSource('other draft');
assert.equal(a.history.bytes,firstBytes+second.document!.historyStats!.bytes);
assert(await a.open(folder));assert.equal(a.controller.active,doc);assert.equal(a.history.bytes,firstBytes+second.document!.historyStats!.bytes);
a.dispose();assert.equal(a.history.bytes,0);
}finally{a.dispose();b.dispose();await fs.rm(root,{recursive:true,force:true});}
});
test('browser records cannot register server pins or restore an unpinned root',async()=>{
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'markdock-no-import-')));const service=new FileService(new ServiceSettingsStore(path.join(root,'config')));
const api:typeof managementClient={read:()=>managementState(service),pins:async()=>{throw new Error('registration must be explicit')}};
const manager=new WorkspaceManager(fileClient,{create:createDocumentEditor},api);
try{await manager.initialize({getItem:key=>key===WORKSPACES_KEY?JSON.stringify({records:[{root,name:'old'}],activeRoot:root}):root,setItem:()=>{}});assert.deepEqual(manager.records,[]);assert.equal(manager.activeRoot,undefined);await assert.rejects(fs.stat(path.join(root,'config')));}finally{manager.dispose();await fs.rm(root,{recursive:true,force:true});}
});
