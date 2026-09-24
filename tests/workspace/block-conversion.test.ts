import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockConversionState, convertBlock, deleteBlock } from '../../src/features/workspace/editor/block-conversion';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';

const document = (content: string) => createDocumentEditor(
  { path: 'test.md', content, version: '1' }, { id: 'test', name: 'test', root: '/test' }
);

test('block deletion preserves neighbors and undoes exactly across modes including raw and table blocks', () => {
  for (const block of ['# 标题', '> 引用', '```js\na\n```', '| a | b |\n| - | - |\n| c | d |', '<Raw />', '***', '![图](x.png)']) {
    const source = `${block}\n\n保留正文\n`;
    const doc = document(source); doc.document.connect(() => doc.document.capture());
    deleteBlock(doc.editor, [0]); doc.document.capture();
    assert.match(doc.document.text(), /保留正文/);
    doc.document.switchMode('source'); doc.document.undo();
    assert.equal(doc.document.text(), source);
  }
  const doc = document('最后一段'); deleteBlock(doc.editor, [0]);
  assert.equal(doc.editor.children[0].type, 'p');
});

test('body, headings, lists and quotes convert in either direction with one shared undo', () => {
  const sources = ['**目标**\n\n外部\n', '## **目标**\n\n外部\n', '- **目标**\n\n外部\n', '1. **目标**\n\n外部\n', '- [x] **目标**\n\n外部\n', '> **目标**\n\n外部\n'];
  for (const source of sources) {
    for (const format of ['p', 'h2', 'ul', 'ol', 'todo', 'blockquote']) {
      const doc = document(source);
      doc.document.connect(() => doc.document.capture());
      const previous = blockConversionState(doc.editor, [0]).current;
      doc.editor.tf.select(doc.editor.api.start([1])!);
      const neighbor = JSON.stringify(doc.editor.children[1]);
      assert.equal(convertBlock(doc.editor, [0], format), previous !== format);
      assert.equal(blockConversionState(doc.editor, [0]).current, format);
      assert.equal(JSON.stringify(doc.editor.children[1]), neighbor);
      assert.match(doc.serialize(), /\*\*目标\*\*/);
      doc.document.capture();
      if (previous !== format) {
        doc.document.switchMode('source');
        doc.document.undo();
      }
      assert.equal(doc.document.text(), source);
    }
  }
});

test('multi-paragraph quote becomes a list without quote wrappers or toggling existing list items off', () => {
  const doc = document('> 第一段\n>\n> - 第二段\n');
  assert.equal(convertBlock(doc.editor, [0], 'ul'), true);
  assert.equal(doc.editor.children[0].listStyleType, 'disc');
  assert.equal(doc.editor.children[1].listStyleType, 'disc');
  assert.doesNotMatch(doc.serialize(), /^>/m);
  assert.equal(doc.editor.history.undos.length, 1);
  const before = doc.serialize();
  assert.equal(convertBlock(doc.editor, [0], 'ul'), false);
  assert.equal(doc.serialize(), before);
});

test('targeted formats ignore existing cross-block selection, preserve marks, and undo once', () => {
  for (const format of ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const original = '## **目标** [链接](https://example.com)\n\n其他正文\n';
    const doc = document(original);
    doc.editor.tf.select(doc.editor.api.range([])!);
    const before = JSON.stringify(doc.editor.children[1]);
    assert.equal(convertBlock(doc.editor, [0], format), format !== 'h2');
    assert.equal(doc.editor.children[0].type, format);
    assert.equal(JSON.stringify(doc.editor.children[1]), before);
    assert.match(doc.serialize(), /\*\*目标\*\* \[链接\]/);
    assert.equal(doc.editor.history.undos.length, format === 'h2' ? 0 : 1);
    if (format !== 'h2') doc.editor.tf.undo();
    assert.equal(doc.serialize(), original);
  }
});

test('list conversion removes only the clicked item marker and keeps descendants and siblings', () => {
  const doc = document('- 父项\n  - 子项\n- 同级\n');
  doc.document.connect(() => doc.document.capture());
  doc.editor.tf.select(doc.editor.api.start([2])!);
  assert.equal(convertBlock(doc.editor, [0], 'h3'), true);
  assert.equal(doc.editor.children[0].listStyleType, undefined);
  assert.equal(doc.editor.children[1].listStyleType, 'disc');
  assert.equal(doc.editor.children[2].listStyleType, 'disc');
  assert.match(doc.serialize(), /子项/);
  doc.document.capture();
  doc.document.undo();
  assert.equal(doc.document.text(), '- 父项\n  - 子项\n- 同级\n');
});

test('whole quote conversion preserves paragraph boundaries and is one undo', () => {
  const original = '> **第一段**\n>\n> 第二段\n\n外部正文\n';
  const doc = document(original);
  assert.equal(convertBlock(doc.editor, [0], 'h2'), true);
  assert.deepEqual(doc.editor.children.map(node => node.type), ['h2', 'h2', 'p']);
  assert.match(doc.serialize(), /## \*\*第一段\*\*[\s\S]*## 第二段/);
  assert.equal(doc.editor.history.undos.length, 1);
  doc.editor.tf.undo();
  assert.equal(doc.serialize(), original);
});

test('unsupported blocks and complex quotes are not convertible', () => {
  for (const source of ['```js\ncode\n```\n', '---\n', '<Component />\n', '> ```js\n> code\n> ```\n', '| a | b |\n| - | - |\n| c | d |\n']) {
    const doc = document(source);
    const before = doc.serialize();
    assert.equal(blockConversionState(doc.editor, [0]).enabled, false, source);
    assert.equal(convertBlock(doc.editor, [0], 'p'), false);
    assert.equal(doc.serialize(), before);
  }
});

test('nested plain quotes lose all quote wrappers while preserving each paragraph', () => {
  const doc = document('> 外层\n>\n>> 内层\n');
  convertBlock(doc.editor, [0], 'h2');
  assert.equal(doc.editor.children[0].type, 'h2');
  assert.equal(doc.editor.children[1].type, 'h2');
  assert.doesNotMatch(doc.serialize(), /^>/m);
  assert.equal(doc.editor.history.undos.length, 1);
});

test('target refs follow moves and become invalid on removal, never selecting replacement blocks', () => {
  const doc = document('第一段\n\n第二段\n');
  const target = doc.editor.api.pathRef([0]);
  doc.editor.tf.moveNodes({ at: [0], to: [1] });
  assert.deepEqual(target.current, [1]);
  convertBlock(doc.editor, target.current!, 'h1');
  assert.equal(doc.editor.children[0].type, 'p');
  doc.editor.tf.removeNodes({ at: [1] });
  assert.equal(target.current, null);
  target.unref();
});

test('conversion participates in cross-mode undo without rewriting adjacent raw content', () => {
  const original = '正文\n\n<Custom untouched="yes" />\n';
  const doc = document(original);
  doc.document.connect(() => doc.document.capture());
  convertBlock(doc.editor, [0], 'h1');
  doc.document.capture();
  doc.document.switchMode('source');
  assert.equal(doc.document.text(), '# 正文\n\n<Custom untouched="yes" />\n');
  doc.document.undo();
  assert.equal(doc.document.text(), original);
  doc.document.redo();
  assert.match(doc.document.text(), /^# 正文/);
});
