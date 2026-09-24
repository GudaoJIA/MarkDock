import { NodeApi, type TComboboxInputElement } from 'platejs';
import type { PlateEditor } from 'platejs/react';

export function updateSlashQuery(
  editor: PlateEditor,
  element: TComboboxInputElement,
  query: string
) {
  // An explicit options object bypasses Slate's potentially stale DOM path cache.
  const at = editor.api.findPath(element, {});
  if (at && NodeApi.get(editor, at) === element && element.query !== query)
    editor.tf.setNodes({ query }, { at });
}
