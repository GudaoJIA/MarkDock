import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeApi } from 'platejs';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import {
  blockFormatState,
  changeBlockFormat,
  changeListLevel,
  runCommand,
} from '../../src/features/workspace/editor/commands';

const document = (content: string) =>
  createDocumentEditor(
    { path: 'test.md', content, version: '1' },
    { id: 'test', root: '/test', name: 'test' }
  );

test('toolbar transforms the current paragraph, retaining text and inline formatting with one undo', () => {
  const doc = document('前 **粗体** [链接](https://example.com)\n');
  const before = doc.serialize();
  doc.editor.tf.select(doc.editor.api.start([0])!);
  assert.equal(changeBlockFormat(doc.editor, 'h6'), true);
  assert.equal(doc.editor.children[0].type, 'h6');
  assert.equal(doc.serialize(), `###### ${before}`);
  assert.equal(blockFormatState(doc.editor).type, 'h6');
  doc.editor.tf.undo();
  assert.equal(doc.serialize(), before);
  doc.editor.tf.redo();
  assert.equal(document(doc.serialize()).readOnlyReason, undefined);
});

test('mixed paragraphs transform together and restricted mixed selections change nothing', () => {
  const doc = document('# 标题\n\n正文\n');
  doc.editor.tf.select({
    anchor: doc.editor.api.start([0])!,
    focus: doc.editor.api.end([1])!,
  });
  assert.equal(blockFormatState(doc.editor).type, 'mixed');
  changeBlockFormat(doc.editor, 'h2');
  assert.equal(doc.serialize(), '## 标题\n\n## 正文\n');
  for (const content of [
    '正文\n\n| H |\n| - |\n| 值 |\n',
    '正文\n\n```js\ncode\n```\n',
  ]) {
    const restricted = document(content);
    const before = restricted.serialize();
    restricted.editor.tf.select({
      anchor: restricted.editor.api.start([0])!,
      focus: restricted.editor.api.end([1])!,
    });
    assert.equal(blockFormatState(restricted.editor).enabled, false);
    assert.equal(changeBlockFormat(restricted.editor, 'ul'), false);
    assert.equal(changeBlockFormat(restricted.editor, 'h1'), false);
    assert.equal(restricted.serialize(), before);
  }
});

test('list toolbar toggles current items and adjusts nesting without inserting content', () => {
  const doc = document('第一\n\n第二\n');
  doc.editor.tf.select({
    anchor: doc.editor.api.start([0])!,
    focus: doc.editor.api.end([1])!,
  });
  changeBlockFormat(doc.editor, 'todo');
  assert.match(doc.serialize(), /\* \[ \] 第一\n\* \[ \] 第二/);
  changeBlockFormat(doc.editor, 'todo');
  assert.equal(doc.serialize(), '第一\n\n第二\n');
  changeBlockFormat(doc.editor, 'ul');
  doc.editor.tf.select(doc.editor.api.start([1])!);
  changeListLevel(doc.editor, 1);
  assert.equal(doc.editor.children[1].indent, 2);
  assert.equal(NodeApi.string(doc.editor.children[1]), '第二');
  changeListLevel(doc.editor, -1);
  assert.equal(doc.editor.children[1].indent, 1);
  assert.equal(document(doc.serialize()).readOnlyReason, undefined);
});

test('Insert menu preserves selected content even inside a restricted structure', () => {
  for (const source of [
    '选中 **正文**\n',
    '```js\ncode\n```\n',
    '| H |\n| - |\n| 内容 |\n',
  ]) {
    for (const command of ['blockquote', 'code_block', 'hr']) {
      const doc = document(source);
      const original = structuredClone(doc.editor.children[0]);
      const before = doc.serialize();
      doc.editor.tf.select(doc.editor.api.range([0])!);
      runCommand(doc.editor, command, () => {}, undefined, { insert: true });
      assert.deepEqual(doc.editor.children[0], original);
      doc.editor.tf.undo();
      assert.equal(doc.serialize(), before);
    }
  }
});
