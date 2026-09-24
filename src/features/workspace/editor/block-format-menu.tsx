'use client';

import type { PathRef, RangeRef, TElement } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/features/workspace/ui/interface-provider';
import { useShortcutHint } from '../ui/shortcut-hint';
import type { WritingModel } from '../writing/writing';
import {
  blockConversionFormats,
  blockConversionState,
  blockNodeConversionState,
  convertBlock,
  deleteBlock,
} from './block-conversion';

export function BlockFormatMenu({
  children,
  editor,
  model,
  id,
  locked,
  node,
}: {
  children: ReactElement;
  editor: PlateEditor;
  model: WritingModel;
  id: string;
  locked: boolean;
  node: TElement;
}) {
  const t = useT();
  const hint = useShortcutHint();
  const [open, setOpen] = useState(false);
  const target = useRef<PathRef | null>(null);
  const selection = useRef<RangeRef | null>(null);
  const executed = useRef(false);
  const state = blockNodeConversionState(editor, node);
  useEffect(() => {
    if (open && (locked || !target.current?.current)) setOpen(false);
  }, [open, locked, state.enabled, editor.children]);
  useEffect(
    () => () => {
      target.current?.unref();
      selection.current?.unref();
    },
    []
  );
  const changeOpen = (next: boolean) => {
    if (next) {
      if (locked) return;
      target.current?.unref();
      selection.current?.unref();
      target.current = editor.api.pathRef([model.index(id)]);
      selection.current = editor.selection
        ? editor.api.rangeRef(editor.selection)
        : null;
      executed.current = false;
    }
    setOpen(next);
  };
  return (
    <DropdownMenu modal={false} onOpenChange={changeOpen} open={open}>
      <DropdownMenuTrigger
        asChild
        onClick={(event) => {
          if (!event.defaultPrevented) changeOpen(!open);
        }}
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="ws-popover"
        onCloseAutoFocus={(event) => {
          if (executed.current || locked) event.preventDefault();
          const previous = selection.current?.unref();
          selection.current = null;
          target.current?.unref();
          target.current = null;
          if (!executed.current && previous) editor.tf.select(previous);
        }}
        side="left"
      >
        {state.enabled && (
          <DropdownMenuRadioGroup value={state.current}>
            {blockConversionFormats.map(({ id: format, label }) => (
              <DropdownMenuRadioItem
                key={format}
                onSelect={() => {
                  const path = target.current?.current;
                  if (locked || !path) return;
                  const current = blockConversionState(editor, path);
                  if (!current.enabled) return;
                  executed.current = true;
                  if (current.current !== format && model.collapsed.has(id))
                    model.toggle(id);
                  convertBlock(editor, path, format);
                  if (current.current === format)
                    editor.tf.select(editor.api.start(path)!);
                  editor.tf.focus();
                  setOpen(false);
                }}
                value={format}
              >
                {t(label)}
                <span className="ml-auto pl-4 text-stone-500 text-xs">
                  {hint(format)}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
        {state.enabled && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onSelect={() => {
            const path = target.current?.current;
            if (locked || !path) return;
            executed.current = true;
            if (model.collapsed.has(id)) model.toggle(id);
            deleteBlock(editor, path);
            editor.tf.focus();
            setOpen(false);
          }}
          variant="destructive"
        >
          {t('删除该块')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
