import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileService } from '../../src/features/workspace/server/files';
import { defaultRule, resourceTarget, type ResourceRule } from '../../src/features/workspace/shared/resource-policy';
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
async function fixture(){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'markdock-policy-')));await fs.mkdir(path.join(root,'posts'));await fs.mkdir(path.join(root,'posts/sub'));await fs.writeFile(path.join(root,'posts/article.md'),'# Article\n');const service=new FileService();const w=await service.open(root);return {root,service,id:w.id,async config(resources:ResourceRule){const v=await service.settings(w.id);return service.updateSettings(w.id,{resources},v.revision);},async clean(){await fs.rm(root,{recursive:true,force:true});}};}
const fixed:ResourceRule={mode:'fixed',images:'public/images',attachments:'public/files',reference:'site',publicRoot:'public'};
test('settings persist at workspace root; uploads follow saved rules and root mappings',async()=>{const f=await fixture();try{
const before=await fs.readFile(path.join(f.root,'posts/article.md'));
await f.config(fixed);const image=await f.service.uploadImage(f.id,'posts/article.md',png,undefined,'my picture.png');assert.match(image.path,/^public\/images\//);assert.match(image.url,/^\/images\//);assert.deepEqual((await f.service.asset(f.id,image.path)).data,Buffer.from(png));
const doc=await f.service.create(f.id,'','new.md','file');assert.equal(doc.path,'new.md');assert((await f.service.tree(f.id)).some(e=>e.path==='posts'));
await assert.rejects(f.service.create(f.id,'public/images','outside.md','file'));
const reopened=await new FileService().open(f.root);assert.equal('showResourceDirectories' in reopened.settings!.settings,false);assert.equal(resourceTarget('posts/article.md',image.url,reopened.settings!.settings),image.path);
assert.deepEqual(await fs.readFile(path.join(f.root,'posts/article.md')),before);
const attachment=await f.service.uploadAttachment(f.id,'posts/article.md','manual.pdf',new Blob(['pdf']).stream());assert.match(attachment.url,/^\/files\//);assert.equal((await f.service.attachment(f.id,attachment.path,undefined,true)).size,3);
}finally{await f.clean();}});
test('switches retain historical owned directories; move and trash preserve fixed assets',async()=>{const f=await fixture();try{
const old=await f.service.uploadImage(f.id,'posts/article.md',png);
await f.config({...defaultRule,mode:'sibling',images:'',attachments:'downloads'});
const sibling=await f.service.uploadImage(f.id,'posts/article.md',png);
await f.config(fixed);const shared=await f.service.uploadImage(f.id,'posts/article.md',png);
let file=await f.service.read(f.id,'posts/article.md');file=await f.service.save(f.id,file.path,`![old](${old.url})\n![sibling](${sibling.url})\n![shared](${shared.url})\n`,file.version);
const moved=await f.service.move(f.id,file.path,'posts/sub',file.version);assert.equal(moved.path,'posts/sub/article.md');await fs.stat(path.join(f.root,'posts/sub/article.assets'));await fs.stat(path.join(f.root,'posts/sub/article'));await fs.stat(path.join(f.root,shared.path));
const next=await f.service.read(f.id,moved.path);assert(next.content.includes(shared.url));const trashed=await f.service.trash(f.id,next.path,next.version);assert.equal(trashed.version,2);assert.equal(trashed.resources?.length,2);
await f.config({...defaultRule,mode:'assets'});await f.service.restore(f.id,trashed.id);await fs.stat(path.join(f.root,'posts/sub/article.assets'));await fs.stat(path.join(f.root,'posts/sub/article'));await fs.stat(path.join(f.root,shared.path));assert.equal((await f.service.read(f.id,next.path)).content,next.content);
}finally{await f.clean();}});
test('invalid configuration, conflicts and symlinks never overwrite data',async()=>{const f=await fixture();try{
const stale=await f.service.settings(f.id);await f.config(fixed);
await assert.rejects(f.service.updateSettings(f.id,{resources:defaultRule},stale.revision));
await assert.rejects(f.config({...fixed,publicRoot:'static',images:'static/images',attachments:'static/files'}));
await assert.rejects(f.config({...fixed,images:'../outside'}));
await fs.symlink('posts',path.join(f.root,'linked'));await assert.rejects(f.config({...fixed,images:'linked/img',attachments:'linked/files',reference:'relative',publicRoot:''}));
await fs.writeFile(path.join(f.root,'.markdock.json'),'{invalid');await assert.rejects(f.service.settings(f.id));await assert.rejects(f.config(defaultRule));assert.equal(await fs.readFile(path.join(f.root,'.markdock.json'),'utf8'),'{invalid');
}finally{await f.clean();}});
test('ambiguous sibling directory remains visible and cannot be adopted or trashed',async()=>{const f=await fixture();try{
await f.config({...defaultRule,mode:'sibling'});await fs.mkdir(path.join(f.root,'posts/article'));await fs.writeFile(path.join(f.root,'posts/article/another.md'),'keep');
assert((await f.service.tree(f.id)).find(e=>e.path==='posts')!.children!.some(e=>e.path==='posts/article' && !e.resource));await assert.rejects(f.service.uploadImage(f.id,'posts/article.md',png));const doc=await f.service.read(f.id,'posts/article.md');await assert.rejects(f.service.trash(f.id,doc.path,doc.version));assert.equal(await fs.readFile(path.join(f.root,'posts/article/another.md'),'utf8'),'keep');
}finally{await f.clean();}});
test('attachment stream refuses publication after external config change',async()=>{const f=await fixture();try{
await f.config(fixed);let release!:()=>void;let started!:()=>void;const ready=new Promise<void>(r=>started=r);const pause=new Promise<void>(r=>release=r);
const body=new ReadableStream<Uint8Array>({async start(c){c.enqueue(new Uint8Array([1]));started();await pause;c.enqueue(new Uint8Array([2]));c.close();}});
const upload=f.service.uploadAttachment(f.id,'posts/article.md','file.pdf',body);await ready;
// Wait for the upload to open its target, not a timing assumption.
for(let i=0;i<100;i++){if(await fs.readdir(path.join(f.root,'public/files')).then(x=>x.length>0).catch(()=>false))break;await new Promise(r=>setTimeout(r,5));}
const config=JSON.parse(await fs.readFile(path.join(f.root,'.markdock.json'),'utf8'));config.resources.images='public/other';await fs.writeFile(path.join(f.root,'.markdock.json'),JSON.stringify(config));release();await assert.rejects(upload);assert.deepEqual(await fs.readdir(path.join(f.root,'public/files')),[]);
}finally{await f.clean();}});

test('legacy content scope is ignored without writing; next save removes it', async () => {
 const f=await fixture();try {
  const config=JSON.stringify({version:2,contentDirectory:'missing',showResourceDirectories:true,resources:defaultRule,compatibility:[]});
  await fs.writeFile(path.join(f.root,'.markdock.json'),config);
  await fs.writeFile(path.join(f.root,'root.md'),'root draft');
  const w=await new FileService().open(f.root);
  assert.equal('showResourceDirectories' in w.settings!.settings,false);
  assert.equal('contentDirectory' in w.settings!.settings,false);
  assert((await f.service.tree(f.id)).some(e=>e.path==='root.md'));
  assert.equal((await f.service.read(f.id,'root.md')).content,'root draft');
  assert.equal(await fs.readFile(path.join(f.root,'.markdock.json'),'utf8'),config);
  await f.service.updateSettings(f.id,{resources:defaultRule},w.settings!.revision);
  const saved=JSON.parse(await fs.readFile(path.join(f.root,'.markdock.json'),'utf8'));
  assert.equal('contentDirectory' in saved,false);
  assert.equal('showResourceDirectories' in saved,false);
 } finally { await f.clean(); }
});

test('resource visibility exposes only real opaque folders; child browsing is filtered and read-only', async () => {
 const f=await fixture();try {
  await fs.mkdir(path.join(f.root,'posts/article.assets/images/nested'),{recursive:true});
  await fs.mkdir(path.join(f.root,'posts/article.assets/.hidden'));
  await fs.mkdir(path.join(f.root,'posts/article.assets/node_modules'));
  await fs.symlink('images',path.join(f.root,'posts/article.assets/link'));
  await fs.writeFile(path.join(f.root,'posts/article.assets/images/manual.md'),'resource only');
  await Promise.all(Array.from({length:100},(_,i)=>fs.writeFile(path.join(f.root,`posts/article.assets/images/${i}.png`),'image')));
  await fs.mkdir(path.join(f.root,'assets'));
  const posts=(tree:Awaited<ReturnType<FileService['tree']>>)=>tree.find(e=>e.path==='posts')!.children!;
  assert(!posts(await f.service.tree(f.id)).some(e=>e.resource));
  const snapshot=await f.service.settings(f.id);
  const tree=await f.service.tree(f.id,undefined,true);
  assert.equal((await f.service.settings(f.id)).revision,snapshot.revision);
  await assert.rejects(fs.stat(path.join(f.root,'.markdock.json')));
  assert.deepEqual(tree.find(e=>e.path==='assets'),{name:'assets',path:'assets',kind:'directory',resource:true});
  assert.deepEqual(posts(tree).find(e=>e.resource),{name:'article.assets',path:'posts/article.assets',kind:'directory',resource:true});
  assert(!JSON.stringify(tree).includes('nested'));
  assert(!JSON.stringify(tree).includes('.png'));
  assert.deepEqual((await f.service.resources(f.id,'posts/article.assets')).entries.filter(e=>e.kind==='directory').map(({name,path})=>({name,path})),[{name:'images',path:'posts/article.assets/images'}]);
  assert.deepEqual((await f.service.resources(f.id,'posts/article.assets/images')).entries.filter(e=>e.kind==='directory').map(({name,path})=>({name,path})),[{name:'nested',path:'posts/article.assets/images/nested'}]);
  assert.equal((await f.service.search(f.id,'resource only')).results.length,0);
  for(const p of ['posts/article.assets/new.md','assets/new.md']) {
   const parent=p.split('/').slice(0,-1).join('/');
   await assert.rejects(f.service.create(f.id,parent,'new.md','file'));
  }
  assert.equal((await f.service.read(f.id,'posts/article.assets/images/manual.md')).content,'resource only');
  await assert.rejects(f.service.rename(f.id,'posts/article.assets','renamed'));
  for (const p of ['../','posts/article.assets/.hidden','posts/article.assets/node_modules','posts/article.assets/link'])
    await assert.rejects(f.service.resources(f.id,p));
  assert(!posts(await f.service.tree(f.id)).some(e=>e.resource));
  assert.equal(await fs.readFile(path.join(f.root,'posts/article.assets/images/manual.md'),'utf8'),'resource only');
 } finally { await f.clean(); }
});

test('current and historical resource directories remain distinct from ambiguous document folders', async () => {
 const f=await fixture();try {
  await f.config({...defaultRule,mode:'sibling'});
  await f.service.uploadImage(f.id,'posts/article.md',png);
  await f.config(fixed);
  const shared=await f.service.uploadImage(f.id,'posts/article.md',png);
  await fs.writeFile(path.join(f.root,'posts/ambiguous.md'),'document');
  await fs.mkdir(path.join(f.root,'posts/ambiguous'));
  await fs.writeFile(path.join(f.root,'posts/ambiguous/inside.md'),'keep');
  const snapshot=await f.service.settings(f.id);
  await f.service.updateSettings(f.id,{resources:fixed},snapshot.revision);
  const tree=await f.service.tree(f.id,undefined,true);
  const children=tree.find(e=>e.path==='posts')!.children!;
  assert(children.find(e=>e.path==='posts/article')!.resource);
  assert(!children.find(e=>e.path==='posts/ambiguous')!.resource);
  assert(tree.find(e=>e.path==='public')!.children!.find(e=>e.path==='public/images')!.resource);
  assert(!tree.find(e=>e.path==='public')!.children!.some(e=>e.path==='public/files'));
  await assert.rejects(f.service.rename(f.id,'posts/article','other'));
  await assert.rejects(f.service.create(f.id,'posts/article','new.md','file'));
  const doc=await f.service.read(f.id,'posts/article.md');
  await assert.rejects(f.service.move(f.id,doc.path,'public/images',doc.version));
  const moved=await f.service.move(f.id,doc.path,'',doc.version);
  assert.equal(moved.path,'article.md');
  await fs.stat(path.join(f.root,'article'));
  assert.deepEqual((await f.service.asset(f.id,shared.path)).data,Buffer.from(png));
 } finally { await f.clean(); }
});
