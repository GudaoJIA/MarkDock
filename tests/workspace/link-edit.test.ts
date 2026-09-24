import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeApi } from 'platejs';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import { editWorkspaceLink } from '../../src/features/workspace/editor/link-edit';
import { linkAddress } from '../../src/features/workspace/shared/link-address';

const make = (content = 'hello **world**') => createDocumentEditor(
  {path:'note.md',content,version:'1'}, {id:'isolated',root:'/isolated',name:'test'});

test('link inputs normalize bare hosts without probing and preserve document references', () => {
  for (const [input,expected] of [
    ['  not-launched.example/path  ','https://not-launched.example/path'],
    ['example.com?x=1#part','https://example.com?x=1#part'],
    ['http://localhost:9999','http://localhost:9999'],
    ['https://服务器.example/文档','https://服务器.example/文档'],
    ['../draft.md','../draft.md'],['README.md','README.md'],['doc.pdf','doc.pdf'],
    ['docs/my note.md','docs/my note.md'],['/future','/future'],['#标题','#标题'],
    ['mailto:editor@example.com','mailto:editor@example.com'],['draft','draft'],
  ]) assert.equal(linkAddress(input,true),expected);
  assert.equal(linkAddress('README.md'),'README.md');
  for(const input of ['', '  ', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,test', 'file:///tmp/a', 'vbscript:test', 'java\nscript:alert(1)', 'https://', '\\host\file', 'mailto:'])
    assert.equal(linkAddress(input,true),undefined,input);
});

test('links preserve marks, share source undo and remain valid after saving and reopening',()=>{
 const {editor,document}=make();document.connect(()=>{});editor.tf.select(editor.api.range([0])!);
 assert.equal(editWorkspaceLink(editor,editor.selection,'future.example','hello world'),'');
 document.capture();
 const saved=document.text();assert(saved.includes('https://future.example'));assert(saved.includes('**world**'));
 const links=[...editor.api.nodes({at:[],match:{type:'a'}})];assert.equal(links.length,1);
 const path=links[0][1];assert.equal(editWorkspaceLink(editor,editor.selection,'../not-created.md','hello world',path),'');document.capture();
 assert(document.text().includes('../not-created.md'));
 document.switchMode('source');document.undo();assert.equal(document.text(),saved);
 document.redo();const reopened=make(document.text());assert.equal(reopened.document.text(),document.text());
});

test('invalid or removed link targets cannot append links or edit a replacement node',()=>{
 const {editor,document}=make();document.connect(()=>{});const original=document.text();
 assert(editWorkspaceLink(editor,null,'example.com','hello'));assert.equal(document.text(),original);
 editor.tf.select(editor.api.range([0])!);
 assert(editWorkspaceLink(editor,editor.selection,'javascript:alert(1)','hello'));assert.equal(document.text(),original);
 assert.equal(editWorkspaceLink(editor,editor.selection,'#draft','hello world'),'');
 document.capture();const link=[...editor.api.nodes({at:[],match:{type:'a'}})][0];
 const target=editor.api.pathRef(link[1]);const range=editor.api.rangeRef(editor.selection!);
 editor.tf.removeNodes({at:link[1]});editor.tf.insertText('replacement');
 const before=document.text();assert.equal(target.current,null);
 assert(editWorkspaceLink(editor,range.current,'example.com','wrong',target.current));assert.equal(document.text(),before);
 assert.equal(NodeApi.string(editor),'replacement');
 range.unref();target.unref();
});
