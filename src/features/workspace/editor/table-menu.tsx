'use client';

import { ChevronDownIcon, TableIcon } from 'lucide-react';
import { KEYS } from 'platejs';
import { useEditorRef, useEditorSelector } from 'platejs/react';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ToolbarButton } from '@/components/ui/toolbar';
import { useT } from '@/features/workspace/ui/interface-provider';
import { touchesRaw } from '../shared/raw';
import { useShortcutHint } from '../ui/shortcut-hint';
import { runCommand, type TableSize, validTableSize } from './commands';
import { useEditingMenu } from './editing-menu';
import {
  runTableAction,
  selectedTableCell,
  tableActions,
} from './table-commands';

function TablePicker({
  onInsert,
  disabled,
}: {
  onInsert: (size: TableSize) => void;
  disabled: boolean;
}) {
  const t = useT();
  const [size, setSize] = useState({ rowCount: 3, colCount: 3 });
  const [custom, setCustom] = useState(false);
  const [rows, setRows] = useState('3');
  const [columns, setColumns] = useState('3');
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    grid.current?.focus();
  }, []);
  const id = useId();
  const customSize = { rowCount: Number(rows), colCount: Number(columns) };
  const valid = validTableSize(customSize);
  const selectedId = `${id}-${size.rowCount}-${size.colCount}`;
  return (
    <div className="ws-table-picker">
      <div aria-live="polite" className="mb-2 font-medium text-sm">
        {size.colCount} {t('列 ×')}
        {size.rowCount} {t('行')}
      </div>
      <div
        aria-activedescendant={selectedId}
        aria-colcount={8}
        aria-label={t('选择表格行列')}
        aria-rowcount={8}
        className="ws-table-grid"
        onKeyDown={(event) => {
          const delta = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
          }[event.key];
          if (delta) {
            event.preventDefault();
            setSize((s) => ({
              rowCount: Math.max(1, Math.min(8, s.rowCount + delta[0])),
              colCount: Math.max(1, Math.min(8, s.colCount + delta[1])),
            }));
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!disabled) onInsert(size);
          }
        }}
        ref={grid}
        role="grid"
        tabIndex={0}
      >
        {Array.from({ length: 8 }, (_, r) => (
          <div key={r} role="row">
            {Array.from({ length: 8 }, (_, c) => (
              <button
                aria-label={t('{0} 列 × {1} 行', [c + 1, r + 1])}
                aria-selected={r < size.rowCount && c < size.colCount}
                data-selected={
                  r < size.rowCount && c < size.colCount ? '' : undefined
                }
                disabled={disabled}
                id={`${id}-${r + 1}-${c + 1}`}
                key={c}
                onClick={() => onInsert({ rowCount: r + 1, colCount: c + 1 })}
                onMouseEnter={() =>
                  setSize({ rowCount: r + 1, colCount: c + 1 })
                }
                role="gridcell"
                tabIndex={-1}
                type="button"
              />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-stone-500 text-xs">{t('首行为表头，计入行数')}</p>
      <button
        aria-expanded={custom}
        className="ws-table-menu-button mt-2"
        onClick={() => setCustom(!custom)}
        type="button"
      >
        {t('自定义行列数…')}
      </button>
      {custom && (
        <form
          className="mt-2 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !disabled) onInsert(customSize);
          }}
        >
          <div className="flex gap-3">
            <label className="flex-1 text-xs">
              {t('列数')}
              <input
                aria-invalid={!valid}
                aria-label={t('表格列数')}
                className="ws-table-size-input"
                max={20}
                min={1}
                onChange={(e) => setColumns(e.target.value)}
                type="number"
                value={columns}
              />
            </label>
            <label className="flex-1 text-xs">
              {t('行数')}
              <input
                aria-invalid={!valid}
                aria-label={t('表格行数')}
                className="ws-table-size-input"
                max={100}
                min={1}
                onChange={(e) => setRows(e.target.value)}
                type="number"
                value={rows}
              />
            </label>
          </div>
          <p
            className={
              valid ? 'text-stone-500 text-xs' : 'text-red-600 text-xs'
            }
            role={valid ? undefined : 'alert'}
          >
            {t('请输入 1–20 列、1–100 行的整数')}
          </p>
          <button
            className="ws-table-menu-button border font-medium"
            disabled={!valid || disabled}
            type="submit"
          >
            {t('插入表格')}
          </button>
        </form>
      )}
    </div>
  );
}

export function WorkspaceTableMenu({ request = 0 }: { request?: number }) {
  const hint = useShortcutHint();
  const t = useT();
  const editor = useEditorRef();
  const menu = useEditingMenu();
  const state = useEditorSelector(
    (e) => ({
      inTable: e.api.some({ match: { type: KEYS.table } }),
      singleCell: !!selectedTableCell(e),
      raw: touchesRaw(e),
    }),
    []
  );
  const [picker, setPicker] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const openRequested = useEffectEvent(() => {
    if (!menu.disabled && !state.raw && !state.inTable) {
      setPicker(true);
      menu.onOpenChange(true);
    }
  });
  useEffect(() => {
    if (!request) return;
    const frame = requestAnimationFrame(() => openRequested());
    return () => cancelAnimationFrame(frame);
  }, [request]);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setPicker(!state.inTable);
        menu.onOpenChange(open);
      }}
      open={menu.open}
    >
      <PopoverTrigger asChild>
        <ToolbarButton
          aria-label={t('表格')}
          disabled={menu.disabled || state.raw}
          tooltip={`${t('表格')} ${hint('table')}`}
        >
          <TableIcon />
          <ChevronDownIcon className="ws-dropdown-chevron" />
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="ws-popover w-64 p-3"
        onCloseAutoFocus={menu.onCloseAutoFocus}
        onOpenAutoFocus={(event) => {
          if (picker) {
            event.preventDefault();
            content.current
              ?.querySelector<HTMLElement>('[role="grid"]')
              ?.focus();
          }
        }}
        ref={content}
      >
        {picker ? (
          <TablePicker
            disabled={menu.disabled}
            onInsert={(size) =>
              menu.perform(() =>
                runCommand(editor, 'table', () => {}, undefined, {
                  tableSize: size,
                })
              )
            }
          />
        ) : (
          <div
            aria-label={t('当前表格操作')}
            className="flex flex-col gap-0.5"
            role="group"
          >
            {tableActions.map((action) => (
              <button
                className={`ws-table-menu-button ${action.id === 'delete-table' ? 'mt-2 border-t text-red-600' : ''}`}
                disabled={menu.disabled || !state.singleCell}
                key={action.id}
                onClick={() =>
                  menu.perform(() => {
                    runTableAction(editor, action.id);
                  })
                }
                type="button"
              >
                {t(action.label)}
              </button>
            ))}
            {!state.singleCell && (
              <p className="px-2 text-stone-500 text-xs">
                {t('请将光标放入一个单元格后操作')}
              </p>
            )}
            <button
              className="ws-table-menu-button mt-2 border-t"
              disabled={menu.disabled}
              onClick={() => setPicker(true)}
              type="button"
            >
              {t('插入新表格…')}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
