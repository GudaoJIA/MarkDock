import { upsertLink } from '@platejs/link';
import { KEYS, NodeApi, type Path, type TRange } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { linkAddress } from '../shared/link-address';
import { touchesRaw } from '../shared/raw';

/** Caller supplies a live RangeRef/PathRef; no fallback insertion at document end. */
export function editWorkspaceLink(
  editor: PlateEditor,
  selection: TRange | null | undefined,
  input: string,
  label: string,
  target?: Path | null
) {
  const url = linkAddress(input, true);
  if (!url) return '链接地址无效，请检查后重试。';
  if (!selection || target === null)
    return '链接目标已失效，请重新选择文字或链接。';
  try {
    if (target && NodeApi.get(editor, target)?.type !== KEYS.link)
      return '链接目标已失效，请重新选择文字或链接。';
    editor.tf.select(target ? editor.api.range(target)! : selection);
    // Validate both endpoints before an edit; a stale selection must not mutate another node.
    for (const point of [editor.selection!.anchor, editor.selection!.focus]) {
      const node = NodeApi.get(editor, point.path);
      if (!node || !('text' in node) || point.offset > String(node.text).length)
        return '链接目标已失效，请重新选择文字或链接。';
    }
  } catch {
    return '链接目标已失效，请重新选择文字或链接。';
  }
  if (
    touchesRaw(editor) ||
    editor.api.some({ match: { type: KEYS.codeBlock } })
  )
    return '链接目标已失效，请重新选择文字或链接。';
  let success = false;
  editor.tf.withNewBatch(() => {
    success = !!upsertLink(editor, {
      url,
      text: label || undefined,
      skipValidation: true,
    });
  });
  return success ? '' : '链接目标已失效，请重新选择文字或链接。';
}
