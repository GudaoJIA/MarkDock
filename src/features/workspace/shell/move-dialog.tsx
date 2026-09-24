'use client';

import { useState } from 'react';
import type { TreeEntry } from '@/features/workspace/shared/types';
import { useT } from '@/features/workspace/ui/interface-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
export function MoveDialog({
  source,
  entries,
  busy,
  error,
  onMove,
  onClose,
}: {
  source: string;
  entries: TreeEntry[];
  busy: boolean;
  error: string;
  onMove: (parent: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const [parent, setParent] = useState(
    source.split('/').slice(0, -1).join('/')
  );
  const folders: string[] = [];
  const walk = (nodes: TreeEntry[]) => {
    for (const node of nodes)
      if (node.kind === 'directory' && !node.resource) {
        folders.push(node.path);
        walk(node.children ?? []);
      }
  };
  walk(entries);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      open
    >
      <DialogContent className="max-w-md">
        <DialogTitle>{t('移动文档')}</DialogTitle>
        <DialogDescription>
          {t('文档及其资源文件夹将一起移动。')}
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onMove(parent)) onClose();
          }}
        >
          <p className="break-all text-sm text-stone-500">{source}</p>
          <label className="block space-y-2 text-sm">
            <span>{t('目标文件夹')}</span>
            <select
              className="ws-input w-full"
              disabled={busy}
              onChange={(e) => setParent(e.target.value)}
              value={parent}
            >
              <option value="">{t('工作区根目录')}</option>
              {folders.map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="text-amber-700 text-sm" role="alert">
              {t(error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              className="ws-button"
              disabled={busy}
              onClick={onClose}
              type="button"
            >
              {t('取消')}
            </button>
            <button className="ws-button" disabled={busy} type="submit">
              {busy ? t('正在移动…') : t('移动')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
