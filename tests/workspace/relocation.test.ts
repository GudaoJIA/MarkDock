import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileService } from '../../src/features/workspace/server/files';
import { attachmentTarget } from '../../src/features/workspace/shared/attachments';
const bytes = (text: string) => new Blob([text]).stream();
async function fixture() {
 const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'noteai-move-')));
 const service = new FileService(); const {id} = await service.open(root);
 await fs.writeFile(path.join(root,'笔记.md'), '原文\n');
 return {root, service,id, cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
test('each note owns hidden images and file resources, preserving legacy download compatibility', async()=>{
 const f=await fixture(); try {
 const upload=await f.service.uploadAttachment(f.id,'笔记.md','中文 #.txt',bytes('bytes'));
 assert.ok(upload.path.startsWith('笔记.assets/file/'));
 assert.equal(attachmentTarget(f.id,'笔记.md',upload.url)?.path,upload.path);
 assert.equal(attachmentTarget(f.id,'笔记.md','file/x.txt'),undefined);
 assert.equal((await f.service.tree(f.id)).length,1);
 const download=await f.service.attachment(f.id,upload.path);
 assert.equal(await new Response(download.stream).text(),'bytes');
 await fs.mkdir(path.join(f.root,'附件')); await fs.writeFile(path.join(f.root,'附件','旧.txt'),'old');
 assert.equal(await new Response((await f.service.attachment(f.id,'附件/旧.txt')).stream).text(),'old');
 }finally{await f.cleanup();}
});
test('move carries owned assets, migrates legacy resources and only patches local URL spans including backlinks',async()=>{
 const f=await fixture();try{
 await fs.mkdir(path.join(f.root,'目标'));await fs.mkdir(path.join(f.root,'assets'));await fs.writeFile(path.join(f.root,'assets','图片.png'),'image');
 await fs.writeFile(path.join(f.root,'其他.md'),'other');
 const raw='---\r\ntitle: 不动\r\n---\r\n* 原格式\r\n\r\n![图片](assets/图片.png "标题")\r\n[其他][ref]\r\n\r\n[ref]: <其他.md> "保留"\r\n';
 await fs.writeFile(path.join(f.root,'笔记.md'),raw);
 await fs.writeFile(path.join(f.root,'入口.md'),'[笔记](笔记.md#标题)\n');
 const before=await f.service.read(f.id,'笔记.md');
 const moved=await f.service.move(f.id,'笔记.md','目标',before.version);
 assert.equal(moved.path,'目标/笔记.md');
 const saved=(await f.service.read(f.id,moved.path)).content;
 assert.ok(saved.startsWith('---\r\ntitle: 不动\r\n---\r\n* 原格式\r\n'));
 assert.match(saved,/\[ref\]: <\.\.\/.*\.md> "保留"/);
 assert.equal((await f.service.read(f.id,'入口.md')).content,'[笔记](%E7%9B%AE%E6%A0%87/%E7%AC%94%E8%AE%B0.md#标题)\n');
 assert.equal((await fs.readdir(path.join(f.root,'目标','笔记.assets','images'))).length,1);
 assert.equal(await fs.readFile(path.join(f.root,'assets','图片.png'),'utf8'),'image');
 const renamed=await f.service.rename(f.id,moved.path,'新名字.md');
 assert.ok((await f.service.read(f.id,renamed.path)).content.includes('%E6%96%B0%E5%90%8D%E5%AD%97.assets/images/'));
 assert.equal((await fs.readdir(path.join(f.root,'目标','新名字.assets','images'))).length,1);
 }finally{await f.cleanup();}
});
test('move rejects stale versions and collisions without moving anything; folder rename updates backlinks',async()=>{
 const f=await fixture();try{
 await fs.mkdir(path.join(f.root,'目标'));const file=await f.service.read(f.id,'笔记.md');
 await fs.writeFile(path.join(f.root,'笔记.md'),'external');
 await assert.rejects(f.service.move(f.id,'笔记.md','目标',file.version),/外部修改/);
 await fs.writeFile(path.join(f.root,'目标','笔记.md'),'collision');
 await assert.rejects(f.service.move(f.id,'笔记.md','目标',(await f.service.read(f.id,'笔记.md')).version),/同名/);
 assert.equal(await fs.readFile(path.join(f.root,'笔记.md'),'utf8'),'external');
 await fs.writeFile(path.join(f.root,'入口.md'),'[link](目标/笔记.md)\n');
 await f.service.rename(f.id,'目标','新目录');
 assert.ok((await f.service.read(f.id,'入口.md')).content.includes('%E6%96%B0%E7%9B%AE%E5%BD%95/'));
 }finally{await f.cleanup();}
});
test('migration is idempotent, copies shared resources per note and never rewrites code or frontmatter',async()=>{
 const f=await fixture();try{
 await fs.mkdir(path.join(f.root,'附件'));await fs.writeFile(path.join(f.root,'附件','共同.txt'),'shared');
 const raw='---\nurl: 附件/共同.txt\n---\n[附件](附件/共同.txt "title")\n\n`[code](附件/共同.txt)`\n';
 for(const name of ['笔记.md','另一篇.md'])await fs.writeFile(path.join(f.root,name),raw);
 await f.service.migrateResources(f.id,'笔记.md');await f.service.migrateResources(f.id,'另一篇.md');
 const first=(await f.service.read(f.id,'笔记.md')).content;
 assert.ok(first.includes('url: 附件/共同.txt'));assert.ok(first.includes('`[code](附件/共同.txt)`'));
 assert.equal(await fs.readFile(path.join(f.root,'笔记.assets','file','共同.txt'),'utf8'),'shared');
 assert.equal(await fs.readFile(path.join(f.root,'另一篇.assets','file','共同.txt'),'utf8'),'shared');
 await f.service.migrateResources(f.id,'笔记.md');assert.equal((await f.service.read(f.id,'笔记.md')).content,first);
 }finally{await f.cleanup();}
});
test('moving an owned bundle keeps Markdown bytes and unreferenced assets; special paths and code stay intact',async()=>{
 const f=await fixture();try{
 await fs.mkdir(path.join(f.root,'目标'));await fs.mkdir(path.join(f.root,'笔记.assets','images'),{recursive:true});await fs.writeFile(path.join(f.root,'笔记.assets','images','保留.png'),'image');await fs.writeFile(path.join(f.root,'笔记.assets','unused.bin'),'unused');
 const raw='---\ntitle: "[[metadata]]"\n---\n![x](笔记.assets/images/保留.png)\n\n```html\n<img src="example.png">\n```\n';
 await fs.writeFile(path.join(f.root,'笔记.md'),raw);
 await f.service.move(f.id,'笔记.md','目标',(await f.service.read(f.id,'笔记.md')).version);
 assert.equal((await f.service.read(f.id,'目标/笔记.md')).content,raw);
 assert.equal(await fs.readFile(path.join(f.root,'目标','笔记.assets','unused.bin'),'utf8'),'unused');
 }finally{await f.cleanup();}
});

import {WorkspaceController} from '../../src/features/workspace/state/sessions';
import {createDocumentEditor} from '../../src/features/workspace/editor/editor-kit';
import type {fileClient} from '../../src/features/workspace/shared/client';
test('sessions preserve history on path-only moves, reset rewritten links and guard pending uploads and composition',async()=>{
 const f=await fixture();let controller:WorkspaceController<any>|undefined;
 try{
 const uploaded=await f.service.uploadAttachment(f.id,'笔记.md','x.txt',bytes('x'));
 await fs.writeFile(path.join(f.root,'笔记.md'),`[x](${uploaded.url})\n`);await fs.mkdir(path.join(f.root,'目标'));
 const client:typeof fileClient={browse: async () => { throw new Error('unused'); },settings:id=>f.service.settings(id),saveSettings:(...a)=>f.service.updateSettings(...a),trashList:id=>f.service.trashList(id),trash:(...a)=>f.service.trash(...a),restore:(...a)=>f.service.restore(...a),purge:(...a)=>f.service.purge(...a),open:r=>f.service.open(r),read:(...a)=>f.service.read(...a),tree:id=>f.service.tree(id),save:(...a)=>f.service.save(...a),create:(...a)=>f.service.create(...a),rename:(...a)=>f.service.rename(...a),move:(...a)=>f.service.move(...a)};
 controller=new WorkspaceController(client,{create:createDocumentEditor});await controller.open(f.root);await controller.select('笔记.md');
 const doc=controller.active!;doc.editor.tf.select(doc.editor.api.end([])!);doc.editor.tf.insertText('编辑');controller.changed(doc);doc.scroll=91;controller.rememberSelection(doc,doc.editor.selection);
 const release=controller.beginTask(doc)!;assert.equal(await controller.move(doc.path,'目标'),false);release();
 controller.composition(doc,true);assert.equal(await controller.move(doc.path,'目标'),false);controller.composition(doc,false);
 assert.equal(await controller.move(doc.path,'目标'),true);assert.equal(controller.active,doc);assert.equal(doc.path,'目标/笔记.md');assert.ok(doc.editor.history.undos.length);assert.equal(doc.scroll,91);
 assert.equal(await controller.rename(doc.path,'改名.md'),true);assert.notEqual(controller.active,doc);assert.equal(controller.active!.editor.history.undos.length,0);assert.equal(controller.active!.scroll,91);
 assert.ok(controller.active!.serialize().includes('%E6%94%B9%E5%90%8D.assets/file/'));
 }finally{controller?.dispose();await f.cleanup();}
});
