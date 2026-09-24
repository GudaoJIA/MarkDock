'use client';

import { toggleCodeBlock } from '@platejs/code-block';
import { toggleList } from '@platejs/list';
import { TablePlugin } from '@platejs/table/react';
import {
  Code2Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MinusIcon,
  PaperclipIcon,
  PilcrowIcon,
  QuoteIcon,
  TableIcon,
} from 'lucide-react';
import { KEYS, NodeApi, RangeApi, type TElement } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { createContext } from 'react';
import { RAW_BLOCK, touchesRaw } from '../shared/raw';

export const EditingContext = createContext({
  image: () => {},
  attachment: () => {},
  link: () => {},
  composing: false,
});
export const blockCommands = [
  {
    id: 'p',
    label: '正文',
    keywords: ['text', 'paragraph'],
    icon: PilcrowIcon,
  },
  {
    id: 'h1',
    label: '一级标题',
    keywords: ['h1', 'heading', '标题'],
    icon: Heading1Icon,
  },
  {
    id: 'h2',
    label: '二级标题',
    keywords: ['h2', 'heading', '标题'],
    icon: Heading2Icon,
  },
  {
    id: 'h3',
    label: '三级标题',
    keywords: ['h3', 'heading', '标题'],
    icon: Heading3Icon,
  },
  {
    id: 'ul',
    label: '无序列表',
    keywords: ['ul', 'bullet', 'list'],
    icon: ListIcon,
  },
  {
    id: 'ol',
    label: '有序列表',
    keywords: ['ol', 'number', 'list'],
    icon: ListOrderedIcon,
  },
  {
    id: 'todo',
    label: '待办列表',
    keywords: ['todo', 'task', 'check'],
    icon: ListTodoIcon,
  },
  { id: 'blockquote', label: '引用', keywords: ['quote'], icon: QuoteIcon },
  { id: 'code_block', label: '代码块', keywords: ['code'], icon: Code2Icon },
  { id: 'table', label: '表格', keywords: ['table'], icon: TableIcon },
  { id: 'hr', label: '分隔线', keywords: ['line', 'divider'], icon: MinusIcon },
  {
    id: 'img',
    label: '图片',
    keywords: ['image', 'img', 'photo'],
    icon: ImageIcon,
  },
  {
    id: 'attachment',
    label: '附件',
    keywords: ['file', 'attachment', '附件'],
    icon: PaperclipIcon,
  },
];

export function hasTextSelection(editor: PlateEditor) {
  return (
    !!editor.selection &&
    RangeApi.isExpanded(editor.selection) &&
    !!editor.api.string(editor.selection).trim()
  );
}

export const paragraphFormats = [
  { id: 'p', label: '正文' },
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `h${index + 1}`,
    label: `${['一', '二', '三', '四', '五', '六'][index]}级标题`,
  })),
];

const listFormats = { ul: 'disc', ol: 'decimal', todo: 'todo' } as const;
const paragraphTypes = new Set(paragraphFormats.map(({ id }) => id));

function selectedParagraphs(editor: PlateEditor) {
  if (!editor.selection) return [];
  return [
    ...editor.api.nodes<TElement>({
      at: editor.selection,
      match: (node) => paragraphTypes.has(String(node.type)),
      mode: 'lowest',
    }),
  ];
}

export function blockFormatState(editor: PlateEditor) {
  const entries = selectedParagraphs(editor);
  const restricted =
    !editor.selection ||
    editor.api.some({
      at: editor.selection,
      match: { type: [KEYS.table, KEYS.codeBlock, RAW_BLOCK] },
    });
  const types = new Set(entries.map(([node]) => node.type));
  const lists = new Set(entries.map(([node]) => node.listStyleType ?? ''));
  return {
    enabled: !restricted && entries.length > 0,
    type: types.size === 1 ? String([...types][0]) : 'mixed',
    list: lists.size === 1 ? String([...lists][0]) : 'mixed',
    inList:
      entries.length > 0 && entries.every(([node]) => !!node.listStyleType),
  };
}

/** Toolbar conversions act on existing paragraphs; slash/Add keeps its insertion behavior. */
export function changeBlockFormat(
  editor: PlateEditor,
  id: string,
  { toggleList = true }: { toggleList?: boolean } = {}
) {
  const state = blockFormatState(editor);
  if (
    !state.enabled ||
    !(paragraphTypes.has(id) || id in listFormats || id === KEYS.blockquote)
  )
    return false;
  const targetList = listFormats[id as keyof typeof listFormats];
  const removeList = toggleList && targetList && state.list === targetList;
  editor.tf.withNewBatch(() =>
    editor.tf.withoutNormalizing(() => {
      if (!targetList || !toggleList)
        editor.tf.unwrapNodes({
          match: { type: KEYS.blockquote },
          mode: 'all',
          split: true,
        });
      for (const [node, path] of selectedParagraphs(editor)) {
        editor.tf.setNodes(
          { type: targetList || id === KEYS.blockquote ? KEYS.p : id },
          { at: path }
        );
        if (targetList && !removeList) {
          editor.tf.setNodes(
            { listStyleType: targetList, indent: Number(node.indent || 1) },
            { at: path }
          );
          if (targetList === 'todo')
            editor.tf.setNodes(
              { checked: node.checked ?? false },
              { at: path }
            );
          else
            editor.tf.unsetNodes(['checked', 'listStart', 'listRestart'], {
              at: path,
            });
        } else
          editor.tf.unsetNodes(
            ['listStyleType', 'indent', 'checked', 'listStart', 'listRestart'],
            { at: path }
          );
      }
      if (id === KEYS.blockquote)
        editor.tf.wrapNodes(
          { type: KEYS.blockquote, children: [] },
          {
            match: (node) => paragraphTypes.has(String(node.type)),
            mode: 'lowest',
          }
        );
    })
  );
  return true;
}

