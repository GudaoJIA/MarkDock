'use client';
import { NodeApi } from 'platejs';
import {
  createPlatePlugin,
  PlateElement,
  type PlateElementProps,
} from 'platejs/react';
import { RAW_BLOCK, touchesRaw } from '../shared/raw';

function RawElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="pre"
      className="ws-raw-block my-3 whitespace-pre-wrap break-words rounded bg-stone-50 p-3 font-mono text-sm leading-6"
      data-raw-block
    >
      {props.children}
    </PlateElement>
  );
}

export const RawBlockPlugin = createPlatePlugin({
  key: RAW_BLOCK,
  node: { isElement: true, component: RawElement },
}).overrideEditor(
  ({
    editor,
    tf: { insertBreak, insertData, addMark, apply, normalizeNode },
  }) => ({
    transforms: {
      apply(operation) {
        if (operation.type === 'merge_node' && operation.path.length === 1) {
          const index = operation.path[0];
          const left = editor.children[index - 1];
          const right = editor.children[index];
          if (
            left &&
            right &&
            (left.type === RAW_BLOCK || right.type === RAW_BLOCK)
          )
            editor.tf.setNodes(
              { type: RAW_BLOCK, sourceId: right.sourceId },
              { at: [index - 1] }
            );
        }
        apply(operation);
      },
      normalizeNode(entry, options) {
        const [node, path] = entry;
        if (
          node.type === RAW_BLOCK &&
          Array.isArray(node.children) &&
          node.children.some((child) =>
            Object.keys(child).some((key) => !['text', 'id'].includes(key))
          )
        ) {
          editor.tf.replaceNodes(
            { text: NodeApi.string(node) },
            { at: path, children: true }
          );
          return;
        }
        normalizeNode(entry, options);
      },
      insertBreak() {
        if (touchesRaw(editor)) editor.tf.insertText('\n');
        else insertBreak();
      },
      insertData(data) {
        if (touchesRaw(editor))
          editor.tf.insertText(data.getData('text/plain'));
        else insertData(data);
      },
      addMark(key, value) {
        if (!touchesRaw(editor)) addMark(key, value);
      },
    },
  })
);
