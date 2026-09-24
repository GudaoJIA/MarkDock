import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import { editorMatches } from '../../src/features/workspace/editor/editor-search';
import { runCommand } from '../../src/features/workspace/editor/commands';
import { TablePlugin } from '@platejs/table/react';
import { NodeApi } from 'platejs';
import { updateSlashQuery } from '../../src/features/workspace/editor/slash-query';
import { insertAttachmentLink } from '../../src/features/workspace/editor/attachment-edit';
import { attachmentTarget } from '../../src/features/workspace/shared/attachments';
const workspace = { id: 'test', name: 'test', root: '/test' };
const document = (content: string) => createDocumentEditor({ path: 'test.md', content, version: '1' }, workspace);

test('opening a document creates no undo action; search ranges span formatting without edits', () => {
  const doc = document('# 标题\n\n你好 **世界**，你好世界。');
  const before = JSON.stringify(doc.editor.children);
  assert.equal(doc.editor.history.undos.length, 0);
  const matches = editorMatches(doc.editor, '你好 世界');
  assert.equal(matches.length, 1);
  assert.notDeepEqual(matches[0].range.anchor.path, matches[0].range.focus.path);
  assert.equal(JSON.stringify(doc.editor.children), before);
  assert.equal(doc.editor.history.undos.length, 0);
});

