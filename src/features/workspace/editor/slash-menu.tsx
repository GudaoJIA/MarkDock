'use client';

import type { TComboboxInputElement } from 'platejs';
import { PlateElement, type PlateElementProps } from 'platejs/react';
import { useContext, useEffect, useRef } from 'react';
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxInput,
  InlineComboboxItem,
} from '@/components/ui/inline-combobox';
import { updateSlashQuery } from '@/features/workspace/editor/slash-query';
import { useT } from '@/features/workspace/ui/interface-provider';
import { useShortcutHint } from '../ui/shortcut-hint';
import { blockCommands, EditingContext, runCommand } from './commands';

export function WorkspaceSlash(
  props: PlateElementProps<TComboboxInputElement>
) {
  'use no memo';
  const t = useT();
  const hint = useShortcutHint();
  const actions = useContext(EditingContext);
  const mounted = useRef(true);
  const submitted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        element={props.element}
        setValue={(value) => {
          if (mounted.current && !submitted.current)
            updateSlashQuery(props.editor, props.element, value);
        }}
        trigger="/"
      >
        <InlineComboboxInput
          aria-label={t('筛选插入命令')}
          className="min-w-[1ch]"
          onKeyDownCapture={(event) => {
            if (event.nativeEvent.isComposing && event.key === 'Enter')
              event.stopPropagation();
          }}
        />
        <InlineComboboxContent
          aria-label={t('插入内容')}
          className="ws-popover"
        >
          <InlineComboboxEmpty>{t('没有匹配的组件')}</InlineComboboxEmpty>
          {blockCommands.map((command) => (
            <InlineComboboxItem
              focusEditor={!['img', 'attachment'].includes(command.id)}
              key={command.id}
              keywords={command.keywords}
              label={t(command.label)}
              onClick={() => {
                submitted.current = true;
                runCommand(
                  props.editor,
                  command.id,
                  actions.image,
                  actions.attachment
                );
              }}
              selectValueOnClick={false}
              setValueOnClick={false}
              value={command.id}
            >
              <command.icon className="mr-2" />
              {t(command.label)}
              <span className="ml-auto pl-4 text-stone-500 text-xs">
                {hint(command.id)}
              </span>
            </InlineComboboxItem>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>
      {props.children}
    </PlateElement>
  );
}
