'use client';

import {
  BoldPlugin,
  CodePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from '@platejs/basic-nodes/react';
import { LinkRules } from '@platejs/link';
import { LinkPlugin } from '@platejs/link/react';
import {
  basicMarkdownMarks,
  defaultRules,
  MarkdownPlugin,
} from '@platejs/markdown';
import { ImagePlugin } from '@platejs/media/react';
import { SlashInputPlugin, SlashPlugin } from '@platejs/slash-command/react';
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from '@platejs/table/react';
import { KEYS, TrailingBlockPlugin } from 'platejs';
import {
  createPlateEditor,
  createPlatePlugin,
  PlateElement,
  type PlateElementProps,
} from 'platejs/react';
import { useContext } from 'react';
import remarkGfm from 'remark-gfm';
import { createBasicBlocksKit } from '@/components/plate/plugins/basic-blocks-kit';
import { createCodeBlockKit } from '@/components/plate/plugins/code-block-kit';
import { ExitBreakKit } from '@/components/plate/plugins/exit-break-kit';
import { createListKit } from '@/components/plate/plugins/list-kit';
import { CodeLeaf } from '@/components/ui/code-node';
import { imageSource } from '@/features/workspace/shared/markdown';
import type {
  FileSnapshot,
  Workspace,
} from '@/features/workspace/shared/types';
import { useT } from '@/features/workspace/ui/interface-provider';
import { RAW_BLOCK } from '../shared/raw';
import type { HistoryBudget } from '../state/history-budget';
import { WritingBlock } from '../writing/writing-block';
import { WritingContext } from '../writing/writing-context';
import { WorkspaceCodeBlock } from './code-node';
import { DocumentContext } from './document-context';
import { DocumentModel } from './document-model';
import { DocumentSource } from './document-source';
import { WorkspaceLink } from './link-node';
import {
  WorkspaceMarkdownInputPlugin,
  workspaceBlockRules,
  workspaceInlineRule,
  workspaceInputRule,
} from './markdown-input';
import { RawBlockPlugin } from './raw-node';
import { WorkspaceSlash } from './slash-menu';
import {
  WorkspaceCell,
  WorkspaceHeader,
  WorkspaceRow,
  WorkspaceTable,
} from './table-node';

function WorkspaceImage(props: PlateElementProps) {
  const t = useT();
  const document = useContext(DocumentContext);
  const writing = useContext(WritingContext);
  const source = imageSource(
    document.workspaceId,
    document.path,
    String(props.element.url ?? ''),
    document.settings
  );
  return (
    <PlateElement {...props} className="my-6">
      <div className="group/image" contentEditable={false}>
        {source ? (
          <button
            aria-label={t('放大查看图片')}
            className="block max-w-full"
            onClick={() =>
              writing.preview(
                source,
                Array.isArray(props.element.caption)
                  ? props.element.caption
                      .map((child: any) => child.text ?? '')
                      .join('')
                  : String(props.element.alt ?? t('图片'))
              )
            }
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            <img
              alt={
                Array.isArray(props.element.caption)
                  ? props.element.caption
                      .map((child: any) => child.text ?? '')
                      .join('')
                  : String(props.element.alt ?? '')
              }
              className="max-h-[520px] max-w-full rounded-md object-contain"
              src={source}
            />
          </button>
        ) : (
          <div className="rounded border border-dashed p-4 text-sm text-stone-500">
            {t('图片路径超出工作区或格式不受支持')}
          </div>
        )}
        <input
          aria-label={t('编辑图片替代文字')}
          className="mt-2 block w-full border-0 bg-transparent text-center text-stone-500 text-xs opacity-0 outline-none focus:opacity-100 group-hover/image:opacity-100"
          onChange={(event) => {
            const at = props.editor.api.findPath(props.element);
            if (at)
              props.editor.tf.setNodes(
                { caption: [{ text: event.target.value }] },
                { at }
              );
          }}
          placeholder={t('添加图片说明…')}
          value={
            Array.isArray(props.element.caption)
              ? props.element.caption
                  .map((child: any) => child.text ?? '')
                  .join('')
              : String(props.element.alt ?? '')
          }
        />
      </div>
      {props.children}
    </PlateElement>
  );
}

const withWorkspaceBlockRules = (plugin: any, config: any) =>
  plugin.configure({
    ...config,
    ...(plugin.key === KEYS.codeBlock
      ? { node: { ...config.node, component: WorkspaceCodeBlock } }
      : {}),
    inputRules: workspaceBlockRules(plugin.key),
  });

export const WorkspaceKit = [
  createPlatePlugin({
    key: 'workspaceWriting',
    render: { aboveNodes: WritingBlock },
  }),
  ...createBasicBlocksKit(withWorkspaceBlockRules),
  ...createCodeBlockKit(withWorkspaceBlockRules),
  ...createListKit(withWorkspaceBlockRules),
  LinkPlugin.configure({
    inputRules: [
      workspaceInlineRule,
      workspaceInputRule(LinkRules.autolink({ variant: 'space' })),
      workspaceInputRule(LinkRules.autolink({ variant: 'break' })),
    ],
    node: { component: WorkspaceLink },
  }),
  SlashPlugin.configure({
    options: {
      triggerQuery: (editor) =>
        !editor.api.isComposing() &&
        !editor.api.some({
          match: { type: [KEYS.codeBlock, KEYS.table, RAW_BLOCK] },
        }),
    },
  }),
  SlashInputPlugin.withComponent(WorkspaceSlash),
  ...ExitBreakKit,
  BoldPlugin,
  ItalicPlugin,
  CodePlugin.withComponent(CodeLeaf),
  StrikethroughPlugin,
  ImagePlugin.withComponent(WorkspaceImage),
  TablePlugin.configure({
    node: { component: WorkspaceTable },
    options: { disableMerge: true },
  }),
  TableRowPlugin.withComponent(WorkspaceRow),
  TableCellPlugin.withComponent(WorkspaceCell),
  TableCellHeaderPlugin.withComponent(WorkspaceHeader),
  MarkdownPlugin.configure({
    options: {
      // External rich text can carry marks whose default serializers emit MDX.
      // Keep their text, but persist only formatting supported by plain Markdown.
      plainMarks: Object.entries(defaultRules)
        .filter(([key, rule]) => rule.mark && !basicMarkdownMarks.includes(key))
        .map(([key]) => key),
      remarkStringifyOptions: { emphasis: '*' },
      remarkPlugins: [remarkGfm],
    },
  }),
  TrailingBlockPlugin,
  WorkspaceMarkdownInputPlugin,
  RawBlockPlugin,
];

export function createDocumentEditor(
  file: FileSnapshot,
  _workspace: Workspace,
  history?: HistoryBudget
) {
  const editor = createPlateEditor({
    id: crypto.randomUUID(),
    plugins: WorkspaceKit,
  });
  // Workspace format bindings are owned by the configurable dispatcher.
  for (const name of Object.keys(editor.meta.shortcuts)) {
    if (!name.startsWith('exitBreak.')) delete editor.meta.shortcuts[name];
  }
  const source = new DocumentSource(editor);
  source.load(file.content);
  const document = new DocumentModel(editor, source, file.content, history);
  return {
    editor,
    document,
    readOnlyReason: undefined,
    serialize: document.text,
  };
}

export type WorkspaceEditor = ReturnType<typeof createDocumentEditor>['editor'];