export function changeListLevel(editor: PlateEditor, direction: 1 | -1) {
  const state = blockFormatState(editor);
  if (!state.enabled || !state.inList) return false;
  editor.tf.withNewBatch(() =>
    editor.tf.withoutNormalizing(() => {
      for (const [node, path] of selectedParagraphs(editor)) {
        const indent = Number(node.indent || 1) + direction;
        if (indent < 1)
          editor.tf.unsetNodes(
            ['listStyleType', 'indent', 'checked', 'listStart', 'listRestart'],
            { at: path }
          );
        else editor.tf.setNodes({ indent }, { at: path });
      }
    })
  );
  return true;
}

export function toggleTextFormat(editor: PlateEditor, key: string) {
  if (
    !hasTextSelection(editor) ||
    touchesRaw(editor) ||
    editor.api.some({ match: { type: KEYS.codeBlock } })
  )
    return false;
  editor.tf.withNewBatch(() => editor.tf.toggleMark(key));
  return true;
}

// Inserting structural content never replaces a text selection or splits a container.
export function insertWorkspaceBlock(editor: PlateEditor, node: TElement) {
  const index = editor.selection
    ? RangeApi.end(editor.selection).path[0]
    : editor.children.length - 1;
  const current = editor.children[index];
  const reuse =
    !hasTextSelection(editor) &&
    current?.type === KEYS.p &&
    !current.listStyleType &&
    current.children.every((child) => 'text' in child) &&
    NodeApi.string(current) === '';
  let after = index + 1;
  if (current?.listStyleType) {
    while (
      editor.children[after]?.listStyleType &&
      Number(editor.children[after].indent ?? 0) > Number(current.indent ?? 0)
    )
      after++;
  }
  const at = [reuse ? index : after];
  editor.tf.withoutNormalizing(() => {
    if (reuse) editor.tf.removeNodes({ at: [index] });
    editor.tf.insertNodes(node, { at, select: true });
  });
  return at;
}

export function commandEnabled(editor: PlateEditor, id: string) {
  if (!blockCommands.some((command) => command.id === id)) return false;
  if (
    !hasTextSelection(editor) ||
    ['img', 'attachment', 'table', 'hr'].includes(id)
  )
    return true;
  if (editor.api.some({ match: { type: KEYS.codeBlock } }))
    return ['p', 'h1', 'h2', 'h3', 'code_block', 'img', 'attachment'].includes(
      id
    );
  return (
    !editor.api.some({ match: { type: KEYS.table } }) ||
    ['p', 'img', 'attachment'].includes(id)
  );
}

export function runCommand(
  editor: PlateEditor,
  id: string,
  image: () => void,
  attachment: () => void = () => {},
  options: { insert?: boolean; tableSize?: TableSize } = {}
) {
  if (touchesRaw(editor)) return;
  if (
    options.insert
      ? !blockCommands.some((command) => command.id === id)
      : !commandEnabled(editor, id)
  )
    return;
  if (id === 'table' && options.tableSize && !validTableSize(options.tableSize))
    return;
  if (id === 'attachment') {
    attachment();
    return;
  }
  if (id === 'img') {
    image();
    return;
  }
  editor.tf.withNewBatch(() => {
    if (['table', 'hr'].includes(id)) {
      const node =
        id === 'table'
          ? editor.getApi(TablePlugin).create.table({
              rowCount: 3,
              colCount: 3,
              ...options.tableSize,
              header: true,
            })
          : { type: KEYS.hr, children: [{ text: '' }] };
      const at = insertWorkspaceBlock(editor, node);
      if (id === 'table') editor.tf.select(editor.api.start(at)!);
      return;
    }
    if (options.insert || !hasTextSelection(editor))
      insertWorkspaceBlock(editor, { type: KEYS.p, children: [{ text: '' }] });
    if (['ul', 'ol', 'todo'].includes(id)) {
      toggleList(editor, { listStyleType: id === 'todo' ? KEYS.listTodo : id });
    } else if (id === 'code_block') toggleCodeBlock(editor);
    else if (id === 'blockquote')
      editor.tf.toggleBlock(KEYS.blockquote, { wrap: true });
    else {
      if (editor.api.some({ match: { type: KEYS.codeBlock } }))
        toggleCodeBlock(editor);
      editor.tf.unwrapNodes({ match: { type: KEYS.blockquote }, split: true });
      editor.tf.setNodes(
        { type: id },
        { match: (node) => editor.api.isBlock(node), mode: 'lowest' }
      );
      editor.tf.unsetNodes(['listStyleType', 'indent', 'checked'], {
        match: (node) => editor.api.isBlock(node),
        mode: 'lowest',
      });
    }
  });
  const selection = editor.selection
    ? structuredClone(editor.selection)
    : undefined;
  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(() => editor.tf.focus({ at: selection }));
  else editor.tf.focus();
}

export type TableSize = { rowCount: number; colCount: number };

export function validTableSize({ rowCount, colCount }: TableSize) {
  return (
    Number.isInteger(rowCount) &&
    rowCount >= 1 &&
    rowCount <= 100 &&
    Number.isInteger(colCount) &&
    colCount >= 1 &&
    colCount <= 20
  );
}
