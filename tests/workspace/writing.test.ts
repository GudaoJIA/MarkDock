import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import { writingModel, countWords, replaceMatches } from '../../src/features/workspace/writing/writing';
const make = (content: string) => createDocumentEditor({ path: 'a.md', content, version: '1' }, { id: 'a', root: '/test', name: 'test' });

test('outline identities survive edits and moves; folding never changes Markdown or history', () => {
  const doc = make('# 相同\n\n第一节\n\n## 子节\n\n子内容\n\n# 相同\n\n第二节\n');
  const model = writingModel(doc.editor);
  const before = doc.serialize();
  const h = model.headings();
  assert.equal(h.length, 3);
  assert.notEqual(h[0].id, h[2].id);
  model.toggle(h[0].id);
  assert.equal(model.hidden(3), true);
  assert.equal(model.hidden(4), false);
  assert.equal(doc.serialize(), before);
  assert.equal(doc.editor.history.undos.length, 0);
  model.reveal(3);
  assert.equal(model.hidden(3), false);
  assert.equal(model.move(h[2].id, 0), true);
  assert.equal(model.headings()[0].id, h[2].id);
  assert.match(doc.serialize(), /^# 相同\n\n第二节/);
  doc.editor.tf.undo();
  assert.equal(doc.serialize(), before);
});

test('section moves only allow sibling sections and carry complete contents; lists keep descendants', () => {
  const doc = make('# 一\n\n## 小节\n\n内容\n\n# 二\n\n- 父\n  - 子\n\n尾部\n');
  const model = writingModel(doc.editor);
  const h = model.headings();
  assert.equal(model.canMove(h[1].id, 0), false);
  const parent = model.entries().find(x => x.node.listStyleType && x.text === '父')!;
  const before = doc.serialize();
  assert.equal(model.unit(parent.index).end, parent.index + 2);
  model.move(parent.id, doc.editor.children.length);
  assert.match(doc.serialize(), /尾部[\s\S]*父[\s\S]*子/);
  doc.editor.tf.undo();
  assert.equal(doc.serialize(), before);
});

test('replacement is literal, spans marks, preserves URLs/frontmatter and undoes in one batch', () => {
  const doc = make('---\ntitle: 你好\n---\n\n**你好**世界 [你好世界](https://example.com/你好世界)\n');
  const before = doc.serialize();
  assert.equal(replaceMatches(doc.editor, '你好世界', '# 新文字', true), 2);
  const after = doc.serialize();
  assert.match(after, /title: 你好/);
  assert.match(after, /https:\/\/example.com\/你好世界/);
  assert.equal(doc.editor.children[0].type, 'p');
  doc.editor.tf.undo();
  assert.equal(doc.serialize(), before);
});

test('replace all exceeds highlight limit, supports deletion and spaces without touching image paths', () => {
  const doc = make(('foo '.repeat(1205)).trim() + '\n\n![foo](a.assets/images/foo.png)\n');
  assert.equal(replaceMatches(doc.editor, 'foo', 'bar', true), 1205);
  assert.match(doc.serialize(), /images\/foo.png/);
  assert.equal(replaceMatches(doc.editor, 'bar ', '', true), 1204);
  assert.equal(replaceMatches(doc.editor, '', 'x', true), 0);
});

test('mixed word counts exclude punctuation and separate Chinese characters from English words', () => {
  assert.equal(countWords('你好 world 2026，hello-world！'), 6);
  assert.equal(countWords(' \n…，。'), 0);
});

import { documentText } from '../../src/features/workspace/writing/writing';
import { NodeApi } from 'platejs';
import { remapWritingGoals, setWritingGoal } from '../../src/features/workspace/writing/writing-preferences';

test('statistics count table/code/selection text but exclude image captions, URLs and YAML', () => {
  const doc = make('---\ntitle: 不统计\n---\n\n# 标题\n\n你好 **world** [链接](https://example.com/not-counted)\n\n| 表头 | code |\n| --- | --- |\n| 内容 | 42 |\n\n```js\nconst answer = 42;\n```\n\n![不统计](a.png)\n');
  const text = documentText(doc.editor);
  assert.equal(countWords(text), 16);
  assert.equal(text.includes('不统计'), false);
  assert.equal(text.includes('not-counted'), false);
  const range = { anchor: {path: [1, 0], offset: 0}, focus: {path: [1, 0], offset: 2} };
  assert.equal(countWords(documentText(doc.editor, range)), 2);
});

test('folding moves hidden selections to the heading; delete guard expands without changing content', () => {
  const doc = make('# 一\n\n隐藏\n\n## 子节\n\n正文\n\n# 二\n\n结尾\n');
  const model = writingModel(doc.editor);
  const before = doc.serialize();
  const [parent, child] = model.headings();
  model.toggle(child.id);
  doc.editor.tf.select(doc.editor.api.start([1])!);
  model.toggle(parent.id);
  assert.equal(doc.editor.selection!.anchor.path[0], 0);
  assert.equal(model.collapsed.has(child.id), true);
  doc.editor.tf.select({anchor: doc.editor.api.end([0])!, focus: doc.editor.api.start([4])!});
  assert.equal(model.guardDelete(true), true);
  assert.equal(model.hidden(3), false);
  assert.equal(doc.serialize(), before);
  assert.equal(doc.editor.history.undos.length, 0);
  doc.editor.tf.setNodes({ type: 'h3' }, {at: [2]});
  assert.equal(model.headings()[1].id, child.id);
  assert.equal(model.headings()[1].level, 3);
});

test('single replacement inherits starting marks and preserves surrounding text styles', () => {
  const doc = make('前 **你好**_世界尾_ 后\n');
  assert.equal(replaceMatches(doc.editor, '你好世界', '新', false), 1);
  const leaves = [...NodeApi.texts(doc.editor.children[0])].map(([leaf]) => leaf);
  assert.equal(leaves.find(x => x.text === '新')?.bold, true);
  assert.equal(leaves.find(x => x.text === '尾')?.italic, true);
  assert.equal(replaceMatches(doc.editor, '新\n', 'x', true), 0);
});

test('writing goals are workspace-specific and follow document and directory path mappings', () => {
  const store = new Map<string,string>();
  const previous = { storage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), window: Object.getOwnPropertyDescriptor(globalThis, 'window') };
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: (key:string) => store.get(key), setItem: (key:string,value:string) => store.set(key,value)}});
  Object.defineProperty(globalThis, 'window', {configurable: true, value: new EventTarget()});
  try {
    setWritingGoal('/one', '目录/a.md', 100);
    setWritingGoal('/one', '目录/b.md', 200);
    setWritingGoal('/two', '目录/a.md', 500);
    remapWritingGoals('/one', [{from: '目录', to: '新目录'}, {from: '目录/a.md', to: '新目录/改名.md'}]);
    const goals = JSON.parse(store.get('noteai.writing.v1')!).goals;
    assert.deepEqual(goals['/one'], {'新目录/改名.md':100, '新目录/b.md':200});
    assert.equal(goals['/two']['目录/a.md'],500);
    setWritingGoal('/one', '新目录/改名.md');
    assert.equal(JSON.parse(store.get('noteai.writing.v1')!).goals['/one']['新目录/改名.md'], undefined);
  } finally {
    if(previous.storage) Object.defineProperty(globalThis, 'localStorage', previous.storage); else Reflect.deleteProperty(globalThis, 'localStorage');
    if(previous.window) Object.defineProperty(globalThis, 'window', previous.window); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('deleting within visible text leaves unrelated folded sections alone', () => {
  const doc = make('# 一\n\n隐藏内容\n\n# 第二章节\n\n后文\n');
  const model = writingModel(doc.editor);
  const first = model.headings()[0];
  model.toggle(first.id);
  doc.editor.tf.select({path:[2,0],offset:2});
  assert.equal(model.guardDelete(true), false);
  assert.equal(model.collapsed.has(first.id), true);
  doc.editor.tf.select(doc.editor.api.start([2])!);
  assert.equal(model.guardDelete(true), true);
});

import { convertDomEventToSyntheticEvent } from 'platejs/react';
import { guardWritingInput } from '../../src/features/workspace/writing/writing';
test('Plate-wrapped input events retain native inputType and composition deletion protection', () => {
  const doc = make('# 折叠\n\n隐藏文字\n\n# 后文\n');
  const model = writingModel(doc.editor);
  model.toggle(model.headings()[0].id);
  doc.editor.tf.select(doc.editor.api.start([2])!);
  const event = new Event('beforeinput', {cancelable: true});
  Object.defineProperty(event, 'inputType', {get: () => 'deleteContentBackward'});
  const wrapped = convertDomEventToSyntheticEvent(event);
  assert.equal((wrapped as any).inputType, undefined);
  assert.equal(guardWritingInput(model, wrapped), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(model.hidden(1), false);
  const input = new Event('beforeinput');
  Object.defineProperty(input, 'inputType', {get: () => 'insertText'});
  assert.doesNotThrow(() => guardWritingInput(model, convertDomEventToSyntheticEvent(input)));
  model.toggle(model.headings()[0].id);
  doc.editor.tf.select(doc.editor.api.start([2])!);
  const composition = new Event('beforeinput', {cancelable: true});
  Object.defineProperties(composition, {inputType: {get: () => 'deleteContentBackward'}, isComposing: {get: () => true}});
  guardWritingInput(model, convertDomEventToSyntheticEvent(composition));
  assert.equal(model.hidden(1), true);
  assert.equal(composition.defaultPrevented, false);
});
