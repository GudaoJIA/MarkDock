import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileService } from '../../src/features/workspace/server/files';
import { defaultSettings } from '../../src/features/workspace/shared/resource-policy';

async function setup() {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'markdock-resource-list-')));
 await fs.writeFile(path.join(root,'article.md'),'unchanged\n');
 await fs.mkdir(path.join(root,'article.assets','images'),{recursive:true});
 const service=new FileService();const workspace=await service.open(root);
 return {root,service,id:workspace.id,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
test('resource listing is shallow, naturally sorted, paginated and detects directory changes',async()=>{
 const f=await setup();try{
 const base=path.join(f.root,'article.assets');
 await fs.mkdir(path.join(base,'z-folder'));await fs.writeFile(path.join(base,'z-folder','nested.txt'),'nested');
 for(let i=0;i<103;i++) await fs.writeFile(path.join(base,`file${i}.txt`),'content');
 await fs.writeFile(path.join(base,'.secret'),'private');await fs.mkdir(path.join(base,'node_modules'));
 const first=await f.service.resources(f.id,'article.assets');assert.equal(first.entries.length,100);assert.ok(first.nextCursor);
 assert.equal(first.entries[0].kind,'directory');assert.equal(first.entries[2].name,'file0.txt');assert(!first.entries.some(e=>e.name==='nested.txt'||e.name==='.secret'||e.name==='node_modules'));
 const last=await f.service.resources(f.id,'article.assets',first.nextCursor);assert.equal(last.entries.length,5);assert.equal(last.nextCursor,undefined);
 await fs.writeFile(path.join(base,'added.txt'),'new');await assert.rejects(f.service.resources(f.id,'article.assets',first.nextCursor),/刷新/);
 assert.equal(await fs.readFile(path.join(f.root,'article.md'),'utf8'),'unchanged\n');
 await assert.rejects(fs.access(path.join(f.root,'.markdock.json')));
 }finally{await f.cleanup();}
});
test('resource access rejects ordinary paths, traversal, hidden paths, symlinks and ambiguous sibling folders',async()=>{
 const f=await setup();try{
 await fs.mkdir(path.join(f.root,'ordinary'));await fs.writeFile(path.join(f.root,'ordinary','private.txt'),'private');
 await fs.symlink(path.join(f.root,'ordinary'),path.join(f.root,'article.assets','linked'));
 await fs.writeFile(path.join(f.root,'article.assets','.hidden'),'hidden');
 for(const p of ['ordinary','../outside','article.assets/linked','article.assets/.hidden']) await assert.rejects(f.service.resources(f.id,p));
 await assert.rejects(f.service.resourceDownload(f.id,'article.md'));
 assert(!(await f.service.resources(f.id,'article.assets')).entries.some(e=>e.name==='linked'));
 await fs.mkdir(path.join(f.root,'article'));await fs.writeFile(path.join(f.root,'article','note.md'),'document');
 await fs.writeFile(path.join(f.root,'.markdock.json'),JSON.stringify({version:2,resources:{...defaultSettings.resources,mode:'sibling'},compatibility:[]}));
 await assert.rejects(f.service.resources(f.id,'article'),/Markdown/);
 }finally{await f.cleanup();}
});
test('resource downloads stream unchanged bytes; invalid preview, removed files and cancelled listing fail',async()=>{
 const f=await setup();try{
 const p='article.assets/images/sample.html';await fs.writeFile(path.join(f.root,p),'<script>unsafe</script>');
 const download=await f.service.resourceDownload(f.id,p);assert.equal(download.name,'sample.html');assert.equal(await new Response(download.stream).text(),'<script>unsafe</script>');
 await assert.rejects(f.service.resourceImage(f.id,p));
 await fs.writeFile(path.join(f.root,'article.assets','fake.png'),'not an image');await assert.rejects(f.service.resourceImage(f.id,'article.assets/fake.png'));
 await fs.unlink(path.join(f.root,p));await assert.rejects(f.service.resourceDownload(f.id,p));
 const abort=new AbortController();abort.abort();await assert.rejects(f.service.resources(f.id,'article.assets',undefined,abort.signal));
 }finally{await f.cleanup();}
});

test('fixed and compatible resource roots remain accessible; settings changes invalidate pages',async()=>{
 const f=await setup();try{
 await fs.mkdir(path.join(f.root,'public','images'),{recursive:true});
 await fs.mkdir(path.join(f.root,'old-images'));
 await fs.writeFile(path.join(f.root,'old-images','old.txt'),'old');
 for(let i=0;i<101;i++)await fs.writeFile(path.join(f.root,'public','images',`${i}.txt`),'x');
 const config={version:2,resources:{mode:'fixed',images:'public/images',attachments:'public/files',reference:'relative',publicRoot:''},compatibility:[{mode:'fixed',images:'old-images',attachments:'old-files',reference:'relative',publicRoot:''}]};
 await fs.writeFile(path.join(f.root,'.markdock.json'),JSON.stringify(config));
 const first=await f.service.resources(f.id,'public/images');assert.ok(first.nextCursor);
 assert.equal((await f.service.resources(f.id,'old-images')).entries[0].name,'old.txt');
 const old=await f.service.resourceDownload(f.id,'old-images/old.txt');assert.equal(await new Response(old.stream).text(),'old');
 config.resources.images='new-images';await fs.writeFile(path.join(f.root,'.markdock.json'),JSON.stringify(config));
 await assert.rejects(f.service.resources(f.id,'public/images',first.nextCursor));
 }finally{await f.cleanup();}
});
