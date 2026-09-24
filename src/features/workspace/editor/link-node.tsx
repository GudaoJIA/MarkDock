'use client';
import { PaperclipIcon } from 'lucide-react';
import { NodeApi, type PathRef, type TLinkElement } from 'platejs';
import { PlateElement, type PlateElementProps } from 'platejs/react';
import { useContext, useEffect, useRef, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { reportAuthentication } from '@/features/auth/ui/session-expiry';
import { attachmentTarget } from '@/features/workspace/shared/attachments';
import { useT } from '@/features/workspace/ui/interface-provider';
import { linkAddress } from '../shared/link-address';
import { WritingContext } from '../writing/writing-context';
import { EditingContext } from './commands';
import { DocumentContext } from './document-context';

function EditableLink(props: PlateElementProps<TLinkElement>) {
  const t = useT();
  const { editor, element } = props;
  const { locked } = useContext(WritingContext);
  const actions = useContext(EditingContext);
  const [open, setOpen] = useState(false);
  const target = useRef<PathRef | null>(null);
  const editing = useRef(false);
  useEffect(
    () => () => {
      target.current?.unref();
    },
    []
  );
  const [wasLocked, setWasLocked] = useState(locked);
  if (wasLocked !== locked) {
    setWasLocked(locked);
    if (locked) setOpen(false);
  }
  const attributes = {
    href: linkAddress(element.url),
    target: '_blank',
    rel: 'noopener noreferrer',
  };
  const locate = () => {
    const path = editor.api.findPath(element);
    if (!path || NodeApi.get(editor, path) !== element) return;
    target.current?.unref();
    editing.current = false;
    target.current = editor.api.pathRef(path);
    return path;
  };
  return (
    <Popover
      onOpenChange={(next) => {
        if (next && (locked || !locate())) return;
        setOpen(next);
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <PlateElement
          {...props}
          as="a"
          attributes={{
            ...props.attributes,
            ...attributes,
            tabIndex: 0,
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.metaKey || event.ctrlKey) {
                const href = attributes.href;
                if (href) window.open(href, '_blank', 'noopener,noreferrer');
              } else if (!locked && locate()) setOpen((value) => !value);
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (!locked && locate()) setOpen(true);
              }
            },
          }}
          className="ws-link"
        >
          {props.children}
        </PlateElement>
      </PopoverTrigger>
      <PopoverContent
        className="ws-popover w-80"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!editing.current && !locked) editor.tf.focus();
        }}
      >
        <p className="mb-2 break-all text-sm">{element.url}</p>
        <button
          disabled={locked}
          onClick={() => {
            const path = target.current?.current;
            if (!path) {
              setOpen(false);
              return;
            }
            editor.tf.select(editor.api.range(path)!);
            editing.current = true;
            actions.link();
            setOpen(false);
          }}
          type="button"
        >
          {t('编辑链接')}
        </button>
        <button
          className="ml-4"
          disabled={locked}
          onClick={() => {
            const path = target.current?.current;
            if (path) {
              const point = editor.api.pointRef(editor.api.start(path)!);
              editor.tf.withNewBatch(() =>
                editor.tf.unwrapNodes({ at: path, match: { type: 'a' } })
              );
              const at = point.unref();
              if (at) editor.tf.select(at);
              editor.tf.focus();
            }
            setOpen(false);
          }}
          type="button"
        >
          {t('移除链接')}
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function WorkspaceLink(props: PlateElementProps<TLinkElement>) {
  const t = useT();
  const context = useContext(DocumentContext);
  const attachment = attachmentTarget(
    context.workspaceId,
    context.path,
    props.element.url,
    context.settings
  );
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  if (!attachment) return <EditableLink {...props} />;
  return (
    <>
      <PlateElement
        {...props}
        as="a"
        attributes={{
          ...props.attributes,
          href: attachment.href,
          download: attachment.name,
          'aria-label': t('下载附件 {0}', [attachment.name]),
          title: t('下载附件：{0}', [attachment.name]),
          onMouseDown: (event) => {
            event.preventDefault();
            event.stopPropagation();
          },
          onClick: async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (downloading) return;
            setDownloading(true);
            setError('');
            try {
              // Check errors without buffering the body; the browser streams the actual download.
              const response = await fetch(attachment.href, {
                method: 'HEAD',
                cache: 'no-store',
              });
              reportAuthentication(response.status);
              if (!response.ok)
                throw new Error(
                  response.status === 404
                    ? '附件不存在，可能已被移动或删除。'
                    : response.status === 401
                      ? '工作区连接已失效，请切换工作区后重试。'
                      : '附件无法下载，请检查文件权限和本机服务。'
                );
              const anchor = document.createElement('a');
              anchor.href = attachment.href;
              anchor.download = attachment.name;
              document.body.append(anchor);
              anchor.click();
              anchor.remove();
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : '附件下载失败。'
              );
            } finally {
              setDownloading(false);
            }
          },
        }}
        className="ws-attachment font-medium underline decoration-stone-300 underline-offset-4"
      >
        <span
          aria-hidden="true"
          className="mr-1 inline-flex align-middle"
          contentEditable={false}
        >
          <PaperclipIcon />
        </span>
        {props.children}
      </PlateElement>
      {downloading && (
        <span
          className="ml-2 text-stone-500 text-xs"
          contentEditable={false}
          role="status"
        >
          {t('正在准备下载…')}
        </span>
      )}
      {error && (
        <span
          className="ml-2 text-amber-700 text-xs"
          contentEditable={false}
          role="alert"
        >
          {t(error)}
        </span>
      )}
    </>
  );
}
