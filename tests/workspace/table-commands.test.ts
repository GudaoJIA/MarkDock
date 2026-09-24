import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeApi } from 'platejs';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import { runCommand } from '../../src/features/workspace/editor/commands';
import {
  runTableAction,
  selectedTableCell,
} from '../../src/features/workspace/editor/table-commands';
const document = (content = '') =>
  createDocumentEditor(
    { path: 'test.md', content, version: '1' },
    { id: 'test', root: '/test', name: 'test' }
  );

test('custom tables retain dimensions after reopening, select first cell and undo as one operation', () => {
  for (const [rowCount, colCount] of [
    [1, 1],
    [4, 7],
    [100, 20],
  ]) {
    const doc = document('保留正文\n');
    doc.editor.tf.select(doc.editor.api.range([0])!);
    runCommand(doc.editor, 'table', () => {}, undefined, {
      tableSize: { rowCount, colCount },
    });
    doc.editor.tf.insertText('第一格');
    const saved = doc.serialize();
    const reopened = document(saved);
    assert.equal(reopened.readOnlyReason, undefined);
    const table = reopened.editor.children[1];
    assert.equal(table.children.length, rowCount);
    assert.ok(
      table.children.every((row: any) => row.children.length === colCount)
    );
    assert.equal(NodeApi.string(table), '第一格');
    doc.editor.tf.undo();
    doc.editor.tf.undo();
    assert.equal(doc.serialize(), '保留正文\n');
  }
});

test('table operations normalize headers, retain content and restore adjacent cursor with undo/redo', () => {
  const expected = {
    'row-before': [
      ['', ''],
      ['H', 'Q'],
      ['A', 'B'],
    ],
    'row-after': [
      ['H', 'Q'],
      ['', ''],
      ['A', 'B'],
    ],
    'column-before': [
      ['', 'H', 'Q'],
      ['', 'A', 'B'],
    ],
    'column-after': [
      ['H', '', 'Q'],
      ['A', '', 'B'],
    ],
    'delete-row': [['A', 'B']],
    'delete-column': [['Q'], ['B']],
    'delete-table': undefined,
  };
  for (const action of [
    'row-before',
    'row-after',
    'column-before',
    'column-after',
    'delete-row',
    'delete-column',
    'delete-table',
  ] as const) {
    const doc = document('| H | Q |\n| - | - |\n| A | B |\n\n后文\n');
    const before = doc.serialize();
    doc.editor.tf.select(doc.editor.api.start([0, 0, 0])!);
    assert.ok(selectedTableCell(doc.editor));
    runTableAction(doc.editor, action);
    const saved = doc.serialize();
    assert.equal(document(saved).readOnlyReason, undefined, action);
    const table: any = doc.editor.children.find((n) => n.type === 'table');
    assert.deepEqual(
      table?.children.map((row: any) =>
        row.children.map((cell: any) => NodeApi.string(cell))
      ),
      expected[action],
      action
    );
    if (table)
      table.children.forEach((row: any, r: number) =>
        row.children.forEach((cell: any) =>
          assert.equal(cell.type, r === 0 ? 'th' : 'td')
        )
      );
    assert.ok(doc.editor.selection);
    doc.editor.tf.undo();
    assert.equal(doc.serialize(), before, action);
    doc.editor.tf.redo();
    assert.equal(doc.serialize(), saved, action);
  }
});

test('invalid table dimensions cannot change the document or history', () => {
  const doc = document('原文\n');
  doc.editor.tf.select(doc.editor.api.start([0])!);
  for (const [rowCount, colCount] of [
    [0, 3],
    [101, 3],
    [3, 0],
    [3, 21],
    [1.5, 2],
    [2, Number.NaN],
  ]) {
    runCommand(doc.editor, 'table', () => {}, undefined, {
      tableSize: { rowCount, colCount },
    });
    assert.equal(doc.serialize(), '原文\n');
    assert.equal(doc.editor.history.undos.length, 0);
  }
});

test('last row or column removal deletes table and leaves a writable paragraph', () => {
  for (const action of ['delete-row', 'delete-column'] as const) {
    const doc = document('| H |\n| - |\n');
    doc.editor.tf.select(doc.editor.api.start([0, 0, 0])!);
    runTableAction(doc.editor, action);
    assert.equal(
      doc.editor.children.some((n) => n.type === 'table'),
      false
    );
    doc.editor.tf.insertText('继续写作');
    assert.equal(doc.serialize(), '继续写作\n');
  }
});

test('explicit cell target controls action and cross-cell selections cannot modify structure', () => {
  const doc = document('| H | Q |\n| - | - |\n| A | B |\n| C | D |\n');
  doc.editor.tf.select(doc.editor.api.start([0, 0, 0])!);
  runTableAction(doc.editor, 'delete-row', [0, 2, 0]);
  assert.doesNotMatch(doc.serialize(), /C|D/);
  assert.match(doc.serialize(), /A/);
  doc.editor.tf.select({
    anchor: doc.editor.api.start([0, 0, 0])!,
    focus: doc.editor.api.end([0, 1, 1])!,
  });
  assert.equal(selectedTableCell(doc.editor), undefined);
  const before = doc.serialize();
  assert.equal(runTableAction(doc.editor, 'delete-column'), false);
  assert.equal(doc.serialize(), before);
});
