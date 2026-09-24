'use client';

import { PaperclipIcon } from 'lucide-react';
import type { RangeRef, TRange } from 'platejs';
import { useEffect, useRef, useState } from 'react';
import { reportAuthentication } from '@/features/auth/ui/session-expiry';
import { MAX_ATTACHMENT_BYTES } from '@/features/workspace/shared/attachments';
import type {
  DocumentSession,
  WorkspaceController,
} from '@/features/workspace/state/sessions';
import { useT } from '@/features/workspace/ui/interface-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
import { insertAttachmentLink } from './attachment-edit';
import type { WorkspaceEditor } from './editor-kit';

export function AttachmentDialog({
  selection,
  controller,
  doc,
  onClose,
}: {
  selection: TRange | null;
  controller: WorkspaceController<WorkspaceEditor>;
  doc: DocumentSession<WorkspaceEditor>;
  onClose: () => void;
}) {
  const t = useT();
  const [file, setFile] = useState<File>();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const uploading = useRef(false);
  const transfer = useRef<XMLHttpRequest | null>(null);
  const release = useRef<(() => void) | null>(null);
  const range = useRef<RangeRef | null>(null);
  const editor = doc.editor;
  useEffect(() => {
    mounted.current = true;
    range.current = selection ? editor.api.rangeRef(selection) : null;
    return () => {
      mounted.current = false;
      transfer.current?.abort();
      release.current?.();
      range.current?.unref();
    };
  }, [editor, selection]);
  const close = () => {
    mounted.current = false;
    transfer.current?.abort();
    release.current?.();
    onClose();
  };
  const upload = async (chosen: File) => {
    if (uploading.current) return;
    setFile(chosen);
    setError('');
    if (chosen.size > MAX_ATTACHMENT_BYTES) {
      setError('附件不能超过 100 MB。');
      return;
    }
    const finish = controller.beginTask(doc);
    if (!finish) {
      setError('请先完成当前输入或操作。');
      return;
    }
    uploading.current = true;
    release.current = finish;
    setProgress(0);
    const xhr = new XMLHttpRequest();
    transfer.current = xhr;
    try {
      const result = await new Promise<{ url: string; name: string }>(
        (resolve, reject) => {
          const query = new URLSearchParams({
            id: controller.workspace!.id,
            path: doc.path,
            name: chosen.name,
            revision: controller.workspace!.settings?.revision ?? '',
          });
          xhr.open('POST', `/api/workspace/attachment?${query}`);
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          xhr.responseType = 'json';
          xhr.upload.onprogress = (event) => {
            if (mounted.current && event.lengthComputable)
              setProgress(Math.round((event.loaded / event.total) * 100));
          };
          xhr.onload = () => {
            reportAuthentication(xhr.status);
            return xhr.status >= 200 && xhr.status < 300
              ? resolve(xhr.response)
              : reject(
                  new Error(xhr.response?.error || '附件上传失败，请重试。')
                );
          };
          xhr.onerror = () =>
            reject(new Error('连接失败，请检查本机服务后重试。'));
          xhr.onabort = () =>
            reject(new Error('已取消上传，可以重试或选择其他文件。'));
          xhr.send(chosen);
        }
      );
      if (
        mounted.current &&
        transfer.current === xhr &&
        controller.active === doc
      ) {
        if (range.current?.current) editor.tf.select(range.current.current);
        insertAttachmentLink(editor, result.url, result.name);
        controller.changed(doc);
        onClose();
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : '附件上传失败。');
    } finally {
      finish();
      release.current = null;
      transfer.current = null;
      uploading.current = false;
      if (mounted.current) setProgress(null);
    }
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) close();
      }}
      open
    >
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => editor.tf.focus());
        }}
      >
        <DialogTitle>{t('插入附件')}</DialogTitle>
        <DialogDescription>
          {t(
            '文件按当前工作区资源设置保存，点击正文链接即可下载。单个文件不超过 100 MB。'
          )}
        </DialogDescription>
        <label className="ws-upload-area">
          <PaperclipIcon />
          <span>{t('选择本地附件')}</span>
          <input
            aria-label={t('选择本地附件')}
            disabled={progress !== null}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = '';
              if (chosen) void upload(chosen);
            }}
            type="file"
          />
        </label>
        {file && (
          <p className="break-all text-sm text-stone-600">
            {file.name} ·{' '}
            {file.size === 0
              ? '0 B'
              : `${(file.size / 1024 / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} MB`}
          </p>
        )}
        {progress !== null && (
          <div className="space-y-2 text-sm" role="status">
            <p>
              {progress < 100
                ? t('正在上传 {0}%', [progress])
                : t('正在保存附件…')}
            </p>
            <progress className="w-full" max={100} value={progress} />
          </div>
        )}
        {error && (
          <p className="text-amber-700 text-sm" role="alert">
            {t(error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {progress === null ? (
            <>
              <button className="ws-button" onClick={close} type="button">
                {t('取消')}
              </button>
              {file && error && (
                <button
                  className="ws-button"
                  onClick={() => void upload(file)}
                  type="button"
                >
                  {t('重试上传')}
                </button>
              )}
            </>
          ) : (
            <button
              className="ws-button"
              onClick={() => transfer.current?.abort()}
              type="button"
            >
              {t('取消上传')}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
