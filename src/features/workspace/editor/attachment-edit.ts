import type { PlateEditor } from 'platejs/react';
import { insertWorkspaceBlock } from './commands';

export function insertAttachmentLink(
  editor: PlateEditor,
  url: string,
  name: string
) {
  editor.tf.withNewBatch(() => {
    insertWorkspaceBlock(editor, {
      type: 'p',
      children: [
        { text: '' },
        { type: 'a', url, children: [{ text: name }] },
        { text: '' },
      ],
    });
  });
}
