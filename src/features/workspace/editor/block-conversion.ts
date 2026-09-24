import { ElementApi, NodeApi, type Path, TextApi, type TNode } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { changeBlockFormat, paragraphFormats } from './commands';

const formats = new Set(paragraphFormats.map(({ id }) => id));
export const blockConversionFormats = [
  ...paragraphFormats,
  { id: 'ul', label: '无序列表' },
  { id: 'ol', label: '有序列表' },
  { id: 'todo', label: '待办列表' },
  { id: 'blockquote', label: '引用' },
];
const targets = new Set(blockConversionFormats.map(({ id }) => id));
const listIds: Record<string, string> = {
  disc: 'ul',
  decimal: 'ol',
  todo: 'todo',
};

/** Only structures whose paragraph boundaries survive the existing command. */
function supported(editor: PlateEditor, node: TNode): boolean {
  if (TextApi.isText(node)) return true;
  if (!ElementApi.isElement(node)) return false;
  if (
    !formats.has(node.type) &&
    node.type !== 'blockquote' &&
    !editor.api.isInline(node)
  )
    return false;
  return (
    !editor.api.isVoid(node) &&
    node.children.every((child) => supported(editor, child))
  );
}

export function blockConversionState(editor: PlateEditor, path: Path) {
  return blockNodeConversionState(editor, NodeApi.get(editor, path));
}

export function blockNodeConversionState(
  editor: PlateEditor,
  node: TNode | undefined
) {
  const enabled =
    ElementApi.isElement(node) &&
    (formats.has(node.type) || node.type === 'blockquote') &&
    supported(editor, node);
  return {
    enabled,
    current:
      enabled && node
        ? node.type === 'blockquote'
          ? 'blockquote'
          : node.listStyleType
            ? (listIds[String(node.listStyleType)] ?? '')
            : String(node.type)
        : '',
  };
}

export function convertBlock(editor: PlateEditor, path: Path, format: string) {
  const state = blockConversionState(editor, path);
  if (!state.enabled || !targets.has(format) || state.current === format)
    return false;
  editor.tf.select(editor.api.range(path)!);
  const start = editor.api.pointRef(editor.api.start(path)!);
  try {
    return changeBlockFormat(editor, format, { toggleList: false });
  } finally {
    const point = start.unref();
    if (point) editor.tf.select(point);
  }
}

export function deleteBlock(editor: PlateEditor, path: Path) {
  if (path.length !== 1 || !NodeApi.get(editor, path)) return false;
  editor.tf.withNewBatch(() =>
    editor.tf.withoutNormalizing(() => {
      editor.tf.removeNodes({ at: path });
      if (!editor.children.length)
        editor.tf.insertNodes(
          { type: 'p', children: [{ text: '' }] },
          { at: [0] }
        );
      let index = editor.children.findIndex(
        (node, i) => i >= path[0] && !editor.api.isVoid(node)
      );
      if (index < 0)
        index = editor.children.findLastIndex(
          (node) => !editor.api.isVoid(node)
        );
      if (index < 0) {
        index = editor.children.length;
        editor.tf.insertNodes(
          { type: 'p', children: [{ text: '' }] },
          { at: [index] }
        );
      }
      editor.tf.select(editor.api.start([index])!);
    })
  );
  return true;
}
