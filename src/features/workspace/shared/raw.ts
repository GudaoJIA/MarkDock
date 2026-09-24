import type { SlateEditor } from 'platejs';

export const RAW_BLOCK = 'workspace_raw';

export function touchesRaw(editor: SlateEditor) {
  return (
    !!editor.selection &&
    editor.api.some({
      at: editor.selection,
      match: { type: RAW_BLOCK },
    })
  );
}
