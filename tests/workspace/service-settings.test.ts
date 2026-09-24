import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileService } from '../../src/features/workspace/server/files';
import { ServiceSettingsStore } from '../../src/features/workspace/server/service-settings';
import { changePins, managementState } from '../../src/features/workspace/server/workspace-management';
import { defaultRule } from '../../src/features/workspace/shared/resource-policy';
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
async function setup(){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'markdock-service-')));const project=path.join(root,'project');await fs.mkdir(project);await fs.writeFile(path.join(project,'note.md'),'# Keep\n');const store=new ServiceSettingsStore(path.join(root,'config'));const service=new FileService(store);return {root,project,store,service,async clean(){await fs.rm(root,{recursive:true,force:true});}};}
test('pins persist, deduplicate, retain unavailable entries and never write projects',async()=>{const f=await setup();try{
const missing=path.join(f.root,'missing');await fs.mkdir(missing);let state=await managementState(f.service);state=await changePins(f.service,'pin',[f.project,missing],state.revision);await fs.rmdir(missing);state=await managementState(f.service);assert.equal(state.pins.length,2);assert(state.pins[1].error);const stale=state.revision;
state=await changePins(f.service,'pin',[f.project+'/./'],state.revision);assert.equal(state.pins.length,2);
state=await changePins(f.service,'unpin',[f.project],state.revision);await assert.rejects(changePins(f.service,'pin',[f.project],stale));
state=await managementState(f.service);assert.equal(state.pins.length,1);
assert.equal((await new ServiceSettingsStore(f.store.directory).read()).settings.pins.length,1);assert.deepEqual(await fs.readdir(f.project),['note.md']);
await fs.symlink(f.project,path.join(f.root,'linked'));await assert.rejects(changePins(f.service,'pin',[path.join(f.root,'linked')],state.revision));
await fs.writeFile(path.join(f.store.directory,'settings.json'),'{bad');await assert.rejects(f.store.read());assert.equal(await fs.readFile(path.join(f.store.directory,'settings.json'),'utf8'),'{bad');
}finally{await f.clean();}});

test('project resource rules are independent, ignore old global configuration and retain old resource access',async()=>{const f=await setup();try{
await fs.mkdir(f.store.directory);await fs.writeFile(path.join(f.store.directory,'settings.json'),JSON.stringify({version:1,pins:[],resources:{...defaultRule,mode:'sibling'},compatibility:[]}));
const w=await f.service.open(f.project);assert.deepEqual(w.settings!.settings.resources,defaultRule);const old=await f.service.uploadImage(w.id,'note.md',png);
const initialRevision=w.settings!.revision;const next=await f.service.updateSettings(w.id,{resources:{...defaultRule,mode:'sibling'}},initialRevision);
await assert.rejects(f.service.uploadImage(w.id,'note.md',png,undefined,'a.png',initialRevision));
assert((await f.service.uploadImage(w.id,'note.md',png)).path.startsWith('note/images/'));assert.deepEqual((await f.service.asset(w.id,old.path)).data,Buffer.from(png));
const other=path.join(f.root,'other');await fs.mkdir(other);const second=await f.service.open(other);assert.deepEqual(second.settings!.settings.resources,defaultRule);
const before=(await f.service.settings(w.id)).revision;const global=await f.store.read();await f.store.update(global.revision,s=>({...s,pins:[other]}));assert.equal((await f.service.settings(w.id)).revision,before);
const raw=JSON.parse(await fs.readFile(path.join(f.project,'.markdock.json'),'utf8'));assert.equal(raw.version,2);assert.equal('resourceSource' in raw,false);assert(next.settings.compatibility.length>0);assert.equal(await fs.readFile(path.join(f.project,'note.md'),'utf8'),'# Keep\n');
}finally{await f.clean();}});
test('stored project rules ignore the removed source field and concurrent writes remain protected',async()=>{const f=await setup();try{
await fs.writeFile(path.join(f.project,'.markdock.json'),JSON.stringify({version:2,resourceSource:'global',resources:{...defaultRule,mode:'sibling'},compatibility:[]}));const w=await f.service.open(f.project);assert.equal(w.settings!.settings.resources.mode,'sibling');
const g=await f.store.read();const results=await Promise.allSettled([f.store.update(g.revision,s=>({...s,pins:[f.project]})),f.store.update(g.revision,s=>({...s,pins:[]}))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
const initialRevision=w.settings!.revision;const input={resources:defaultRule};await f.service.updateSettings(w.id,input,initialRevision);await assert.rejects(f.service.updateSettings(w.id,input,initialRevision));
}finally{await f.clean();}});
test('changing a project rule during upload rejects stale publication and site mappings cannot be reinterpreted',async()=>{const f=await setup();try{
const w=await f.service.open(f.project);let release!:()=>void;const gate=new Promise<void>(r=>release=r);let started!:()=>void;const waiting=new Promise<void>(r=>started=r);
let first=true;const stream=new ReadableStream<Uint8Array>({async pull(c){if(first){first=false;c.enqueue(new Uint8Array([1]));started();return;}await gate;c.enqueue(new Uint8Array([2]));c.close();}},{highWaterMark:0});
const upload=f.service.uploadAttachment(w.id,'note.md','a.pdf',stream,undefined,w.settings!.revision);await waiting;
// Simulate an external settings edit while the service upload lock is held.
await fs.writeFile(path.join(f.project,'.markdock.json'),JSON.stringify({version:2,resources:{...defaultRule,mode:'sibling'},compatibility:[]}));release();await assert.rejects(upload);assert.deepEqual(await fs.readdir(path.join(f.project,'note.assets/file')),[]);
const current=await f.service.settings(w.id);const rule={mode:'fixed' as const,images:'static/images',attachments:'static/files',reference:'site' as const,publicRoot:'static'};
const next=await f.service.updateSettings(w.id,{resources:rule},current.revision);
await assert.rejects(f.service.updateSettings(w.id,{resources:{...rule,images:'public/images',attachments:'public/files',publicRoot:'public'}},next.revision));
}finally{await f.clean();}});
