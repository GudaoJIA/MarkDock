'use client';

import { KEYS, NodeApi, type Path, PathApi, type TElement } from 'platejs';
import type { PlateEditor } from 'platejs/react';

export const tableActions = [
  { id: 'row-before', label: '上方插入行' },
  { id: 'row-after', label: '下方插入行' },
  { id: 'column-before', label: '左侧插入列' },
  { id: 'column-after', label: '右侧插入列' },
  { id: 'delete-row', label: '删除当前行' },
  { id: 'delete-column', label: '删除当前列' },
  { id: 'delete-table', label: '删除表格' },
] as const;
export type TableAction = (typeof tableActions)[number]['id'];

export function selectedTableCell(editor: PlateEditor): Path | undefined {
  if (!editor.selection) return;
  const cells = [editor.selection.anchor, editor.selection.focus].map((at) =>
    editor.api.above({ at, match: { type: [KEYS.td, KEYS.th] } })
  );
  if (cells[0] && cells[1] && PathApi.equals(cells[0][1], cells[1][1]))
    return cells[0][1];
}

function emptyCell(header = false): TElement {
  return {
    type: header ? KEYS.th : KEYS.td,
    children: [{ type: KEYS.p, children: [{ text: '' }] }],
  };
}

/** All table entry points share these operations, including header and cursor repair. */
export function runTableAction(
  editor: PlateEditor,
  action: TableAction,
  target = selectedTableCell(editor)
) {
  if (!target) return false;
  const cell = NodeApi.get(editor, target);
  const tablePath = target.slice(0, -2);
  const table = NodeApi.get<TElement>(editor, tablePath);
  if (
    !cell ||
    (cell.type !== KEYS.td && cell.type !== KEYS.th) ||
    table?.type !== KEYS.table
  )
    return false;
  const rowIndex = target.at(-2)!;
  const colIndex = target.at(-1)!;
  const rows = table.children as TElement[];
  const rowCount = rows.length;
  const colCount = rows[0].children.length;
  const removeTable =
    action === 'delete-table' ||
    (action === 'delete-row' && rowCount === 1) ||
    (action === 'delete-column' && colCount === 1);
  editor.tf.withNewBatch(() =>
    editor.tf.withoutNormalizing(() => {
      if (removeTable) {
        editor.tf.removeNodes({ at: tablePath });
        if (NodeApi.get(editor, tablePath)?.type !== KEYS.p)
          editor.tf.insertNodes(
            { type: KEYS.p, children: [{ text: '' }] },
            { at: tablePath }
          );
        editor.tf.select(editor.api.start(tablePath)!);
        return;
      }
      let row = rowIndex;
      let col = colIndex;
      if (action === 'row-before' || action === 'row-after') {
        row += action === 'row-after' ? 1 : 0;
        editor.tf.insertNodes(
          {
            type: KEYS.tr,
            children: Array.from({ length: colCount }, () => emptyCell()),
          },
          { at: [...tablePath, row] }
        );
      } else if (action === 'column-before' || action === 'column-after') {
        col += action === 'column-after' ? 1 : 0;
        rows.forEach((_, r) => {
          editor.tf.insertNodes(emptyCell(r === 0), {
            at: [...tablePath, r, col],
          });
        });
      } else if (action === 'delete-row') {
        editor.tf.removeNodes({ at: [...tablePath, row] });
        row = Math.min(row, rowCount - 2);
      } else if (action === 'delete-column') {
        rows.forEach((_, r) => {
          editor.tf.removeNodes({ at: [...tablePath, r, col] });
        });
        col = Math.min(col, colCount - 2);
      }
      const current = NodeApi.get<TElement>(editor, tablePath)!;
      (current.children as TElement[]).forEach((r, ri) => {
        r.children.forEach((_, ci) => {
          editor.tf.setNodes(
            { type: ri === 0 ? KEYS.th : KEYS.td },
            { at: [...tablePath, ri, ci] }
          );
        });
      });
      editor.tf.select(editor.api.start([...tablePath, row, col])!);
    })
  );
  return true;
}
