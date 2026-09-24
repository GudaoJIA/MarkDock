'use client';

import type { RangeRef } from 'platejs';
import { useEditorRef } from 'platejs/react';
import { useContext, useEffect, useRef, useState } from 'react';
import { WritingContext } from '../writing/writing-context';
import { EditingContext } from './commands';

/** Preserve the document selection while keyboard focus visits a menu or form. */
export function useEditingMenu() {
  const editor = useEditorRef();
  const { locked } = useContext(WritingContext);
  const { composing } = useContext(EditingContext);
  const disabled = locked || composing;
  const [open, setOpen] = useState(false);
  const range = useRef<RangeRef | null>(null);
  const executed = useRef(false);
  const returnFocus = useRef(true);
  useEffect(
    () => () => {
      range.current?.unref();
    },
    []
  );
  const onOpenChange = (next: boolean) => {
    if (next) {
      if (disabled) return;
      range.current?.unref();
      range.current = editor.selection
        ? editor.api.rangeRef(editor.selection)
        : null;
      executed.current = false;
      returnFocus.current = true;
    }
    setOpen(next);
  };
  const perform = (action: () => void, focus = true) => {
    if (disabled) return;
    if (range.current?.current) editor.tf.select(range.current.current);
    executed.current = true;
    returnFocus.current = focus;
    action();
    setOpen(false);
  };
  const onCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    if (!executed.current && range.current?.current)
      editor.tf.select(range.current.current);
    range.current?.unref();
    range.current = null;
    if (returnFocus.current) editor.tf.focus();
  };
  return { disabled, open, onOpenChange, perform, onCloseAutoFocus };
}
