import { FileService } from '../src/features/workspace/server/files';
import { assertTransactionsSettled } from '../src/features/workspace/server/file-transaction';
import { linkSpans,localTarget } from '../src/features/workspace/server/link-paths';
import type {TreeEntry} from '../src/features/workspace/shared/types';
const apply=process.argv.includes('--apply');
const roots=process.argv.slice(2).filter(value=>!value.startsWith('--'));
if(!roots.length)throw new Error('用法：bun scripts/migrate-resources.ts [--apply] /绝对工作区目录');
const service=new FileService();
for(const root of roots){
 const workspace=await service.open(root, {recover: apply});const paths:string[]=[];
 const walk=(entries:TreeEntry[])=>{for(const entry of entries)if(entry.kind==='file')paths.push(entry.path);else walk(entry.children??[]);};walk(await service.tree(workspace.id));
 const candidates:string[]=[];
 for(const p of paths){try{
 const file=await service.read(workspace.id,p);
 if(linkSpans(file.content).some(span=>{const target=localTarget(p,span.url);return target?.path.split('/').slice(0,-1).some(part=>part==='assets'||part==='附件');}))candidates.push(p);
 }catch(error){console.log(JSON.stringify({root,path:p,status:'skipped',reason:String(error)}));}}
 if(!apply)await assertTransactionsSettled(workspace.root);
 console.log(JSON.stringify({root,mode:apply?'apply':'preview',documents:candidates}));
 if(apply)for(const p of candidates){try{const result=await service.migrateResources(workspace.id,p);console.log(JSON.stringify({root,path:p,status:'migrated',changed:result.files.map(file=>file.path)}));}catch(error){console.log(JSON.stringify({root,path:p,status:'failed',reason:String(error)}));process.exitCode=1;}}
}
