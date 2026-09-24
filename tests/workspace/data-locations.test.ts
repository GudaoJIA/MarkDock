import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { configuredDataRoots } from '../../src/features/workspace/server/data-locations';
import { FileService } from '../../src/features/workspace/server/files';
import { ServiceSettingsStore } from '../../src/features/workspace/server/service-settings';
import { changePins, managementState } from '../../src/features/workspace/server/workspace-management';
test('deployment data roots constrain browsing, pins, opening and breadcrumbs',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'markdock-roots-')));
 try {
  const allowed=path.join(root,'data');const outside=path.join(root,'data-other');await fs.mkdir(allowed);await fs.mkdir(outside);await fs.mkdir(path.join(allowed,'blog'));await fs.writeFile(path.join(allowed,'blog/note.md'),'keep');await fs.symlink(outside,path.join(allowed,'linked'));
  const store=new ServiceSettingsStore(path.join(root,'config'));const service=new FileService(store,[allowed]);
  const locations=await service.locations();assert.equal(locations[0].root,allowed);assert.equal('error' in locations[0],false);
  const listing=await service.browse({scope:'host',path:allowed});assert.equal(listing.parent,null);assert.deepEqual(listing.breadcrumbs.map(b=>b.path),[allowed]);assert.deepEqual(listing.directories.map(d=>d.name),['blog']);
  for(const candidate of [outside,root,path.join(allowed,'../data-other'),path.join(allowed,'linked')]) {await assert.rejects(service.browse({scope:'host',path:candidate}));await assert.rejects(service.open(candidate));await assert.rejects(changePins(service,'pin',[candidate],(await store.read()).revision));}
  const w=await service.open(path.join(allowed,'blog'));assert.equal((await service.read(w.id,'note.md')).content,'keep');await assert.rejects(service.browse({scope:'host',path:path.join(allowed,'..')}));
  await store.update((await store.read()).revision,s=>({...s,pins:[outside]}));const state=await managementState(service);assert(state.pins[0].error);assert.equal(state.locations[0].root,allowed);assert.equal((await changePins(service,'unpin',[outside],state.revision)).pins.length,0);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
test('configuration is explicit and malformed roots never widen access',async()=>{
 assert.equal(configuredDataRoots(''),null);assert.deepEqual(configuredDataRoots('[]'),[]);for(const raw of ['not-json','{}','["relative"]','[42]']) assert.throws(()=>configuredDataRoots(raw));
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'markdock-roots-')));
 try {const store=new ServiceSettingsStore(path.join(root,'config'));const local=new FileService(store,null);assert.deepEqual(await local.locations(),[]);await assert.rejects(local.browse({scope:'host'}));assert.equal((await local.browse({scope:'host',path:root})).path,root);
 const denied=new FileService(store,[]);await assert.rejects(denied.open(root));const unavailable=new FileService(store,[path.join(root,'missing')]);assert((await unavailable.locations())[0].error);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
