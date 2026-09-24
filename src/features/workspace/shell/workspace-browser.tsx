'use client';

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  FolderIcon,
  HardDriveIcon,
  PencilIcon,
  PinIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/features/workspace/ui/interface-provider';
import { fileClient } from '../shared/client';
import type { DirectoryListing } from '../shared/types';

export function WorkspaceBrowser({
  activeRoot,
  locations,
  sidebar,
  recent,
  busy,
  confirmLabel,
  onSelect,
  onDragDirectory,
}: {
  activeRoot?: string;
  locations: { root: string; name: string; error?: string }[];
  sidebar: ReactNode;
  recent: { root: string; name: string }[];
  busy: boolean;
  confirmLabel: string;
  onSelect: (path: string) => void;
  onDragDirectory?: (path: string | null) => void;
}) {
  const t = useT();
  const [request, setRequest] = useState<{ path: string; cursor?: number }>();
  const [history, setHistory] = useState<{ paths: string[]; cursor: number }>({
    paths: [],
    cursor: -1,
  });
  const [columns, setColumns] = useState<DirectoryListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const pane = useRef<HTMLDivElement>(null);
  const current = columns.at(-1);
  useEffect(() => {
    if (!request) return;
    let alive = true;
    void fileClient
      .browse({ scope: 'host', path: request.path })
      .then((value) => {
        if (!alive) return;
        setColumns((previous) => {
          const same = previous.findIndex(
            (column) => column.path === value.path
          );
          if (same >= 0) return [...previous.slice(0, same), value];
          const parent = previous.findIndex((column) =>
            column.directories.some((entry) => entry.path === value.path)
          );
          return parent >= 0
            ? [...previous.slice(0, parent + 1), value]
            : [value];
        });
        setHistory((previous) => {
          if (request.cursor !== undefined)
            return { ...previous, cursor: request.cursor };
          if (previous.paths[previous.cursor] === value.path) return previous;
          const paths = [
            ...previous.paths.slice(0, previous.cursor + 1),
            value.path,
          ];
          return { paths, cursor: paths.length - 1 };
        });
        setAddress(value.path);
        setError('');
        setLoading(false);
      })
      .catch((reason: Error) => {
        if (alive) {
          setError(reason.message);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [request]);
  useEffect(() => {
    if (pane.current) pane.current.scrollLeft = pane.current.scrollWidth;
  }, [columns, loading, error]);
  const navigate = (path: string, cursor?: number) => {
    setLoading(true);
    setError('');
    setEditing(false);
    setAddress(path ?? '');
    setRequest({ path, cursor });
  };
  const parent = error ? current?.path : current?.parent;
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-stone-200 bg-background">
      <div className="flex flex-wrap items-center gap-1 border-stone-200 border-b bg-stone-50 px-2 py-2">
        <Button
          aria-label={t('后退')}
          disabled={busy || loading || history.cursor <= 0}
          onClick={() =>
            navigate(history.paths[history.cursor - 1], history.cursor - 1)
          }
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          aria-label={t('前进')}
          disabled={
            busy || loading || history.cursor >= history.paths.length - 1
          }
          onClick={() =>
            navigate(history.paths[history.cursor + 1], history.cursor + 1)
          }
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowRightIcon />
        </Button>
        <Button
          aria-label={t('返回上一级')}
          disabled={busy || parent == null}
          onClick={() => {
            if (parent != null) navigate(parent);
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowUpIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate px-2 font-medium text-sm">
          {current?.breadcrumbs.at(-1)?.name || t('浏览文件夹')}
        </span>
        <Button
          aria-label={t('刷新目录')}
          disabled={busy || loading || !request}
          onClick={() => {
            const path = error ? request?.path : current?.path;
            if (path) navigate(path);
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <RefreshCwIcon />
        </Button>
        <Button
          disabled={
            busy ||
            loading ||
            !!error ||
            !current ||
            recent.some((item) => item.root === current.path)
          }
          onClick={() => {
            if (current) onSelect(current.path);
          }}
          type="button"
        >
          <PinIcon className="size-4" />
          {busy
            ? t('处理中…')
            : current && recent.some((item) => item.root === current.path)
              ? t('已固定')
              : confirmLabel}
        </Button>
      </div>
      <div className="flex flex-col sm:flex-row">
        <aside
          aria-label={t('目录位置')}
          className="flex max-h-48 shrink-0 flex-col overflow-y-auto border-stone-200 border-b bg-stone-50 p-2 sm:max-h-[min(63vh,510px)] sm:w-60 sm:border-r sm:border-b-0 [&>*]:shrink-0"
        >
          <p className="px-2 py-1 font-medium text-[11px] text-stone-400">
            {t('数据位置')}
          </p>
          {locations.map((location) => (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-stone-200/60"
              disabled={busy}
              key={location.root}
              onClick={() => navigate(location.root)}
              title={location.error || location.root}
              type="button"
            >
              <HardDriveIcon className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{location.name}</span>
              {location.error && (
                <span className="text-amber-700 text-xs">{t('不可用')}</span>
              )}
            </button>
          ))}
          {!locations.length && (
            <p className="px-2 py-2 text-stone-400 text-xs">
              {t('尚未配置数据位置')}
            </p>
          )}
          {sidebar}
        </aside>
        <div
          aria-busy={loading}
          aria-label={t('文件夹分栏')}
          className="flex h-[min(63vh,510px)] min-w-0 flex-1 overflow-x-auto"
          ref={pane}
        >
          {!request && (
            <p className="p-6 text-sm text-stone-400">{t('选择数据位置')}</p>
          )}
          {columns.map((column, index) => (
            <div
              aria-label={column.path}
              className="w-52 shrink-0 overflow-y-auto border-stone-200 border-r p-1.5"
              key={column.path}
            >
              <p
                className="truncate px-2 py-2 text-stone-400 text-xs"
                title={column.path}
              >
                {column.breadcrumbs.at(-1)?.name}
              </p>
              {column.directories.map((item) => (
                <button
                  aria-current={
                    columns[index + 1]?.path === item.path
                      ? 'location'
                      : undefined
                  }
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${columns[index + 1]?.path === item.path ? 'bg-stone-200 font-medium' : 'hover:bg-stone-100'}`}
                  disabled={busy}
                  draggable={!busy && !!onDragDirectory}
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  onDragEnd={() => onDragDirectory?.(null)}
                  onDragStart={(event) => {
                    if (!onDragDirectory || busy) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.effectAllowed = 'link';
                    event.dataTransfer.setData(
                      'application/x-markdock-directory',
                      item.path
                    );
                    onDragDirectory(item.path);
                  }}
                  type="button"
                >
                  <FolderIcon
                    className={`size-4 shrink-0 ${activeRoot === item.path ? 'fill-current text-sky-600' : 'text-stone-500'}`}
                  />
                  <span className="min-w-0 flex-1 truncate" title={item.name}>
                    {item.name}
                  </span>
                  {recent.some((record) => record.root === item.path) && (
                    <PinIcon
                      aria-label={t('已固定')}
                      className="size-3 shrink-0 text-stone-500"
                    />
                  )}
                  <ChevronRightIcon className="size-3 shrink-0 text-stone-400" />
                </button>
              ))}
              {!column.directories.length && (
                <p className="px-2 py-4 text-stone-400 text-xs">
                  {t('没有可显示的子文件夹')}
                </p>
              )}
            </div>
          ))}
          {(loading || error) && (
            <div className="w-52 shrink-0 p-4 text-sm">
              {loading ? (
                <p className="text-stone-500" role="status">
                  {t('正在读取目录…')}
                </p>
              ) : (
                <>
                  <p className="break-all text-amber-700" role="alert">
                    {t(error)}
                  </p>
                  <Button
                    className="mt-3"
                    disabled={busy}
                    onClick={() => navigate(request!.path)}
                    type="button"
                    variant="outline"
                  >
                    {t('重试')}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 border-stone-200 border-t px-2 py-1">
        {editing ? (
          <input
            aria-label={t('目录绝对路径')}
            autoFocus
            className="ws-input min-w-0 flex-1"
            disabled={busy}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                navigate(address);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setEditing(false);
              }
            }}
            value={address}
          />
        ) : (
          <nav
            aria-label={t('目录路径')}
            className="flex min-w-0 flex-1 items-center overflow-x-auto text-xs"
          >
            {current?.breadcrumbs.map((item, index) => (
              <span className="flex shrink-0 items-center" key={item.path}>
                {index > 0 && (
                  <ChevronRightIcon className="size-3 text-stone-400" />
                )}
                <button
                  className="rounded px-1.5 py-2 hover:bg-stone-100"
                  disabled={busy}
                  onClick={() => navigate(item.path)}
                  title={item.path}
                  type="button"
                >
                  {item.name}
                </button>
              </span>
            ))}
          </nav>
        )}
        <Button
          aria-label={t('输入路径')}
          disabled={busy}
          onClick={() => setEditing((value) => !value)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <PencilIcon />
        </Button>
      </div>
    </div>
  );
}
