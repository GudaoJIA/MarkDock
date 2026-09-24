'use client';

import {
  BoldIcon,
  Code2Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListTreeIcon,
  Redo2Icon,
  StrikethroughIcon,
  TextSearchIcon,
  Undo2Icon,
} from 'lucide-react';
import { KEYS } from 'platejs';
import { useEditorRef, useEditorSelector } from 'platejs/react';
import { useContext } from 'react';
import { FloatingToolbar } from '@/components/ui/floating-toolbar';
import { Toolbar, ToolbarButton } from '@/components/ui/toolbar';
import { useInterface, useT } from '@/features/workspace/ui/interface-provider';
import { touchesRaw } from '../shared/raw';
import type { EditableDocument } from '../state/editable-document';
import { useShortcutHint } from '../ui/shortcut-hint';
import { WritingContext } from '../writing/writing-context';
import {
  blockCommands,
  blockFormatState,
  changeBlockFormat,
  EditingContext,
  hasTextSelection,
  runCommand,
  toggleTextFormat,
} from './commands';
import { ModeButton } from './mode-button';
import { WorkspaceTableMenu } from './table-menu';

const textFormats = [
  { key: KEYS.bold, label: '粗体', icon: BoldIcon },
  { key: KEYS.italic, label: '斜体', icon: ItalicIcon },
  { key: KEYS.strikethrough, label: '删除线', icon: StrikethroughIcon },
  { key: KEYS.code, label: '行内代码', icon: Code2Icon },
];

