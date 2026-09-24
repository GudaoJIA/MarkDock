import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FileTransaction } from '../../src/features/workspace/server/file-transaction';
import { FileService } from '../../src/features/workspace/server/files';

async function snapshot(root: string): Promise<unknown> {
 const entries: unknown[]=[];
 for(const name of (await fs.readdir(root)).sort()) {
  const target=path.join(root,name),stat=await fs.lstat(target);
  entries.push([name,stat.mode,stat.mtimeMs,stat.isDirectory()?await snapshot(target):(await fs.readFile(target)).toString('base64')]);
 }
 return entries;
}
function preview(root: string) {
 return spawnSync(process.execPath,['--no-env-file','run','scripts/migrate-resources.ts',root],{cwd:fileURLToPath(new URL('../..', import.meta.url)),encoding:'utf8',env:{NODE_ENV:'test',PATH:process.env.PATH,HOME:process.env.HOME,MARKDOCK_WORKSPACE_ROOTS:JSON.stringify([root]),MARKDOCK_DATA_DIR:path.join(root,'service-config-not-created')},timeout:10000});
}

test('CLI preview is read-only and refuses unfinished or corrupt recovery records', async () => {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'noteai-preview-')));
 try {
  await fs.mkdir(path.join(root,'assets'));await fs.writeFile(path.join(root,'assets','image.png'),'image');await fs.writeFile(path.join(root,'a.md'),'![image](assets/image.png)');
  const before=await snapshot(root),clean=preview(root);assert.equal(clean.status,0,clean.stderr);assert.match(clean.stdout,/a.md/);assert.deepEqual(await snapshot(root),before);
  const tx=new FileTransaction(root);await tx.prepare();await tx.move('a.md','moved.md');await fs.rename(path.join(root,'a.md'),path.join(root,'moved.md'));
  const journal=path.join(root,tx.directory,'journal.json');await fs.writeFile(journal,JSON.stringify({version:1,state:'prepared',attempted:1,steps:tx.steps}));
  const interrupted=await snapshot(root),blocked=preview(root);assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/未完成/);assert.deepEqual(await snapshot(root),interrupted);
  await new FileService(undefined,[root]).open(root);assert.equal(await fs.readFile(path.join(root,'a.md'),'utf8'),'![image](assets/image.png)');
  const recovered=await snapshot(root);assert.equal(preview(root).status,0);assert.deepEqual(await snapshot(root),recovered);
  await fs.writeFile(journal,'{broken');const corrupt=await snapshot(root);assert.notEqual(preview(root).status,0);assert.deepEqual(await snapshot(root),corrupt);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
