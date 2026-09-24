import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import { defaultHistoryLimits, MiB } from '../../src/features/workspace/shared/history-settings';
import { HistoryBudget } from '../../src/features/workspace/state/history-budget';
const make=(budget:HistoryBudget)=>{const result=createDocumentEditor({path:'note.md',content:'start',version:'1'},{root:'/isolated',id:'test',name:'test'},budget);result.document.switchMode('source');return result;};
test('batch limits preserve continuous undo and redo, without emitting a content change when configured',()=>{
 const budget=new HistoryBudget();const {document}=make(budget);let changes=0;document.connect(()=>changes++);
 for(let i=1;i<=25;i++){document.breakHistory();document.editSource('text'+i);}
 const before=changes;budget.configure({...defaultHistoryLimits,batches:20});assert.equal(changes,before);assert.equal(document.text(),'text25');assert.equal(document.historyStats.undo,20);
 for(let i=0;i<20;i++)document.undo();assert.equal(document.text(),'text5');assert.equal(document.canUndo,false);assert.equal(document.historyStats.redo,20);
 for(let i=0;i<20;i++)document.redo();assert.equal(document.text(),'text25');assert.equal(document.canRedo,false);
 document.dispose();assert.equal(budget.bytes,0);
});
test('redo trimming removes distant future entries and never jumps over a missing state',()=>{
 const budget=new HistoryBudget();const {document}=make(budget);
 for(let i=1;i<=30;i++)document.editSource('v'+i);
 for(let i=0;i<25;i++)document.undo();assert.equal(document.text(),'v5');
 budget.configure({...defaultHistoryLimits,batches:20});assert.equal(document.historyStats.undo,0);assert.equal(document.historyStats.redo,20);
 for(let i=0;i<20;i++)document.redo();assert.equal(document.text(),'v25');assert.equal(document.canRedo,false);
});
test('single-document bytes, merged batches and oversize operations are bounded without changing draft',()=>{
 const budget=new HistoryBudget();budget.configure({batches:200,documentMiB:4,pageMiB:16});const {document}=make(budget);
 const large='a'.repeat(600000);
 document.editSource(large,'typing');document.editSource(large+'b','typing');assert.equal(document.historyStats.undo,1);
 assert.equal(document.historyStats.bytes,2*('start'.length+large.length+1));
 document.breakHistory();document.editSource(large+'c');document.breakHistory();document.editSource(large+'d');assert(budget.bytes<=4*MiB);assert.equal(document.text(),large+'d');
 const huge='x'.repeat(3*MiB);document.editSource(huge);assert.equal(document.canUndo,false);assert.equal(document.historyStats.bytes,0);assert.equal(document.text(),huge);assert(document.historyNotice);
 document.editSource('small');assert.equal(document.canUndo,false);document.editSource('next');document.undo();assert.equal(document.text(),'small');
});
test('page budget includes inactive documents and releases disposed accounts',()=>{
 const budget=new HistoryBudget();budget.configure({batches:1000,documentMiB:16,pageMiB:16});const a=make(budget),b=make(budget);
 const content='x'.repeat(500000);
 for(let i=0;i<7;i++)a.document.editSource(content+i);
 for(let i=0;i<7;i++)b.document.editSource(content+i);
 assert(budget.bytes<=16*MiB);assert(a.document.historyStats.undo<b.document.historyStats.undo);assert.equal(a.document.text(),content+'6');assert.equal(b.document.text(),content+'6');
 b.document.dispose();assert.equal(budget.bytes,a.document.historyStats.bytes);a.document.dispose();assert.equal(budget.bytes,0);
});
test('lowering budgets waits for IME commit and does not split composition',()=>{
 const budget=new HistoryBudget();const {document}=make(budget);document.composition(true);document.editSource('a'.repeat(3*MiB));budget.configure({batches:20,documentMiB:4,pageMiB:16});assert.equal(document.canUndo,true);document.editSource('中'.repeat(3*MiB));assert.equal(document.historyStats.undo,1);document.composition(false);assert.equal(document.canUndo,false);assert.equal(budget.bytes,0);assert.equal(document.text().length,3*MiB);
});
test('rich text and source share budgeted history; inner Slate operations remain bounded',()=>{
 const budget=new HistoryBudget();const {editor,document}=createDocumentEditor({path:'note.md',content:'hello',version:'1'},{root:'/isolated',id:'test',name:'test'},budget);
 document.connect(()=>{});editor.tf.select(editor.api.end([0])!);
 for(let i=0;i<30;i++){editor.tf.insertText('x');document.capture();}
 assert(editor.history.undos.length<=1);assert(editor.history.undos.every(b=>b.operations.length<=1));
 const rich=document.text();document.switchMode('source');document.editSource(rich+'\nsource');document.undo();assert.equal(document.text(),rich);document.undo();assert.notEqual(document.text(),rich);document.redo();assert.equal(document.text(),rich);
});
