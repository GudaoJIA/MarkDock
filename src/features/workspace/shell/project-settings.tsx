'use client';

import { FolderCogIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/features/workspace/ui/interface-provider';
import type { WorkspaceEditor } from '../editor/editor-kit';
import { fileClient } from '../shared/client';
import type {
  SettingsInput,
  SettingsSnapshot,
} from '../shared/resource-policy';
import type { WorkspaceController } from '../state/sessions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
import { ResourceRuleForm } from './resource-rule-form';

export function ProjectSettings({
  controller,
  onClose,
}: {
  controller: WorkspaceController<WorkspaceEditor>;
  onClose: () => void;
}) {
  const t = useT();
  const id = controller.workspace!.id;
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [input, setInput] = useState<SettingsInput>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void fileClient
      .settings(id)
      .then((value) => {
        if (alive) {
          setSnapshot(value);
          setInput({
            resources: value.settings.resources,
          });
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  const update = (next: SettingsInput) => {
    setInput(next);
    setError('');
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      open
    >
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <div className="space-y-3 border-stone-200 border-b p-5 pr-12 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <FolderCogIcon className="size-5" />
            {t('工作区设置')}
          </DialogTitle>
          <DialogDescription className="break-all text-xs">
            {t('工作区根目录')}：{controller.workspace!.root}
          </DialogDescription>
        </div>
        <div className="min-h-0 space-y-5 overflow-y-auto p-5 sm:p-6">
          {input ? (
            <ResourceRuleForm
              disabled={busy}
              onChange={(resources) => update({ ...input, resources })}
              rule={input.resources}
            />
          ) : (
            !error && <p role="status">{t('正在读取设置…')}</p>
          )}
          {error && (
            <p className="break-words text-red-700 text-sm" role="alert">
              {t(error)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-stone-200 border-t p-4 sm:px-6">
          <span className="mr-auto text-stone-500 text-xs">
            {t('仅影响后续上传')}
          </span>
          <button
            className="ws-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            {t('取消')}
          </button>
          <button
            className="ws-button ws-button-primary"
            disabled={!input || !snapshot || busy || controller.busy}
            onClick={() => {
              if (!input || !snapshot) return;
              setBusy(true);
              void controller
                .saveSettings(input, snapshot.revision)
                .then((ok) => {
                  if (ok) onClose();
                  else setError(controller.error || '保存失败');
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
            type="button"
          >
            {t(busy ? '保存中…' : '保存设置')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
