'use client';

import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react';
import type { PlateEditor } from 'platejs/react';
import { useEffect, useRef, useState } from 'react';
import {
  editorMatches,
  type SearchTarget,
} from '@/features/workspace/editor/editor-search';
import { useT } from '@/features/workspace/ui/interface-provider';
import { replaceMatches } from '@/features/workspace/writing/writing';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
export function ReplaceBar({
  editor,
  search,
  count,
  current,
  locked,
  onSearch,
  onChanged,
}: {
  editor: PlateEditor;
  search: SearchTarget;
  count: number;
  current: number;
  locked: boolean;
  onSearch: (search?: SearchTarget) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [replacement, setReplacement] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [composing, setComposing] = useState(false);
  const queryInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // React autoFocus runs during commit, while Slate's DOM refs may be detached.
    // Wait until the editor is mounted before blurring it into the search field.
    const frame = requestAnimationFrame(() => queryInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const disabled = locked || composing || !count || !search.query;
  const apply = (all: boolean) => {
    if (disabled) return;
    const index = Math.min(
      current,
      Math.max(
        0,
        editorMatches(editor, search.query, Number.POSITIVE_INFINITY).length - 1
      )
    );
    const n = replaceMatches(editor, search.query, replacement, all, index);
    setConfirm(false);
    setMessage(t('已替换 {0} 处', [n]));
    onChanged();
    onSearch({ ...search, index: all ? 0 : index, nonce: search.nonce + 1 });
  };
  return (
    <section
      aria-label={t('查找与替换')}
      className="ws-replace-bar"
      onCompositionEnd={() => setComposing(false)}
      onCompositionStart={() => setComposing(true)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          onSearch(undefined);
        }
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input
          aria-label={t('查找文字')}
          className="ws-input min-w-0 flex-1"
          onChange={(event) =>
            onSearch({
              ...search,
              query: event.target.value,
              index: 0,
              nonce: search.nonce + 1,
            })
          }
          ref={queryInput}
          value={search.query}
        />
        <span aria-live="polite" className="text-xs">
          {count ? `${current + 1} / ${count}` : t('无匹配')}
        </span>
        {([-1, 1] as const).map((step) => (
          <button
            aria-label={step < 0 ? t('上一处匹配') : t('下一处匹配')}
            className="ws-icon-button"
            disabled={!count || composing}
            key={step}
            onClick={() =>
              onSearch({
                ...search,
                index: (current + step + count) % count,
                nonce: search.nonce + 1,
              })
            }
            type="button"
          >
            {step < 0 ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>
        ))}
        <button
          aria-label={t('关闭查找与替换')}
          className="ws-icon-button"
          onClick={() => onSearch(undefined)}
          type="button"
        >
          <XIcon />
        </button>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
        <input
          aria-label={t('替换为')}
          className="ws-input min-w-0 flex-1"
          onChange={(event) => setReplacement(event.target.value)}
          placeholder={t('替换为（留空即删除匹配文字）')}
          value={replacement}
        />
        <button
          className="ws-button"
          disabled={disabled}
          onClick={() => apply(false)}
          type="button"
        >
          {t('替换')}
        </button>
        <button
          className="ws-button"
          disabled={disabled}
          onClick={() => setConfirm(true)}
          type="button"
        >
          {t('全部替换')}
        </button>
        <span className="text-stone-500 text-xs" role="status">
          {t(message)}
        </span>
      </div>
      {confirm && (
        <Dialog onOpenChange={setConfirm} open>
          <DialogContent>
            <DialogTitle>{t('全部替换')}</DialogTitle>
            <DialogDescription>
              {t('将在当前文档中替换')}
              {count} {t('处匹配，包含折叠章节。替换结果可一次撤销。')}
            </DialogDescription>
            <div className="flex justify-end gap-2">
              <button
                className="ws-button"
                onClick={() => setConfirm(false)}
                type="button"
              >
                {t('取消')}
              </button>
              <button
                className="ws-button ws-button-primary"
                disabled={disabled}
                onClick={() => apply(true)}
                type="button"
              >
                {t('确认替换')}
                {count} {t('处')}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
