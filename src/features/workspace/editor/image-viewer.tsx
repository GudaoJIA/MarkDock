'use client';

import { MaximizeIcon, MinusIcon, PlusIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useT } from '@/features/workspace/ui/interface-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
export function ImageViewer({
  source,
  alt,
  onClose,
  actions,
  restoreFocus,
}: {
  source: string;
  alt: string;
  onClose: () => void;
  actions?: ReactNode;
  restoreFocus?: () => void;
}) {
  const t = useT();
  const [view, setView] = useState<HTMLDivElement | null>(null);
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 600, height: 400 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!view) return;
    const observer = new ResizeObserver(([entry]) =>
      setBounds({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    );
    observer.observe(view);
    return () => observer.disconnect();
  }, [view]);
  const fit = size.width
    ? Math.min(
        1,
        (bounds.width - 24) / size.width,
        (bounds.height - 24) / size.height
      )
    : 1;
  const scale = zoom ?? fit;
  const resize = (value: number | null) => {
    setZoom(value);
    setOffset({ x: 0, y: 0 });
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent
        className="ws-image-viewer"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus?.();
        }}
      >
        <DialogTitle>{t('查看图片')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('仅调整查看比例，不改变文档中的图片。放大后可拖动平移。')}
        </DialogDescription>
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <button
            className="ws-button"
            disabled={!size.width || failed}
            onClick={() => resize(null)}
            type="button"
          >
            <MaximizeIcon />
            {t('适应窗口')}
          </button>
          <button
            className="ws-button"
            disabled={!size.width || failed}
            onClick={() => resize(1)}
            type="button"
          >
            {t('原始尺寸')}
          </button>
          <button
            aria-label={t('缩小图片')}
            className="ws-icon-button"
            disabled={!size.width || failed}
            onClick={() => setZoom(Math.max(0.01, scale / 1.25))}
            type="button"
          >
            <MinusIcon />
          </button>
          <span aria-live="polite" className="text-xs">
            {Math.round(scale * 100)}%
          </span>
          <button
            aria-label={t('放大图片')}
            className="ws-icon-button"
            disabled={!size.width || failed}
            onClick={() => setZoom(Math.min(8, scale * 1.25))}
            type="button"
          >
            <PlusIcon />
          </button>
        </div>
        <div
          className="ws-image-canvas"
          onLostPointerCapture={() => {
            pan.current = null;
          }}
          onPointerCancel={() => {
            pan.current = null;
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            pan.current = {
              x: event.clientX,
              y: event.clientY,
              left: offset.x,
              top: offset.y,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = pan.current;
            if (start)
              setOffset({
                x: start.left + event.clientX - start.x,
                y: start.top + event.clientY - start.y,
              });
          }}
          onPointerUp={(event) => {
            pan.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          ref={setView}
        >
          {failed ? (
            <div>
              <p role="alert">{t('图片加载失败，请检查文件或网络。')}</p>
              <button
                className="ws-button"
                onClick={() => setFailed(false)}
                type="button"
              >
                {t('重试')}
              </button>
            </div>
          ) : (
            <img
              alt={alt}
              draggable={false}
              onError={() => setFailed(true)}
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              src={source}
              style={{
                width: size.width || undefined,
                height: size.height || undefined,
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              }}
            />
          )}
        </div>
        {actions}
      </DialogContent>
    </Dialog>
  );
}
