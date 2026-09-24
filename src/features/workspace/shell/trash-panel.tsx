'use client';

import {
  AlertTriangleIcon,
  Clock3Icon,
  FileTextIcon,
  FolderIcon,
  InfoIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useInterface, useT } from '@/features/workspace/ui/interface-provider';
import type { WorkspaceEditor } from '../editor/editor-kit';
import { fileClient } from '../shared/client';
import type { TrashEntry } from '../shared/types';
import type { WorkspaceController } from '../state/sessions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';

export function TrashPanel({
  controller,
  onClose,
}: {
  controller: WorkspaceController<WorkspaceEditor>;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useInterface();
  const id = controller.workspace!.id;
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    fileClient
      .trashList(id)
      .then((value) => {
        if (alive) setEntries(value);
      })
      .catch((error) => {
        if (alive) setError(error.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  const perform = async (action: () => Promise<void>) => {
    if (busy || controller.busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setEntries(await fileClient.trashList(id));
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      open
    >
      <DialogContent className="ws-trash-panel max-h-[85vh] gap-0 overflow-auto p-0 sm:max-w-xl">
        <header className="flex items-center gap-3 border-stone-200 border-b px-5 py-5 pr-12">
          <span className="rounded-lg border border-stone-200 bg-stone-50 p-2.5 text-stone-500">
            <Trash2Icon aria-hidden="true" className="size-5" />
          </span>
          <div className="space-y-2">
            <DialogTitle>{t('垃圾箱')}</DialogTitle>
            <DialogDescription>
              {t('当前工作区已删除的文档，可随时恢复。')}
            </DialogDescription>
          </div>
        </header>
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-2 rounded-lg bg-stone-50 p-3 text-stone-500 text-xs leading-relaxed">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>
              {t(
                '垃圾箱不会自动清理。文档专属资源随文档保留，恢复前，其他文档对这些资源的引用可能暂时失效。'
              )}
            </p>
          </div>
          {error && (
            <p
              className="whitespace-pre-wrap break-all rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-sm"
              role="alert"
            >
              {t(error)}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p
              className="flex items-center gap-2 text-sm text-stone-500"
              role="status"
            >
              {busy ? (
                <>
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="size-4 animate-spin"
                  />
                  {t('正在处理…')}
                </>
              ) : (
                t('{0} 个文档', [entries.length])
              )}
            </p>
            <button
              className="ws-button ws-trash-danger"
              disabled={busy || !entries.length}
              onClick={() => setConfirmation(entries.map((entry) => entry.id))}
              type="button"
            >
              <Trash2Icon aria-hidden="true" className="size-4" />
              {t('清空垃圾箱')}
            </button>
          </div>
          {confirmation && (
            <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="flex items-center gap-2 font-medium text-red-700 text-sm">
                <AlertTriangleIcon
                  aria-hidden="true"
                  className="size-4 shrink-0"
                />
                {t('确认彻底删除')}
              </p>
              <p className="text-sm text-stone-600 leading-relaxed">
                {t('彻底删除这')}
                {confirmation.length}{' '}
                {t(
                  '个条目及随行资源？无法通过垃圾箱恢复；独立历史备份不会被清理。'
                )}
              </p>
              <div className="flex flex-wrap justify-end gap-2 border-red-200 border-t pt-3">
                <button
                  className="ws-button bg-background"
                  disabled={busy}
                  onClick={() => setConfirmation(null)}
                  type="button"
                >
                  {t('取消')}
                </button>
                <button
                  className="ws-button ws-trash-danger"
                  disabled={busy}
                  onClick={() => {
                    const ids = confirmation;
                    void perform(async () => {
                      const result: {
                        failed: { id: string; error: string }[];
                      } = {
                        failed: [],
                      };
                      for (
                        let offset = 0;
                        offset < ids.length;
                        offset += 5000
                      ) {
                        result.failed.push(
                          ...(
                            await fileClient.purge(
                              id,
                              ids.slice(offset, offset + 5000)
                            )
                          ).failed
                        );
                      }
                      setConfirmation(null);
                      if (result.failed.length)
                        setError(
                          result.failed
                            .map(
                              (item) =>
                                `${entries.find((entry) => entry.id === item.id)?.path ?? item.id}：${t(item.error)}`
                            )
                            .join('\n')
                        );
                    });
                  }}
                  type="button"
                >
                  <Trash2Icon aria-hidden="true" className="size-4" />
                  {t('确认彻底删除')}
                </button>
              </div>
            </div>
          )}
          {!busy && !error && !entries.length && (
            <div className="flex flex-col items-center rounded-lg border border-stone-200 border-dashed px-4 py-10 text-center">
              <Trash2Icon
                aria-hidden="true"
                className="mb-3 size-8 text-stone-400"
              />
              <p className="font-medium text-sm">{t('垃圾箱为空')}</p>
              <p className="mt-1 text-stone-500 text-xs">
                {t('移到垃圾箱的 Markdown 文档会显示在这里。')}
              </p>
            </div>
          )}
          <div className="space-y-3">
            {entries.map((entry) => (
              <article
                className="overflow-hidden rounded-lg border border-stone-200"
                key={entry.id}
              >
                <div className="flex items-start gap-3 p-4">
                  <span className="rounded-md bg-stone-100 p-2 text-stone-500">
                    <FileTextIcon aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0 space-y-1.5">
                    <h3 className="break-all font-medium text-sm">
                      {entry.path.split('/').pop()}
                    </h3>
                    <p className="break-all text-stone-500 text-xs">
                      {t('原路径：')}
                      {entry.path}
                    </p>
                    <p className="flex items-start gap-1.5 text-stone-500 text-xs">
                      <Clock3Icon
                        aria-hidden="true"
                        className="size-3.5 shrink-0"
                      />
                      <span>
                        {t('删除于')}{' '}
                        {new Date(entry.deletedAt).toLocaleString(locale)}
                      </span>
                    </p>
                    {entry.assets && (
                      <p className="flex items-center gap-1.5 text-stone-500 text-xs">
                        <FolderIcon aria-hidden="true" className="size-3.5" />
                        {t('包含文档专属资源')}
                      </p>
                    )}
                    {entry.state === 'deleting' && (
                      <p className="text-amber-700 text-xs">
                        {t('删除未完成，请重试彻底删除。')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-stone-200 border-t bg-stone-50/60 px-4 py-2.5">
                  <button
                    className="ws-button bg-background"
                    disabled={busy || entry.state === 'deleting'}
                    onClick={() =>
                      void perform(async () => {
                        if (!(await controller.restoreTrash(entry.id)))
                          throw new Error(controller.error || '恢复失败。');
                      })
                    }
                    type="button"
                  >
                    <RotateCcwIcon aria-hidden="true" className="size-4" />
                    {t('恢复')}
                  </button>
                  <button
                    className="ws-button ws-trash-danger"
                    disabled={busy}
                    onClick={() => setConfirmation([entry.id])}
                    type="button"
                  >
                    <Trash2Icon aria-hidden="true" className="size-4" />
                    {t('彻底删除')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
