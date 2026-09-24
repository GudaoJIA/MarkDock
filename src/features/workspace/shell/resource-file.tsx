'use client';

import {
  DownloadIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { ImageViewer } from '../editor/image-viewer';
import {
  previewableImage,
  type ResourceEntry,
} from '../shared/resource-listing';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
import { useT } from '../ui/interface-provider';

const textFile = /\.(txt|md|pdf|docx?|odt)$/i;

export function ResourceFile({
  entry,
  workspaceId,
  depth,
  busy,
}: {
  entry: ResourceEntry;
  workspaceId: string;
  depth: number;
  busy: boolean;
}) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const image =
    previewableImage(entry.name) && (entry.size ?? 0) <= 20 * 1024 * 1024;
  const Icon = previewableImage(entry.name)
    ? FileImageIcon
    : textFile.test(entry.name)
      ? FileTextIcon
      : FileIcon;
  const params = new URLSearchParams({
    id: workspaceId,
    path: entry.path,
    scope: 'resource',
  });
  const focus = () => {
    if (trigger.current?.isConnected) trigger.current.focus();
    else document.querySelector<HTMLElement>('[data-workspace-tree]')?.focus();
  };
  const details = (
    <div className="space-y-3 break-words text-sm">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt>{t('文件名')}</dt>
        <dd>{entry.name}</dd>
        <dt>{t('文件类型')}</dt>
        <dd>
          {entry.name.includes('.')
            ? entry.name.split('.').at(-1)?.toUpperCase()
            : t('文件')}
        </dd>
        <dt>{t('文件大小')}</dt>
        <dd>
          {(entry.size ?? 0) < 1024
            ? `${entry.size ?? 0} B`
            : `${((entry.size ?? 0) / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`}
        </dd>
        <dt>{t('工作区相对路径')}</dt>
        <dd className="break-all">{entry.path}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <a
          className="ws-button"
          download
          href={`/api/workspace/attachment?${params}`}
        >
          <DownloadIcon />
          {t('下载')}
        </a>
        <button
          className="ws-button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(entry.path);
              setNotice(t('路径已复制'));
            } catch {
              setNotice(t('复制失败，请手动复制路径。'));
            }
          }}
          type="button"
        >
          {t('复制路径')}
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
  return (
    <>
      <button
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left text-sm text-stone-500 hover:bg-stone-100"
        data-resource-file
        disabled={busy}
        onClick={() => {
          setNotice('');
          setOpen(true);
        }}
        ref={trigger}
        style={{ paddingLeft: 26 + depth * 16 }}
        title={entry.name}
        type="button"
      >
        <Icon className="shrink-0" />
        <span className="truncate">{entry.name}</span>
      </button>
      {open &&
        (image ? (
          <ImageViewer
            actions={details}
            alt={entry.name}
            onClose={() => setOpen(false)}
            restoreFocus={focus}
            source={`/api/workspace?operation=asset&${params}`}
          />
        ) : (
          <Dialog onOpenChange={setOpen} open>
            <DialogContent
              className="w-[min(520px,calc(100vw-32px))]"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                focus();
              }}
            >
              <DialogTitle>{t('资源文件')}</DialogTitle>
              <DialogDescription className="sr-only">
                {t('文件信息与下载')}
              </DialogDescription>
              {details}
            </DialogContent>
          </Dialog>
        ))}
    </>
  );
}
