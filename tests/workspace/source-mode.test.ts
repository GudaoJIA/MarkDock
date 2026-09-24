import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeApi } from 'platejs';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import { changeBlockFormat, runCommand, toggleTextFormat } from '../../src/features/workspace/editor/commands';
import { applySourceChanges, sourceText } from '../../src/features/workspace/editor/source-text';
import { replaceMatches } from '../../src/features/workspace/writing/writing';
import { visitSource } from '../../src/features/workspace/state/editable-document';

const make = (content: string) => createDocumentEditor({path:'文章.md',content,version:'1'}, {id:'test',root:'/test-source',name:'test'});
const samples = [
  '', '  \n\n', '# 标题\n\n原文 *强调*\n\n', '\uFEFF---\r\ntitle: 中文\r\n---\r\n\r\n# Hello\r\n',
  'one\r\ntwo\nthree\r\nfour', 'a\rb\r', '<Component value={1}>\n正文\n</Component>\n',
  '---\ntitle: 未结束', '```js title="demo"\nlet x=1\n```\n',
  '[link][ref]\n\n[ref]: https://example.com "title"\n\n',
  '脚注[^1]\n\n[^1]: 说明\n', '{% if enabled %}\n\n# Conditional\n\n{% endif %}\n',
  '[bad](javascript:alert)\n', '```\n未结束的代码\n',
];

test('source mounting accepts a retained session without new methods or view fields', () => {
  const doc = make('Original\n');
  doc.document.connect(() => doc.document.capture());
  doc.document.switchMode('source');
  doc.document.editSource('Unsaved draft\n');
  Reflect.deleteProperty(doc.document, 'sourceVisited');
  Object.defineProperty(doc.document, 'visitSource', {value: undefined});
  assert.equal(visitSource(doc.document), true);
  assert.equal(visitSource(doc.document), false);
  assert.equal(doc.serialize(), 'Unsaved draft\n');
  doc.document.undo();
  assert.equal(doc.serialize(), 'Original\n');
});
test('opening and repeated mode switches preserve exact source bytes without history entries', () => {
  for (const text of samples) {
    const doc = make(text);
    doc.document.connect(() => doc.document.capture());
    for(let i=0;i<3;i++) {
      assert.equal(doc.serialize(),text);
      doc.document.switchMode('source');
      assert.equal(doc.serialize(),text);
      doc.document.switchMode('rich');
    }
    assert.equal(doc.serialize(),text);
    assert.equal(doc.document.canUndo,false);
    assert.equal(doc.readOnlyReason,undefined);
  }
});
test('editing ordinary text preserves surrounding unknown syntax, spacing and reference definitions', () => {
  const raw = '# Title\n\n<Custom x="yes">keep  exact</Custom>\n\n\nNormal text\n\n[unused]: /unchanged  "x"\n\n';
  const doc = make(raw);
  const index = doc.editor.children.findIndex(n=>NodeApi.string(n)==='Normal text');
  doc.editor.tf.select(doc.editor.api.end([index])!);
  doc.editor.tf.insertText(' edited');
  assert.equal(doc.serialize(),raw.replace('Normal text','Normal text edited'));
});
test('raw blocks accept literal editing and replacement without formatting or execution', () => {
  const doc=make('Before\n\n<Custom>old</Custom>\n\nAfter\n');
  const raw=doc.editor.children.findIndex(n=>n.type==='workspace_raw');
  doc.editor.tf.select(doc.editor.api.range([raw])!);
  assert.equal(changeBlockFormat(doc.editor,'h1'),false);
  assert.equal(toggleTextFormat(doc.editor,'bold'),false);
  const before=doc.serialize();
  runCommand(doc.editor,'table',()=>{},()=>{},{insert:true});
  assert.equal(doc.serialize(),before);
  replaceMatches(doc.editor,'old','new **literal**',true);
  assert.equal(doc.serialize(),before.replace('old','new **literal**'));
  doc.editor.tf.select(doc.editor.api.end([raw])!);
  doc.editor.tf.insertBreak();
  doc.editor.tf.insertText('# literal');
  assert.equal(doc.editor.children[raw].type,'workspace_raw');
  assert.ok(doc.serialize().includes('</Custom>\n# literal'));
});
test('undo and redo traverse source and rich edits without changing the selected mode', () => {
  const doc=make('Original\n');
  doc.document.connect(()=>doc.document.capture());
  doc.editor.tf.select(doc.editor.api.end([0])!);
  doc.editor.tf.insertText(' rich');
  doc.document.capture();
  const rich=doc.serialize();
  doc.document.switchMode('source');
  doc.document.editSource(rich+'\n<Extra />\n');
  const source=doc.serialize();
  doc.document.switchMode('rich');
  doc.document.undo();
  assert.equal(doc.serialize(),rich);
  assert.equal(doc.document.mode,'rich');
  doc.document.undo();
  assert.equal(doc.serialize(),'Original\n');
  doc.document.redo();
  assert.equal(doc.serialize(),rich);
  doc.document.switchMode('source');
  doc.document.redo();
  assert.equal(doc.serialize(),source);
  assert.equal(doc.document.mode,'source');
});
test('source patches preserve untouched mixed newlines and BOM', () => {
  const raw='\uFEFFa\r\nb\nc\r\nd';
  const normalized=sourceText(raw);
  const at=normalized.indexOf('c');
  const changed=applySourceChanges(raw,[{from:at,to:at+1,insert:'中文'}]);
  assert.equal(changed,'\uFEFFa\r\nb\n中文\r\nd');
  assert.equal(applySourceChanges(raw,[{from:0,to:0,insert:'x'},{from:normalized.length,to:normalized.length,insert:'y'}]),'x'+raw+'y');
});
test('a composition is one history entry and a mode switch creates a history boundary', () => {
  const doc=make('');
  doc.document.connect(()=>doc.document.capture());
  doc.document.switchMode('source');
  doc.document.composition(true);
  doc.document.editSource('中');
  doc.document.editSource('中文');
  doc.document.composition(false);
  doc.document.switchMode('rich');
  doc.document.undo();
  assert.equal(doc.serialize(),'');
  doc.document.redo();
  assert.equal(doc.serialize(),'中文');
});

