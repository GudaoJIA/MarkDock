'use client';
import { useT } from '@/features/workspace/ui/interface-provider';

const MD_EXTENSION = /\.md$/i;

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
} from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TreeEntry } from '@/features/workspace/shared/types';
import { ResourceFolder } from './resource-folder';

export function FileTree({
  workspaceId,
  showResourceDirectories,
  entries,
  active,
  selected,
  expanded,
  query,
  onExpand,
  onSelect,
  onRename,
  onTrash,
  onMove,
  onMoveDialog,
  onDragStatusChange,
  busy,
}: {
  workspaceId: string;
  showResourceDirectories: boolean;
  entries: TreeEntry[];
  active?: string;
  selected: string;
  expanded: Set<string>;
  query: string;
  onExpand: (path: string) => void;
  onSelect: (entry: TreeEntry) => void;
  onRename: (entry: TreeEntry) => void;
  onTrash: (entry: TreeEntry) => void;
  onMove: (source: string, parent: string) => void;
  onMoveDialog: (entry: TreeEntry) => void;
  onDragStatusChange: (status: string | null) => void;
  busy: boolean;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    source: string;
    x: number;
    y: number;
    dragged: boolean;
    target: string | null;
    element: HTMLButtonElement;
    pointerId: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{
    source: string;
    name: string;
    x: number;
    y: number;
    width: number;
  } | null>(null);
  const dragSource = busy ? undefined : drag?.source;

  const [dropCandidate, setDropTarget] = useState<string | null>(null);
  const dropTarget = busy ? null : dropCandidate;
  const targetAt = (x: number, y: number, source: string) => {
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-move-target]');
    const target =
      element && root.current?.contains(element)
        ? (element.dataset.moveTarget ?? null)
        : null;
    const parent = source.split('/').slice(0, -1).join('/');
    return target === parent ? null : target;
  };
  const endDrag = () => {
    const current = gesture.current;
    gesture.current = null;
    setDrag(null);
    setDropTarget(null);
    if (current?.dragged) onDragStatusChange(null);
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
  };
  const cancelDrag = useEffectEvent(endDrag);
  const clearStatus = useEffectEvent(() => onDragStatusChange(null));
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        event.stopPropagation();
        cancelDrag();
      }
    };
    const blur = () => cancelDrag();
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('blur', blur);
      const current = gesture.current;
      gesture.current = null;
      if (current?.dragged) clearStatus();
      if (current?.element.hasPointerCapture(current.pointerId))
        current.element.releasePointerCapture(current.pointerId);
    };
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const matches = (entry: TreeEntry): boolean =>
    !entry.resource &&
    (entry.name.toLocaleLowerCase().includes(needle) ||
      !!entry.children?.some(matches));
  const render = (nodes: TreeEntry[], depth = 0) =>
    nodes
      .filter(
        (entry) =>
          (!entry.resource || showResourceDirectories) &&
          (!needle || matches(entry))
      )
      .map((entry) => {
        if (entry.resource)
          return (
            <ResourceFolder
              busy={busy}
              depth={depth}
              folder={entry}
              key={entry.path}
              workspaceId={workspaceId}
            />
          );
        const folder = entry.kind === 'directory';
        const open = expanded.has(entry.path) || !!needle;
        return (
          <div key={entry.path}>
            <div
              className={`ws-tree-row group flex h-9 items-center rounded-md pr-1 text-sm ${active === entry.path ? 'bg-stone-200/70 text-stone-950' : selected === entry.path ? 'bg-stone-100 text-stone-900' : 'text-stone-600 hover:bg-stone-100'}`}
              data-drag-source={dragSource === entry.path || undefined}
              data-drop-active={dropTarget === entry.path || undefined}
              data-move-target={folder ? entry.path : undefined}
            >
              <button
                aria-current={active === entry.path ? 'page' : undefined}
                aria-expanded={folder ? open : undefined}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pr-1 text-left focus-visible:outline-2 focus-visible:outline-stone-400"
                data-file-path={entry.path}
                disabled={busy}
                draggable={false}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onSelect(entry);
                  if (folder) onExpand(entry.path);
                }}
                onLostPointerCapture={endDrag}
                onPointerCancel={endDrag}
                onPointerDown={(event) => {
                  suppressClick.current = false;
                  if (folder || busy || event.button !== 0 || !event.isPrimary)
                    return;
                  gesture.current = {
                    source: entry.path,
                    x: event.clientX,
                    y: event.clientY,
                    dragged: false,
                    target: null,
                    element: event.currentTarget,
                    pointerId: event.pointerId,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const current = gesture.current;
                  if (!current || busy || event.pointerId !== current.pointerId)
                    return;
                  if (
                    !current.dragged &&
                    Math.hypot(
                      event.clientX - current.x,
                      event.clientY - current.y
                    ) < 6
                  )
                    return;
                  const started = !current.dragged;
                  current.dragged = true;
                  suppressClick.current = true;
                  const rightSpace = window.innerWidth - event.clientX - 16;
                  const leftSpace = event.clientX - 16;
                  const placeLeft = rightSpace < 120 && leftSpace > rightSpace;
                  const previewWidth = Math.max(
                    0,
                    Math.min(224, placeLeft ? leftSpace : rightSpace)
                  );
                  setDrag({
                    source: current.source,
                    name: entry.name.replace(MD_EXTENSION, ''),
                    x: placeLeft
                      ? event.clientX - 8 - previewWidth
                      : event.clientX + 8,
                    y: event.clientY - 18,
                    width: previewWidth,
                  });
                  const nav = root.current?.parentElement;
                  if (nav) {
                    const bounds = nav.getBoundingClientRect();
                    if (event.clientY > bounds.bottom - 24) nav.scrollTop += 14;
                    else if (event.clientY < bounds.top + 24)
                      nav.scrollTop -= 14;
                  }
                  const target = targetAt(
                    event.clientX,
                    event.clientY,
                    current.source
                  );
                  setDropTarget(target);
                  if (started || target !== current.target) {
                    onDragStatusChange(
                      target === null
                        ? '拖到文件夹以移动 · Esc 取消'
                        : t('移至：{0}', [target || '工作区根目录'])
                    );
                  }
                  current.target = target;
                }}
                onPointerUp={(event) => {
                  const current = gesture.current;
                  if (!current || event.pointerId !== current.pointerId) return;
                  const target = targetAt(
                    event.clientX,
                    event.clientY,
                    current.source
                  );
                  endDrag();
                  if (current?.dragged && target !== null && !busy)
                    onMove(current.source, target);
                }}
                style={{
                  paddingLeft: 10 + depth * 16,
                  touchAction: folder ? undefined : 'none',
                }}
                title={entry.path}
                type="button"
              >
                {folder ? (
                  <>
                    {open ? (
                      <ChevronDownIcon className="shrink-0" size={12} />
                    ) : (
                      <ChevronRightIcon className="shrink-0" size={12} />
                    )}
                    {open || dropTarget === entry.path ? (
                      <FolderOpenIcon className="shrink-0" size={15} />
                    ) : (
                      <FolderIcon className="shrink-0" size={15} />
                    )}
                  </>
                ) : (
                  <>
                    <span className="w-3 shrink-0" />
                    <FileTextIcon
                      className="shrink-0 text-stone-400"
                      size={15}
                    />
                  </>
                )}
                <span className="truncate">
                  {folder ? entry.name : entry.name.replace(MD_EXTENSION, '')}
                </span>
              </button>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={t('文档操作 {0}', [entry.name])}
                    className="ws-tree-actions rounded p-1 text-stone-400 opacity-0 hover:bg-stone-200 focus:opacity-100 group-hover:opacity-100"
                    disabled={busy}
                    type="button"
                  >
                    <MoreHorizontalIcon size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="ws-popover">
                  <DropdownMenuItem onSelect={() => onRename(entry)}>
                    {t('重命名')}
                  </DropdownMenuItem>
                  {!folder && (
                    <DropdownMenuItem onSelect={() => onMoveDialog(entry)}>
                      {t('移动到…')}
                    </DropdownMenuItem>
                  )}
                  {!folder && (
                    <DropdownMenuItem
                      onSelect={() => onTrash(entry)}
                      variant="destructive"
                    >
                      {t('移到垃圾箱')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {folder && open && render(entry.children ?? [], depth + 1)}
          </div>
        );
      });
  return (
    <div
      aria-label={t('文档树')}
      className="space-y-0.5"
      data-dragging={!!dragSource || undefined}
      data-workspace-tree
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
          return;
        const buttons = [
          ...(root.current?.querySelectorAll<HTMLButtonElement>(
            '[data-file-path]'
          ) ?? []),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement
        );
        if (index < 0) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : index + (event.key === 'ArrowDown' ? 1 : -1);
        buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
      }}
      ref={root}
      tabIndex={-1}
    >
      <div
        className="ws-tree-row mb-2 rounded-md border border-stone-300 border-dashed px-3 py-3 text-stone-500 text-xs"
        data-drop-active={dropTarget === '' || undefined}
        data-drop-root
        data-move-target=""
      >
        {dragSource ? t('移到工作区根目录') : t('工作区根目录')}
      </div>
      {drag &&
        !busy &&
        createPortal(
          <div
            aria-hidden="true"
            className="ws-popover ws-drag-preview"
            data-drag-preview
            style={{
              left: drag.x,
              top: drag.y,
              width: drag.width,
            }}
          >
            <FileTextIcon />
            <span className="truncate">{drag.name}</span>
          </div>,
          document.body
        )}
      {render(entries)}
      {entries.filter(
        (entry) =>
          (!entry.resource || showResourceDirectories) &&
          (!needle || matches(entry))
      ).length === 0 && (
        <p className="px-3 py-4 text-stone-400 text-xs">
          {needle ? t('没有匹配的文档') : t('文件夹中还没有 Markdown 文档')}
        </p>
      )}
    </div>
  );
}
