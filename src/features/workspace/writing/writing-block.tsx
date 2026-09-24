'use client';

import { ChevronRightIcon, GripVerticalIcon } from 'lucide-react';
import type { PlateElementProps, RenderNodeWrapper } from 'platejs/react';
import {
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/features/workspace/ui/interface-provider';
import { blockConversionState } from '../editor/block-conversion';
import { BlockFormatMenu } from '../editor/block-format-menu';
import { RAW_BLOCK } from '../shared/raw';
import { observeBlockControlPosition } from './block-control-position';
import { WritingContext } from './writing-context';

export const WritingBlock: RenderNodeWrapper = ({ path }) => {
  if (path.length !== 1) return;
  return (props) => <BlockShell {...props} />;
};
function BlockShell({ children, path, editor, element }: PlateElementProps) {
  const t = useT();
  const { model, locked, flash } = useContext(WritingContext);
  const wrapper = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  useLayoutEffect(() => {
    if (model && wrapper.current)
      return observeBlockControlPosition(wrapper.current);
  }, [model]);
  const gesture = useRef<{
    x: number;
    y: number;
    element: HTMLButtonElement;
    pointer: number;
    value: unknown;
    active: boolean;
  } | null>(null);
  const [drag, setDrag] = useState<{
    x: number;
    y: number;
    target: number;
    line?: { x: number; y: number; width: number };
  } | null>(null);
  const entries = model?.entries();
  const atPath = entries?.[path[0]];
  const entry =
    atPath?.node === element
      ? atPath
      : entries?.find((item) => item.node === element);
  const stop = () => {
    const g = gesture.current;
    gesture.current = null;
    setDrag(null);
    if (g?.element.hasPointerCapture(g.pointer))
      g.element.releasePointerCapture(g.pointer);
  };
  const cancel = useEffectEvent(() => {
    suppressClick.current = true;
    stop();
  });
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    const blur = () => cancel();
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
    };
  }, [dragging]);
  useEffect(
    () => () => {
      const g = gesture.current;
      gesture.current = null;
      if (g?.element.hasPointerCapture(g.pointer))
        g.element.releasePointerCapture(g.pointer);
    },
    []
  );
  if (!model || !entry) return children;
  const hidden = model.hidden(entry.index);
  const targetAt = (x: number, y: number) => {
    const surface = wrapper.current?.closest<HTMLElement>(
      '[data-writing-surface]'
    );
    const bounds = surface?.getBoundingClientRect();
    if (
      !surface ||
      !bounds ||
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    )
      return { target: -1 };
    if (y < bounds.top + 30) surface.scrollTop -= 16;
    if (y > bounds.bottom - 30) surface.scrollTop += 16;
    const nodes = [
      ...surface.querySelectorAll<HTMLElement>('[data-writing-id]'),
    ].filter((n) => n.getClientRects().length);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const r = node.getBoundingClientRect();
      if (y < r.bottom || i === nodes.length - 1) {
        const index = model.index(node.dataset.writingId!);
        const before = y < r.top + r.height / 2;
        const target = before
          ? index
          : model.collapsed.has(node.dataset.writingId!)
            ? model.unit(index).end
            : index + 1;
        return model.canMove(entry.id, target)
          ? {
              target,
              line: { x: r.left, y: before ? r.top : r.bottom, width: r.width },
            }
          : { target: -1 };
      }
    }
    return { target: -1 };
  };
  return (
    <div
      className="ws-writing-block"
      data-nav-target={flash === entry.id || undefined}
      data-section-level={entry.level || undefined}
      data-writing-id={entry.id}
      data-writing-index={entry.index}
      hidden={hidden}
      ref={wrapper}
    >
      <div className="ws-block-controls" contentEditable={false}>
        {!!entry.level && (
          <span aria-hidden="true" className="ws-heading-level">
            H{entry.level}
          </span>
        )}
        {!!entry.level && (
          <button
            aria-expanded={!model.collapsed.has(entry.id)}
            aria-label={t('{0}章节 {1}', [
              model.collapsed.has(entry.id) ? t('展开') : t('折叠'),
              entry.text || t('未命名标题'),
            ])}
            className="ws-icon-button"
            disabled={locked}
            onClick={() => model.toggle(entry.id)}
            onMouseDown={(e) => e.preventDefault()}
            type="button"
          >
            <ChevronRightIcon
              className={model.collapsed.has(entry.id) ? '' : 'rotate-90'}
            />
          </button>
        )}
        <BlockFormatMenu
          editor={editor}
          id={entry.id}
          locked={locked}
          model={model}
          node={entry.node}
        >
          <button
            aria-label={
              blockConversionState(editor, [entry.index]).enabled
                ? t('点击转换格式，拖动正文内容')
                : t('点击块操作菜单')
            }
            className="ws-icon-button ws-body-grip"
            disabled={locked}
            onClick={(event) => {
              if (suppressClick.current) event.preventDefault();
            }}
            onLostPointerCapture={() => {
              if (gesture.current) {
                suppressClick.current = true;
                stop();
              }
            }}
            onPointerCancel={() => {
              suppressClick.current = true;
              stop();
            }}
            onPointerDown={(event) => {
              if (locked || event.button !== 0 || !event.isPrimary) return;
              event.preventDefault();
              suppressClick.current = false;
              gesture.current = {
                x: event.clientX,
                y: event.clientY,
                element: event.currentTarget,
                pointer: event.pointerId,
                value: editor.children,
                active: false,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (element.type === RAW_BLOCK) return;
              const g = gesture.current;
              if (!g || g.pointer !== event.pointerId || locked) return;
              if (
                !g.active &&
                Math.hypot(event.clientX - g.x, event.clientY - g.y) < 6
              )
                return;
              g.active = true;
              suppressClick.current = true;
              setDrag({
                x: event.clientX,
                y: event.clientY,
                ...targetAt(event.clientX, event.clientY),
              });
            }}
            onPointerUp={(event) => {
              const g = gesture.current;
              if (!g) return;
              const target = targetAt(event.clientX, event.clientY).target;
              stop();
              if (
                g.active &&
                !locked &&
                g.value === editor.children &&
                target >= 0
              )
                model.move(entry.id, target);
            }}
            type="button"
          >
            <GripVerticalIcon />
          </button>
        </BlockFormatMenu>
      </div>
      {children}
      {!!entry.level && model.collapsed.has(entry.id) && (
        <button
          className="ws-fold-summary"
          contentEditable={false}
          disabled={locked}
          onClick={() => model.toggle(entry.id)}
          type="button"
        >
          {t('展开章节内容…')}
        </button>
      )}
      {drag &&
        !locked &&
        createPortal(
          <>
            <div
              aria-hidden="true"
              className="ws-popover ws-drag-preview"
              data-drag-preview
              style={{
                left: Math.min(drag.x + 8, window.innerWidth - 232),
                top: drag.y - 18,
                width: 224,
              }}
            >
              <GripVerticalIcon />
              <span className="truncate">{entry.text || t('正文内容')}</span>
            </div>
            {drag.line && (
              <div
                className="ws-body-drop-line"
                style={{
                  left: drag.line.x,
                  top: drag.line.y,
                  width: drag.line.width,
                }}
              />
            )}
          </>,
          document.body
        )}
    </div>
  );
}