test('editing a distant paragraph does not normalize compact blocks or distinct lists', () => {
  for (const raw of ['# Heading\nparagraph\n\nOther\n', '* one\n\n\n- two\n\nOther\n', '\uFEFF# Heading\r\nparagraph\r\n\r\nOther\r\n']) {
    const doc = make(raw);
    const index = doc.editor.children.findIndex(n => NodeApi.string(n) === 'Other');
    doc.editor.tf.select(doc.editor.api.end([index])!);
    doc.editor.tf.insertText(' changed');
    assert.equal(doc.serialize(), raw.replace('Other', 'Other changed'));
  }
});

test('unchanged round trip restores rich selection and maps CRLF source positions', () => {
  const doc = make('# Heading\r\n\r\nSecond paragraph\r\n');
  const point = {path:[1,0], offset:4};
  doc.editor.tf.select(point);
  doc.document.switchMode('source');
  assert.equal(doc.document.sourceSelection?.head, '# Heading\n\n'.length);
  doc.document.switchMode('rich');
  assert.deepEqual(doc.editor.selection?.anchor, point);
});

test('deleting across raw boundaries stays literal and is undoable', () => {
  const text = 'Before\n\n<X>raw</X>\n\n\nAfter\n';
  const doc = make(text);
  doc.document.connect(()=>doc.document.capture());
  doc.editor.tf.select(doc.editor.api.start([1])!);
  doc.editor.tf.withNewBatch(()=>doc.editor.tf.deleteBackward('character'));
  doc.document.capture();
  assert.equal(doc.serialize(),'Before<X>raw</X>\n\n\nAfter\n');
  doc.document.undo();assert.equal(doc.serialize(),text);
  doc.editor.tf.select({anchor:{path:[0,0],offset:3},focus:{path:[1,0],offset:3}});
  doc.editor.tf.withNewBatch(()=>doc.editor.tf.deleteFragment());doc.document.capture();
  assert.ok(doc.serialize().startsWith('Befraw</X>'));
  assert.equal(doc.editor.children[0].type,'workspace_raw');
  doc.document.undo();assert.equal(doc.serialize(),text);
});

test('template examples inside code remain ordinary supported code', () => {
  const raw = 'Use `{value}` literally.\n\n```js\nfunction hello() { return 1; }\n```\n\n```liquid\n{% if show %}hello{% endif %}\n```\n';
  const doc = make(raw);
  assert.equal(doc.editor.children.some(n=>n.type==='workspace_raw'),false);
  assert.equal(doc.editor.children.filter(n=>n.type==='code_block').length,2);
  assert.equal(doc.serialize(),raw);
});