test('all exposed block commands round-trip through ordinary Markdown and undo cleanly', () => {
  for (const command of ['h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'blockquote', 'code_block', 'hr', 'table']) {
    const doc = document('保留这段文字。\n');
    doc.editor.tf.select(doc.editor.api.start([])!);
    runCommand(doc.editor, command, () => {});
    const serialized = doc.serialize();
    assert.match(serialized, /保留这段文字/, command);
    assert.equal(document(serialized).readOnlyReason, undefined, `${command}: ${serialized}`);
    doc.editor.tf.undo();
    assert.equal(doc.serialize(), '保留这段文字。\n', command);
  }
});

test('slash draft text is serialized literally instead of disappearing', () => {
  const doc = document('');
  doc.editor.tf.insertNodes({ type: 'slash_input', query: '标题', children: [{ text: '' }] }, { at: [0, 0] });
  assert.match(doc.serialize(), /\/标题/);
});

test('late slash updates never write to a removed node or another node at its old path', () => {
  const doc = document('');
  const editor = doc.editor;
  editor.tf.insertNodes({ type: 'slash_input', children: [{ text: '' }] }, { at: [0, 1] });
  const element = NodeApi.get(editor, [0, 1]) as import('platejs').TComboboxInputElement;
  updateSlashQuery(editor, element, '图片');
  assert.match(doc.serialize(), /\/图片/);
  const current = NodeApi.get(editor, [0, 1]) as typeof element;
  editor.tf.removeNodes({ at: [0, 1] });
  // Simulate the stale DOM WeakMap path returned after a menu item removes itself.
  const findPath = editor.api.findPath;
  editor.api.findPath = ((node: typeof element, options?: object) => options ? findPath(node, options) : [0, 1]) as typeof findPath;
  assert.doesNotThrow(() => updateSlashQuery(editor, current, 'img'));
  const before = doc.serialize();
  editor.tf.insertNodes({ type: 'a', url: 'https://example.com', children: [{ text: '保留链接' }] }, { at: [0, 1] });
  updateSlashQuery(editor, current, '迟到');
  assert.equal(NodeApi.get(editor, [0, 1])?.query, undefined);
  assert.ok(doc.serialize().includes('保留链接'));
  assert.equal(before.includes('迟到'), false);
});

test('table row and column edits remain readable after saving', () => {
  const doc = document('| 标题 | 标题 |\n| --- | --- |\n| A | B |\n');
  doc.editor.tf.select(doc.editor.api.start([0, 1, 0])!);
  const table = doc.editor.getTransforms(TablePlugin);
  table.insert.tableRow(); table.insert.tableColumn();
  assert.equal(document(doc.serialize()).readOnlyReason, undefined);
  doc.editor.tf.select(doc.editor.api.start([0, 0, 0])!);
  table.remove.tableRow();
  assert.equal(document(doc.serialize()).readOnlyReason, undefined);
});

test('inserting a table puts subsequent typing in its first cell', () => {
  const doc = document('');
  doc.editor.tf.select(doc.editor.api.start([])!);
  runCommand(doc.editor, 'table', () => {});
  doc.editor.tf.insertText('第一格');
  const table = doc.editor.children.find((node) => node.type === 'table');
  assert.ok(table);
  assert.equal(NodeApi.string(table), '第一格');
});

test('table cells reject block transforms and keep Markdown shortcuts literal', () => {
  for (const command of ['h1', 'ul', 'blockquote', 'code_block']) {
    const doc = document('| H |\n| --- |\n| keep |\n');
    doc.editor.tf.select(doc.editor.api.range([0, 1, 0])!);
    const before = doc.serialize();
    runCommand(doc.editor, command, () => {});
    assert.equal(doc.serialize(), before, command);
  }
  const doc = document('| H |\n| --- |\n|  |\n');
  doc.editor.tf.select(doc.editor.api.start([0,1,0])!);
  doc.editor.tf.insertText('#'); doc.editor.tf.insertText(' '); doc.editor.tf.insertText('literal');
  assert.equal(NodeApi.get(doc.editor, [0, 1, 0, 0])?.type, 'p');
  assert.match(doc.serialize(), /# literal/);
});

test('attachment insertion preserves selected text, uses ordinary Markdown, and undoes in one step', () => {
  const doc = document('保留选中文字\n');
  const before = doc.serialize();
  doc.editor.tf.select(doc.editor.api.range([0])!);
  const name = '中文 #?% [一](1).pdf';
  const url = '附件/' + encodeURIComponent('00000000-0000-0000-0000-000000000001--' + name);
  insertAttachmentLink(doc.editor, url, name);
  const saved = doc.serialize();
  assert.match(saved, /保留选中文字/);
  const reopened = document(saved);
  assert.equal(reopened.readOnlyReason, undefined);
  const link = [...reopened.editor.api.nodes({ at: [], match: { type: 'a' } })][0][0];
  assert.equal(link.url, url);
  assert.equal(attachmentTarget('id', 'test.md', String(link.url))?.name, name);
  doc.editor.tf.undo(); assert.equal(doc.serialize(), before);
  doc.editor.tf.redo(); assert.equal(doc.serialize(), saved);
});

test('Add creates below nonempty content, reuses an empty paragraph, and transforms only with text selection', () => {
  const doc = document('保留 **原文**\n\n后文\n');
  const before = doc.serialize();
  doc.editor.tf.select(doc.editor.api.start([0])!);
  runCommand(doc.editor, 'h2', () => {});
  assert.equal(doc.editor.children[0].type, 'p');
  assert.equal(NodeApi.string(doc.editor.children[0]), '保留 原文');
  assert.equal(doc.editor.children[1].type, 'h2');
  assert.equal(doc.editor.selection!.anchor.path[0], 1);
  doc.editor.tf.insertText('新标题');
  assert.match(doc.serialize(), /## 新标题/);
  doc.editor.tf.undo();
  doc.editor.tf.undo();
  assert.equal(doc.serialize(), before);
  const empty = document('');
  empty.editor.tf.select(empty.editor.api.start([0])!);
  runCommand(empty.editor, 'h1', () => {});
  assert.equal(empty.editor.children[0].type, 'h1');
  const selected = document('修改这段\n');
  selected.editor.tf.select(selected.editor.api.range([0])!);
  runCommand(selected.editor, 'h3', () => {});
  assert.equal(selected.editor.children[0].type, 'h3');
  assert.equal(NodeApi.string(selected.editor.children[0]), '修改这段');
});


test('new structures are added outside tables/code and never replace a selected passage', () => {
  for (const source of ['| H |\n| --- |\n| keep |\n', '```js\nkeep()\n```\n']) {
    for (const id of ['h1', 'ul', 'blockquote', 'code_block', 'table', 'hr']) {
      const doc = document(source);
      const original = structuredClone(doc.editor.children[0]);
      doc.editor.tf.select(doc.editor.api.start([0])!);
      runCommand(doc.editor, id, () => {});
      assert.deepEqual(doc.editor.children[0], original, id);
      assert.ok(doc.editor.children.length > 1);
      assert.equal(document(doc.serialize()).readOnlyReason, undefined);
    }
  }
  for (const id of ['hr', 'table']) {
    const doc = document('前 **保留文字** 后\n');
    const original = structuredClone(doc.editor.children[0]);
    doc.editor.tf.select(doc.editor.api.range([0])!);
    runCommand(doc.editor, id, () => {});
    assert.deepEqual(doc.editor.children[0], original);
    doc.editor.tf.undo();
    assert.equal(doc.editor.children[0].type, 'p');
  }
});

import {hasTextSelection, toggleTextFormat} from '../../src/features/workspace/editor/commands';
test('text formatting requires real selected text and never arms formatting at an empty/collapsed cursor', () => {
  for (const text of ['', '正文', '   ']) {
    const doc = document(text);
    doc.editor.tf.select(doc.editor.api.start([0])!);
    assert.equal(hasTextSelection(doc.editor), false);
    assert.equal(toggleTextFormat(doc.editor, 'bold'), false);
    doc.editor.tf.insertText('后续');
    assert.equal(doc.editor.children[0].children[0].bold, undefined);
  }
  const doc = document('前 **原文** 后');
  doc.editor.tf.select(doc.editor.api.range([0])!);
  const selection = structuredClone(doc.editor.selection);
  assert.equal(hasTextSelection(doc.editor), true);
  assert.equal(toggleTextFormat(doc.editor, 'italic'), true);
  assert.deepEqual(doc.editor.selection, selection);
  const leaves = [...NodeApi.texts(doc.editor.children[0])];
  assert.ok(leaves.every(([leaf]) => leaf.italic));
  doc.editor.tf.undo();
  // Undo restores the original bytes, including the absence of a final newline.
  assert.equal(doc.serialize(), '前 **原文** 后');
});

test('attachments reuse empty paragraphs and new content does not split a nested list', () => {
  const empty = document('');
  empty.editor.tf.select(empty.editor.api.start([0])!);
  insertAttachmentLink(empty.editor, 'a.assets/file/a.txt', 'a.txt');
  assert.equal(NodeApi.string(empty.editor.children[0]), 'a.txt');
  empty.editor.tf.undo();
  assert.equal(NodeApi.string(empty.editor.children[0]), '');
  const list = document('- 父\n  - 子\n\n后文\n');
  list.editor.tf.select(list.editor.api.start([0])!);
  runCommand(list.editor, 'h2', () => {});
  assert.equal(NodeApi.string(list.editor.children[1]), '子');
  assert.equal(list.editor.children[2].type, 'h2');
});
