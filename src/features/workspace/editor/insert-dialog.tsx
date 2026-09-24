'use client';
import { useT } from '@/features/workspace/ui/interface-provider';

const FILE_EXTENSION = /\.[^.]+$/;
const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|\/)/i;
const HTTP_URL = /^https?:\/\//i;

import { unwrapLink } from '@platejs/link';
import { ImageIcon, UploadIcon } from 'lucide-react';
import { NodeApi, type PathRef, type RangeRef, type TRange } from 'platejs';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { imageSource } from '@/features/workspace/shared/markdown';
import type {
  DocumentSession,
  WorkspaceController,
} from '@/features/workspace/state/sessions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
import { insertWorkspaceBlock } from './commands';
import type { WorkspaceEditor } from './editor-kit';
import { uploadImageFile } from './image-upload';
import { editWorkspaceLink } from './link-edit';

export type InsertAction = {
  kind: 'link' | 'image';
  selection: TRange | null;
  file?: File;
};

export function InsertDialog({
  action,
  doc,
  controller,
  onClose,
}: {
  action: InsertAction;
  doc: DocumentSession<WorkspaceEditor>;
  controller: WorkspaceController<WorkspaceEditor>;
  onClose: () => void;
}) {
  const t = useT();
  const editor = doc.editor;
  const range = useRef<RangeRef | null>(null);
  const [link] = useState(() =>
    editor.api.node({
      match: { type: 'a' },
      at: action.selection ?? undefined,
    })
  );
  const linkTarget = useRef<PathRef | null>(null);
  const [url, setURL] = useState(
    action.kind === 'link' ? String(link?.[0].url ?? '') : ''
  );
  const [label, setLabel] = useState(
    action.kind === 'link'
      ? link
        ? NodeApi.string(link[0])
        : action.selection
          ? editor.api.string(action.selection)
          : ''
      : ''
  );
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [file, setFile] = useState<File | undefined>(action.file);
  const transfer = useRef<AbortController | null>(null);
  const release = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const started = useRef(false);
  useEffect(() => {
    mounted.current = true;
    linkTarget.current =
      action.kind === 'link' && link ? editor.api.pathRef(link[1]) : null;
    range.current = action.selection
      ? editor.api.rangeRef(action.selection)
      : null;
    return () => {
      mounted.current = false;
      transfer.current?.abort();
      release.current?.();
      range.current?.unref();
      linkTarget.current?.unref();
    };
  }, [action.selection, action.kind, editor, link]);
  const restore = () => {
    const selection = range.current?.current;
    if (selection) editor.tf.select(selection);
    else editor.tf.select(editor.api.end([])!);
  };
  const insertImage = (source: string, alt: string) => {
    editor.tf.withNewBatch(() => {
      restore();
      insertWorkspaceBlock(editor, {
        type: 'img',
        url: source,
        caption: [{ text: alt }],
        children: [{ text: '' }],
      });
    });
    controller.changed(doc);
    onClose();
    requestAnimationFrame(() => editor.tf.focus());
  };
  const upload = async (chosen: File) => {
    if (progress !== null) return;
    if (chosen.size > 20 * 1024 * 1024) {
      setError('图片不能超过 20 MB。');
      return;
    }
    const finish = controller.beginTask(doc);
    if (!finish) {
      setError('请先完成当前输入或操作。');
      return;
    }
    release.current = finish;
    setFile(chosen);
    setError('');
    setProgress(0);
    const xhr = new AbortController();
    transfer.current = xhr;
    try {
      const result = await uploadImageFile({
        file: chosen,
        workspace: controller.workspace!.id,
        revision: controller.workspace!.settings?.revision,
        path: doc.path,
        signal: xhr.signal,
        onProgress: (value) => {
          if (mounted.current) setProgress(value);
        },
      });
      finish();
      release.current = null;
      if (mounted.current && transfer.current === xhr)
        insertImage(
          result.url,
          label || chosen.name.replace(FILE_EXTENSION, '')
        );
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : '上传失败。');
    } finally {
      finish();
      release.current = null;
      if (mounted.current) setProgress(null);
    }
  };
  const autoUpload = useEffectEvent(upload);
  useEffect(() => {
    if (action.file)
      queueMicrotask(() => {
        if (mounted.current && !started.current) {
          started.current = true;
          void autoUpload(action.file!);
        }
      });
  }, [action.file]);
  const close = () => {
    transfer.current?.abort();
    release.current?.();
    onClose();
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) close();
      }}
      open
    >
      <DialogContent
        className="ws-popover max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => editor.tf.focus());
        }}
      >
        <DialogTitle>
          {action.kind === 'link'
            ? t(link ? '编辑链接' : '插入链接')
            : t('插入图片')}
        </DialogTitle>
        <DialogDescription>
          {action.kind === 'link'
            ? link
              ? t('填写链接地址，可修改文字或移除链接。')
              : t('填写链接地址和显示文字。')
            : t('选择或粘贴的图片按当前工作区资源设置保存。')}
        </DialogDescription>
        <label className="grid gap-2 text-sm">
          {action.kind === 'link' ? t('显示文字') : t('替代文字')}
          <input
            aria-label={
              action.kind === 'link' ? t('链接文字') : t('图片替代文字')
            }
            className="ws-input"
            disabled={progress !== null}
            onChange={(event) => setLabel(event.target.value)}
            value={label}
          />
        </label>
        {action.kind === 'image' && (
          <>
            <label className="ws-upload-area">
              <UploadIcon />
              <span>{t('选择本地图片')}</span>
              <input
                accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
                aria-label={t('选择本地图片')}
                disabled={progress !== null}
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen) void upload(chosen);
                }}
                type="file"
              />
            </label>
            {progress !== null && (
              <div className="space-y-2 text-sm" role="status">
                <p>
                  {progress < 100
                    ? t('正在上传 {0}%', [progress])
                    : t('正在保存图片…')}
                </p>
                <progress className="w-full" max={100} value={progress} />
                <button
                  className="ws-button"
                  onClick={() => transfer.current?.abort()}
                  type="button"
                >
                  {t('取消上传')}
                </button>
              </div>
            )}
          </>
        )}
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            if (action.kind === 'image') {
              if (ABSOLUTE_URL.test(url) && !HTTP_URL.test(url)) {
                setError('请使用工作区相对路径或 HTTP(S) 图片地址。');
                return;
              }
              if (!url.trim()) return;
              if (
                !imageSource(
                  controller.workspace!.id,
                  doc.path,
                  url.trim(),
                  controller.workspace!.settings?.settings
                )
              ) {
                setError('图片路径超出了当前工作区。');
                return;
              }
              insertImage(url.trim(), label);
            } else {
              if (
                controller.active !== doc ||
                controller.busy ||
                doc.composing ||
                ['error', 'conflict'].includes(doc.state)
              ) {
                setError('链接目标已失效，请重新选择文字或链接。');
                return;
              }
              const issue = editWorkspaceLink(
                editor,
                range.current?.current,
                url,
                label,
                link ? (linkTarget.current?.current ?? null) : undefined
              );
              if (issue) {
                setError(issue);
                return;
              }
              controller.changed(doc);
              onClose();
            }
          }}
        >
          <label className="grid gap-2 text-sm">
            {action.kind === 'link' ? t('链接地址') : t('或填写已有图片地址')}
            <input
              aria-label={
                action.kind === 'link' ? t('链接地址') : t('图片地址')
              }
              className="ws-input"
              disabled={progress !== null}
              onChange={(event) => setURL(event.target.value)}
              placeholder={
                action.kind === 'link'
                  ? 'https://…'
                  : t('assets/example.png 或 https://…')
              }
              value={url}
            />
          </label>
          {error && (
            <p className="text-amber-700 text-sm" role="alert">
              {t(error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {action.kind === 'link' && link && (
              <button
                className="ws-button mr-auto"
                onClick={() => {
                  const target = linkTarget.current?.current;
                  if (
                    controller.active !== doc ||
                    controller.busy ||
                    doc.composing ||
                    ['error', 'conflict'].includes(doc.state) ||
                    !target ||
                    NodeApi.get(editor, target)?.type !== 'a'
                  ) {
                    setError('链接目标已失效，请重新选择文字或链接。');
                    return;
                  }
                  editor.tf.select(editor.api.range(target)!);
                  editor.tf.withNewBatch(() => unwrapLink(editor));
                  controller.changed(doc);
                  onClose();
                }}
                type="button"
              >
                {t('移除链接')}
              </button>
            )}
            {action.kind === 'image' && file && error && progress === null && (
              <button
                className="ws-button mr-auto"
                onClick={() => void upload(file)}
                type="button"
              >
                {t('重试上传')}
              </button>
            )}
            <button className="ws-button" onClick={close} type="button">
              {t('取消')}
            </button>
            <button
              className="ws-button ws-button-primary"
              disabled={!url.trim() || progress !== null}
              type="submit"
            >
              {action.kind === 'link' ? (
                t(link ? '保存链接' : '插入链接')
              ) : (
                <>
                  <ImageIcon />
                  {t('插入链接图片')}
                </>
              )}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
