'use client';

import { MoreHorizontalIcon, MoreVerticalIcon } from 'lucide-react';
import type { PathRef } from 'platejs';
import {
  PlateElement,
  type PlateElementProps,
  useEditorSelector,
} from 'platejs/react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/features/workspace/ui/interface-provider';
import { useEditingMenu } from './editing-menu';
import { runTableAction, tableActions } from './table-commands';

type Target = { axis: 'row' | 'column'; index: number } | null;
const TableTargetContext = createContext<{
  target: Target;
  setTarget: (value: Target) => void;
}>({ target: null, setTarget: () => {} });

export function WorkspaceTable(props: PlateElementProps) {
  const [target, setTarget] = useState<Target>(null);
  const active = useEditorSelector(
    (e) => {
      const path = props.editor.api.findPath(props.element);
      return !!path && !!e.selection && e.selection.anchor.path[0] === path[0];
    },
    [props.element]
  );
  return (
    <TableTargetContext.Provider value={{ target, setTarget }}>
      <PlateElement
        {...props}
        as="table"
        attributes={{
          ...props.attributes,
          'data-active': active || target ? '' : undefined,
        }}
        className="ws-table my-8 w-full border-collapse"
      >
        <tbody>{props.children}</tbody>
      </PlateElement>
    </TableTargetContext.Provider>
  );
}

export function WorkspaceRow(props: PlateElementProps) {
  return <PlateElement {...props} as="tr" />;
}

function TableHandle({
  props,
  axis,
  index,
}: {
  props: PlateElementProps;
  axis: 'row' | 'column';
  index: number;
}) {
  const t = useT();
  const menu = useEditingMenu();
  const targetRef = useRef<PathRef | null>(null);
  const { setTarget } = useContext(TableTargetContext);
  useEffect(
    () => () => {
      targetRef.current?.unref();
    },
    []
  );
  const label =
    axis === 'row'
      ? t('第 {0} 行操作', [index + 1])
      : t('第 {0} 列操作', [index + 1]);
  return (
    <div
      className={`ws-table-handle ws-table-${axis}-handle`}
      contentEditable={false}
    >
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (open && !menu.disabled) {
            const path = props.editor.api.findPath(props.element);
            if (!path) return;
            targetRef.current?.unref();
            targetRef.current = props.editor.api.pathRef(path);
            setTarget({ axis, index });
          } else if (!open) setTarget(null);
          menu.onOpenChange(open);
        }}
        open={menu.open}
      >
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t(label)}
            disabled={menu.disabled}
            onMouseDown={(e) => e.preventDefault()}
            type="button"
          >
            {axis === 'row' ? (
              <MoreVerticalIcon size={14} />
            ) : (
              <MoreHorizontalIcon size={14} />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="ws-popover"
          onCloseAutoFocus={(event) => {
            targetRef.current?.unref();
            targetRef.current = null;
            menu.onCloseAutoFocus(event);
          }}
        >
          {tableActions
            .filter((action) => action.id.includes(axis))
            .map((action) => (
              <DropdownMenuItem
                disabled={menu.disabled}
                key={action.id}
                onSelect={() =>
                  menu.perform(() => {
                    const path = targetRef.current?.current;
                    if (path) runTableAction(props.editor, action.id, path);
                    setTarget(null);
                  })
                }
                variant={
                  action.id.startsWith('delete') ? 'destructive' : 'default'
                }
              >
                {t(action.label)}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Cell({ header, ...props }: PlateElementProps & { header?: boolean }) {
  const path = props.editor.api.findPath(props.element);
  const row = path?.at(-2) ?? -1;
  const column = path?.at(-1) ?? -1;
  const { target } = useContext(TableTargetContext);
  const highlighted =
    target && (target.axis === 'row' ? row : column) === target.index;
  return (
    <PlateElement
      {...props}
      as={header ? 'th' : 'td'}
      attributes={{
        ...props.attributes,
        'data-target': highlighted ? '' : undefined,
      }}
      className={`ws-table-cell relative min-w-24 border border-stone-200 px-3 py-2 text-left align-top ${header ? 'bg-stone-50 font-semibold' : ''}`}
    >
      {column === 0 && <TableHandle axis="row" index={row} props={props} />}
      {row === 0 && <TableHandle axis="column" index={column} props={props} />}
      {props.children}
    </PlateElement>
  );
}

export function WorkspaceCell(props: PlateElementProps) {
  return <Cell {...props} />;
}
export function WorkspaceHeader(props: PlateElementProps) {
  return <Cell {...props} header />;
}
