'use client';

import {
  CircleAlertIcon,
  FolderOpenIcon,
  PinIcon,
  PinOffIcon,
  Settings2Icon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/features/workspace/ui/interface-provider';
import type { OpeningState } from '../shared/open-progress';
import type { WorkspaceRecord } from '../state/manager';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { OpenProgressPanel } from './open-progress-panel';
import { WorkspaceBrowser } from './workspace-browser';

export function WorkspaceManagement({
  records,
  progress,
  onCancelOpen,
  locations,
  current,
  busy,
  error,
  onSwitch,
  onPin,
  onRefresh,
  onSettings,
  open,
  onOpenChange,
}: {
  records: WorkspaceRecord[];
  progress?: OpeningState;
  onCancelOpen: () => void;
  locations: { root: string; name: string; error?: string }[];
  current?: WorkspaceRecord;
  busy: boolean;
  error: string;
  onSwitch: (root: string) => Promise<boolean>;
  onPin: (root: string, remove?: boolean) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  onSettings: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const drag = useRef<string | null>(null);
  const [hover, setHover] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [highlight, setHighlight] = useState('');
  const locked = busy || pending;
  useEffect(() => {
    if (!open) return;
    void onRefresh();
    const refresh = () => {
      void onRefresh();
    };
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      drag.current = null;
    };
  }, [open, onRefresh]);
  useEffect(() => {
    if (!highlight) return;
    document
      .getElementById(`ws-pin-${encodeURIComponent(highlight)}`)
      ?.scrollIntoView({ block: 'nearest' });
    const timer = setTimeout(() => setHighlight(''), 2000);
    return () => clearTimeout(timer);
  }, [highlight]);
  const pin = async (root: string, remove = false) => {
    setHighlight('');
    setPending(true);
    try {
      if (await onPin(root, remove)) {
        setNotice(
          remove ? '已取消固定，磁盘文件不受影响。' : '已固定到工作区。'
        );
        setHighlight(remove ? '' : root);
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <div
        className="ws-workspace-trigger flex w-full items-center rounded-lg border border-stone-200 bg-background shadow-xs"
        data-open={open || undefined}
      >
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={t('工作区管理')}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm"
          disabled={busy}
          onClick={() => onOpenChange(true)}
          ref={trigger}
          type="button"
        >
          <FolderOpenIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {current?.name ?? t('工作区管理')}
          </span>
        </button>
        {current && (
          <button
            aria-label={t('工作区设置')}
            className="ws-icon-button mr-2 shrink-0"
            disabled={locked}
            onClick={onSettings}
            title={t('工作区设置')}
            type="button"
          >
            <Settings2Icon className="size-4" />
          </button>
        )}
      </div>
      <Dialog
        onOpenChange={(value) => {
          if (!locked) onOpenChange(value);
        }}
        open={open}
      >
        <DialogContent
          className="max-h-[95dvh] grid-cols-1 overflow-y-auto sm:max-w-6xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (locked) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (locked) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('工作区管理')}</DialogTitle>
            <DialogDescription>
              {t(
                '将服务所在设备上的文件夹固定为工作区，方便随时打开；固定或取消固定不会移动、复制或删除文件。'
              )}
            </DialogDescription>
          </DialogHeader>
          {progress && (
            <OpenProgressPanel onCancel={onCancelOpen} progress={progress} />
          )}
          {notice && !progress && (
            <p className="text-stone-500 text-xs" role="status">
              {t(notice)}
            </p>
          )}
          <WorkspaceBrowser
            activeRoot={current?.root}
            busy={locked}
            confirmLabel={t('固定到工作区')}
            locations={locations}
            onDragDirectory={(root) => {
              drag.current = root;
            }}
            onSelect={(root) => {
              void pin(root);
            }}
            recent={records}
            sidebar={
              <section
                aria-label={t('已固定工作区')}
                className={`mt-3 min-h-24 flex-1 rounded-lg border-t p-1 ${hover ? 'border-sky-500 bg-stone-100' : 'border-stone-200'}`}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  )
                    setHover(false);
                }}
                onDragOver={(event) => {
                  if (drag.current && !locked) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'link';
                    setHover(true);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setHover(false);
                  if (drag.current && !locked) {
                    const root = drag.current;
                    drag.current = null;
                    void pin(root);
                  }
                }}
              >
                <h3 className="flex items-center gap-1 px-1 py-2 font-medium text-[11px] text-stone-400">
                  <PinIcon className="size-3" />
                  {t('已有工作区')}
                </h3>
                {records.map((record) => (
                  <div
                    className={`ws-pinned-item mb-1.5 flex h-10 items-center gap-0.5 rounded-md px-1 py-1 ${current?.root === record.root ? 'bg-stone-200' : 'hover:bg-stone-200/60'}`}
                    data-highlight={record.root === highlight || undefined}
                    id={`ws-pin-${encodeURIComponent(record.root)}`}
                    key={record.root}
                  >
                    <button
                      aria-current={
                        current?.root === record.root ? 'true' : undefined
                      }
                      aria-label={
                        record.error
                          ? `${record.name}，${t('无法访问，点击重试')}`
                          : record.name
                      }
                      className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-sm"
                      disabled={locked}
                      onClick={async () => {
                        if (await onSwitch(record.root)) onOpenChange(false);
                      }}
                      title={
                        record.error
                          ? `${record.root} — ${t('无法访问，点击重试')}`
                          : record.root
                      }
                      type="button"
                    >
                      <FolderOpenIcon
                        className={`size-4 shrink-0 ${current?.root === record.root ? 'fill-current text-sky-600' : 'text-stone-500'}`}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {record.name}
                      </span>
                      {record.error && (
                        <CircleAlertIcon
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-amber-700"
                        />
                      )}
                    </button>
                    <Button
                      aria-label={t('设置 {0}', [record.name])}
                      className="size-7 shrink-0"
                      disabled={locked}
                      onClick={async () => {
                        if (
                          current?.root === record.root ||
                          (await onSwitch(record.root))
                        ) {
                          onOpenChange(false);
                          onSettings();
                        }
                      }}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Settings2Icon className="size-3.5" />
                    </Button>
                    <Button
                      aria-label={t('取消固定 {0}', [record.name])}
                      className="group size-7 shrink-0"
                      disabled={locked}
                      onClick={() => {
                        void pin(record.root, true);
                      }}
                      size="icon"
                      title={t('已固定，点击取消固定')}
                      type="button"
                      variant="ghost"
                    >
                      <PinIcon className="size-3.5 group-hover:hidden" />
                      <PinOffIcon className="hidden size-3.5 group-hover:block" />
                    </Button>
                  </div>
                ))}
                {!records.length && (
                  <p className="px-2 py-5 text-stone-400 text-xs">
                    {t('将文件夹拖到这里固定')}
                  </p>
                )}
              </section>
            }
          />
          {error && (
            <p className="text-amber-700 text-sm" role="alert">
              {t(error)}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
