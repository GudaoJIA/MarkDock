'use client';

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { resourceClient } from '../shared/client';
import type { ResourceListing } from '../shared/resource-listing';
import { useT } from '../ui/interface-provider';
import { ResourceFile } from './resource-file';

type Folder = { name: string; path: string };
export function ResourceFolder({
  folder,
  workspaceId,
  depth,
  busy,
}: {
  folder: Folder;
  workspaceId: string;
  depth: number;
  busy: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        aria-expanded={open}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left text-sm text-stone-500 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-stone-400"
        data-file-path={folder.path}
        data-resource-directory
        disabled={busy}
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: 10 + depth * 16 }}
        title={folder.path}
        type="button"
      >
        {open ? (
          <ChevronDownIcon className="shrink-0" size={12} />
        ) : (
          <ChevronRightIcon className="shrink-0" size={12} />
        )}
        {open ? (
          <FolderOpenIcon className="shrink-0" size={15} />
        ) : (
          <FolderIcon className="shrink-0" size={15} />
        )}
        <span className="truncate">{folder.name}</span>
        <span className="ml-auto shrink-0 rounded border border-stone-200 px-1 text-[10px]">
          {t('资源')}
        </span>
      </button>
      {open && (
        <ResourceChildren
          busy={busy}
          depth={depth + 1}
          path={folder.path}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}
function ResourceChildren({
  workspaceId,
  path,
  depth,
  busy,
}: {
  workspaceId: string;
  path: string;
  depth: number;
  busy: boolean;
}) {
  const t = useT();
  const [result, setResult] = useState<ResourceListing>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<{ cursor?: string; attempt: number }>({
    attempt: 0,
  });
  useEffect(() => {
    const abort = new AbortController();
    void resourceClient
      .list(workspaceId, path, request.cursor, abort.signal)
      .then((listing) => {
        if (!abort.signal.aborted)
          setResult((previous) => ({
            ...listing,
            entries: request.cursor
              ? [...(previous?.entries ?? []), ...listing.entries]
              : listing.entries,
          }));
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [workspaceId, path, request]);
  return (
    <div>
      {result?.entries.map((entry) =>
        entry.kind === 'directory' ? (
          <ResourceFolder
            busy={busy}
            depth={depth}
            folder={entry}
            key={entry.path}
            workspaceId={workspaceId}
          />
        ) : (
          <ResourceFile
            busy={busy}
            depth={depth}
            entry={entry}
            key={entry.path}
            workspaceId={workspaceId}
          />
        )
      )}
      <div
        className="space-y-1 pr-2 text-xs"
        style={{ paddingLeft: 10 + depth * 16 }}
      >
        {loading && (
          <p className="py-2 text-stone-500" role="status">
            {t('正在加载目录…')}
          </p>
        )}
        {error && (
          <>
            <p className="break-words text-red-700" role="alert">
              {t(error)}
            </p>
            <button
              className="ws-button"
              disabled={busy}
              onClick={() => {
                setLoading(true);
                setError('');
                setResult(undefined);
                setRequest({ attempt: request.attempt + 1 });
              }}
              type="button"
            >
              {t('刷新列表')}
            </button>
          </>
        )}
        {!loading && !error && result?.entries.length === 0 && (
          <p className="py-2 text-stone-500">{t('文件夹为空')}</p>
        )}
        {!error && result?.nextCursor && (
          <button
            className="ws-button"
            disabled={busy || loading}
            onClick={() => {
              setLoading(true);
              setError('');
              setRequest({
                cursor: result.nextCursor,
                attempt: request.attempt + 1,
              });
            }}
            type="button"
          >
            {t('加载更多')}
          </button>
        )}
      </div>
    </div>
  );
}
