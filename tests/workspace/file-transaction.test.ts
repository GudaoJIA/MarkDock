import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileTransaction,recoverTransactions} from '../../src/features/workspace/server/file-transaction';
test('failed multi-file operation rolls back earlier steps without overriding a collision',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'noteai-journal-')));
 try{
 await fs.writeFile(path.join(root,'a.md'),'A');await fs.writeFile(path.join(root,'b.md'),'B');await fs.writeFile(path.join(root,'taken.md'),'external');
 const tx=new FileTransaction(root);await tx.prepare();await tx.move('a.md','moved.md');await tx.move('b.md','taken.md');
 await assert.rejects(tx.commit(),/目标/);
 assert.equal(await fs.readFile(path.join(root,'a.md'),'utf8'),'A');assert.equal(await fs.readFile(path.join(root,'taken.md'),'utf8'),'external');
 await recoverTransactions(root);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('opening recovers a journal interrupted after rename; externally changed destination is preserved',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'noteai-journal-')));
 try{
 await fs.writeFile(path.join(root,'a.md'),'A');const tx=new FileTransaction(root);await tx.prepare();await tx.move('a.md','moved.md');
 const journal=path.join(root,tx.directory,'journal.json');
 await fs.writeFile(journal,JSON.stringify({version:1,state:'prepared',attempted:1,steps:tx.steps}));
 await fs.rename(path.join(root,'a.md'),path.join(root,'moved.md'));
 await fs.writeFile(path.join(root,'moved.md'),'external');
 await assert.rejects(recoverTransactions(root),/外部修改/);
 assert.equal(await fs.readFile(path.join(root,'moved.md'),'utf8'),'external');
 await fs.writeFile(path.join(root,'moved.md'),'A');await recoverTransactions(root);
 assert.equal(await fs.readFile(path.join(root,'a.md'),'utf8'),'A');await recoverTransactions(root);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('invalid journal states, counts and steps preserve every byte before recovery starts', async () => {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'noteai-invalid-journal-')));
 try {
  await fs.writeFile(path.join(root,'a.md'),'A');
  const valid=new FileTransaction(root); await valid.prepare(); await valid.move('a.md','moved.md');
  const validPath=path.join(root,valid.directory,'journal.json');
  const validRaw=JSON.stringify({version:1,state:'prepared',attempted:1,steps:valid.steps});
  await fs.writeFile(validPath,validRaw);await fs.rename(path.join(root,'a.md'),path.join(root,'moved.md'));
  const bad=new FileTransaction(root);await bad.prepare(); const badPath=path.join(root,bad.directory,'journal.json');
  const base={version:1,state:'prepared',attempted:0,steps:valid.steps};
  const malformed: unknown[]=[null,{}, {...base,version:2}, {...base,state:'unknown'}, {...base,attempted:-1}, {...base,attempted:2}, {...base,attempted:0.5}, {...base,state:'committed'}, {...base,state:'rolled-back',attempted:1}, {...base,steps:[null]}, {...base,steps:[{...valid.steps[0],fingerprint:'bad'}]}, {...base,steps:[{...valid.steps[0],from:'../outside'}]}, {...base,steps:[{...valid.steps[0],from:''}]}, {...base,steps:[{...valid.steps[0],to:valid.steps[0].from}]}, {...base,steps:[{...valid.steps[0],to:valid.directory+'/journal.json'}]}];
  for(const value of malformed) {
   const raw=JSON.stringify(value);await fs.writeFile(badPath,raw);
   await assert.rejects(recoverTransactions(root));
   assert.equal(await fs.readFile(validPath,'utf8'),validRaw);assert.equal(await fs.readFile(badPath,'utf8'),raw);
   assert.equal(await fs.readFile(path.join(root,'moved.md'),'utf8'),'A');assert.equal(await fs.stat(path.join(root,'a.md')).then(()=>true,()=>false),false);
  }
  await fs.writeFile(badPath,'{truncated');await assert.rejects(recoverTransactions(root),(e:any)=>e.status===409);
  assert.equal(await fs.readFile(validPath,'utf8'),validRaw);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