export function WorkspaceToolbar({
  floating = false,
  tableRequest = 0,
  onOutline,
  onReplace,
  outlineOpen,
  document,
  onToggleMode,
}: {
  floating?: boolean;
  tableRequest?: number;
  onOutline?: () => void;
  onReplace?: () => void;
  outlineOpen?: boolean;
  document?: EditableDocument;
  onToggleMode?: () => void;
}) {
  'use no memo';
  const hint = useShortcutHint();
  const { platform } = useInterface();
  const t = useT();
  const editor = useEditorRef();
  const actions = useContext(EditingContext);
  const { locked } = useContext(WritingContext);
  const disabled = locked || actions.composing;
  const state = useEditorSelector(
    (e) => ({
      selected: hasTextSelection(e),
      inCode: e.api.some({ match: { type: KEYS.codeBlock } }) || touchesRaw(e),
      inLink: e.api.some({ match: { type: KEYS.link } }),
      marks: e.api.marks() ?? {},
      canUndo: e.history.undos.length > 0,
      canRedo: e.history.redos.length > 0,
      format: blockFormatState(e),
    }),
    []
  );
  const formatsDisabled = disabled || !state.selected || state.inCode;
  const linkDisabled =
    disabled || state.inCode || !(state.selected || state.inLink);
  const format = (key: string) => {
    if (!formatsDisabled && toggleTextFormat(editor, key)) editor.tf.focus();
  };
  const formatButtons = textFormats.map((item) => (
    <ToolbarButton
      aria-label={t(item.label)}
      aria-pressed={!!state.marks[item.key]}
      disabled={formatsDisabled}
      key={item.key}
      onClick={() => format(item.key)}
      onMouseDown={(e) => e.preventDefault()}
      tooltip={
        (state.selected ? t(item.label) : t('选中文字后{0}', [t(item.label)])) +
        ' ' +
        hint(item.key)
      }
    >
      <item.icon />
    </ToolbarButton>
  ));
  const linkButton = (
    <ToolbarButton
      aria-label={t(state.inLink ? '编辑链接' : '插入链接')}
      disabled={linkDisabled}
      onClick={actions.link}
      onMouseDown={(e) => e.preventDefault()}
      tooltip={`${t(state.inLink ? '编辑链接' : '插入链接')} ${hint('link')}`}
    >
      <LinkIcon />
    </ToolbarButton>
  );
  if (floating)
    return (
      <FloatingToolbar className="ws-popover">
        {formatButtons}
        {linkButton}
      </FloatingToolbar>
    );
  return (
    <Toolbar
      aria-label={t('编辑工具栏')}
      className="ws-toolbar flex w-full min-w-0 items-center gap-1"
    >
      <div className="ws-toolbar-main flex min-w-0 items-center gap-0.5">
        <ToolbarButton
          aria-label={t('撤销')}
          disabled={disabled || !(document ? document.canUndo : state.canUndo)}
          onClick={() => {
            editor.tf.undo();
            editor.tf.focus();
          }}
          onMouseDown={(e) => e.preventDefault()}
          tooltip={`${t('撤销')} ${platform === 'mac' ? '⌘Z' : 'Ctrl+Z'}`}
        >
          <Undo2Icon />
        </ToolbarButton>
        <ToolbarButton
          aria-label={t('重做')}
          disabled={disabled || !(document ? document.canRedo : state.canRedo)}
          onClick={() => {
            editor.tf.redo();
            editor.tf.focus();
          }}
          onMouseDown={(e) => e.preventDefault()}
          tooltip={`${t('重做')} ${platform === 'mac' ? '⌘⇧Z' : 'Ctrl+Shift+Z'}`}
        >
          <Redo2Icon />
        </ToolbarButton>
        <span className="ws-divider" />
        {formatButtons}
        {linkButton}
        <span className="ws-divider" />
        {blockCommands
          .filter((item) => ['ul', 'ol', 'todo'].includes(item.id))
          .map((item) => (
            <ToolbarButton
              aria-label={t(item.label)}
              aria-pressed={
                state.format.list ===
                { ul: 'disc', ol: 'decimal', todo: 'todo' }[item.id]
              }
              disabled={disabled || !state.format.enabled}
              key={item.id}
              onClick={() => {
                changeBlockFormat(editor, item.id);
                editor.tf.focus();
              }}
              onMouseDown={(event) => event.preventDefault()}
              tooltip={`${t(item.label)} ${hint(item.id)}`}
            >
              <item.icon />
            </ToolbarButton>
          ))}
        <span className="ws-divider" />
        {blockCommands
          .filter((item) =>
            ['blockquote', 'code_block', 'hr'].includes(item.id)
          )
          .map((item) => (
            <ToolbarButton
              aria-label={t(item.label)}
              disabled={disabled || touchesRaw(editor)}
              key={item.id}
              onClick={() => {
                runCommand(editor, item.id, actions.image, actions.attachment, {
                  insert: true,
                });
                editor.tf.focus();
              }}
              onMouseDown={(event) => event.preventDefault()}
              tooltip={`${t(item.label)} ${hint(item.id)}`}
            >
              <item.icon />
            </ToolbarButton>
          ))}
        <WorkspaceTableMenu request={tableRequest} />
        <span className="ws-divider" />
        <ToolbarButton
          aria-label={t('插入图片')}
          disabled={disabled || touchesRaw(editor)}
          onClick={actions.image}
          onMouseDown={(e) => e.preventDefault()}
          tooltip={`${t('插入图片')} ${hint('img')}`}
        >
          <ImageIcon />
        </ToolbarButton>
        {blockCommands
          .filter((item) => item.id === 'attachment')
          .map((item) => (
            <ToolbarButton
              aria-label={t('插入附件')}
              disabled={disabled || touchesRaw(editor)}
              key={item.id}
              onClick={actions.attachment}
              onMouseDown={(e) => e.preventDefault()}
              tooltip={`${t('插入附件')} ${hint(item.id)}`}
            >
              <item.icon />
            </ToolbarButton>
          ))}
        <span className="ws-divider" />
        <ToolbarButton
          aria-label={t('查找与替换')}
          disabled={locked}
          onClick={onReplace}
          onMouseDown={(e) => e.preventDefault()}
          tooltip={`${t('查找与替换')} ${platform === 'mac' ? '⌘⇧H' : 'Ctrl+Shift+H'}`}
        >
          <TextSearchIcon />
        </ToolbarButton>
      </div>
      <div
        className="ml-auto flex shrink-0 items-center gap-0.5"
        data-toolbar-right
      >
        <ToolbarButton
          aria-label={t('文档大纲')}
          aria-pressed={!!outlineOpen}
          onClick={onOutline}
          onMouseDown={(e) => e.preventDefault()}
          tooltip={outlineOpen ? t('收起文档大纲') : t('展开文档大纲')}
        >
          <ListTreeIcon />
        </ToolbarButton>

        {document && onToggleMode && (
          <ModeButton mode={document.mode} onToggle={onToggleMode} />
        )}
      </div>
    </Toolbar>
  );
}
