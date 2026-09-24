'use client';

import { XIcon } from 'lucide-react';
import { useState } from 'react';
import { useInterface, useT } from '@/features/workspace/ui/interface-provider';
import type { WritingModel } from '@/features/workspace/writing/writing';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
import { setWritingGoal } from './writing-preferences';
export function Outline({
  open,
  model,
  active,
  onJump,
  onClose,
}: {
  open: boolean;
  model: WritingModel;
  active?: string;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const headings = model.headings();
  return (
    <aside
      aria-hidden={!open || undefined}
      aria-label={t('文档大纲')}
      className="ws-outline"
      data-open={open}
      inert={!open}
    >
      <div className="flex items-center justify-between border-b px-4 py-2 font-medium text-sm">
        {t('文档大纲')}
        <button
          aria-label={t('收起文档大纲')}
          className="ws-icon-button"
          onClick={onClose}
          type="button"
        >
          <XIcon />
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-auto px-2 py-3">
        {headings.length ? (
          headings.map((h) => (
            <button
              aria-current={active === h.id ? 'location' : undefined}
              className="ws-outline-item"
              key={h.id}
              onClick={() => onJump(h.id)}
              onMouseDown={(event) => event.preventDefault()}
              style={{ paddingLeft: 10 + (h.level - 1) * 12 }}
              title={h.text || t('未命名标题')}
              type="button"
            >
              {h.text || t('未命名标题')}
            </button>
          ))
        ) : (
          <p className="p-3 text-stone-400 text-xs">
            {t('添加标题后，这里会显示文档结构。')}
          </p>
        )}
      </nav>
    </aside>
  );
}
export function WritingStats({
  words,
  selected,
  root,
  path,
  goal,
}: {
  words: number;
  selected: number;
  root: string;
  path: string;
  goal?: number;
}) {
  const t = useT();
  const { showWords, showReadingTime, showWritingGoal } = useInterface();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const reading =
    words === 0
      ? t('0 分钟')
      : words < 400
        ? t('不到 1 分钟')
        : t('{0} 分钟', [Math.ceil(words / 400)]);
  const save = (next?: number) => {
    if (setWritingGoal(root, path, next)) setOpen(false);
    else setError('目标已在本次会话生效，但浏览器未允许持久保存。');
  };
  if (!showWords && !showReadingTime && !showWritingGoal) return null;
  return (
    <>
      <footer aria-label={t('写作统计')} className="ws-writing-stats">
        {showWords && (
          <span>
            {words.toLocaleString()} {t('字')}
          </span>
        )}
        {showWords && selected > 0 && (
          <span>
            {t('选中')}
            {selected.toLocaleString()} {t('字')}
          </span>
        )}
        {showReadingTime && (
          <span className="ws-reading-time">
            {t('预计阅读')}
            {reading}
          </span>
        )}
        {showWritingGoal && (
          <button
            className="ml-auto truncate"
            onClick={() => {
              setValue(goal?.toString() ?? '');
              setError('');
              setOpen(true);
            }}
            type="button"
          >
            {goal
              ? t('目标 {0} / {1} 字 · {2}%', [
                  words.toLocaleString(),
                  goal.toLocaleString(),
                  Math.floor((words / goal) * 100),
                ])
              : t('设置写作目标')}
          </button>
        )}
        {showWritingGoal && goal && (
          <progress
            aria-label={t('写作目标进度')}
            className="w-16"
            max={goal}
            value={Math.min(words, goal)}
          />
        )}
      </footer>
      {showWritingGoal && open && (
        <Dialog onOpenChange={setOpen} open>
          <DialogContent>
            <DialogTitle>{t('文档目标字数')}</DialogTitle>
            <DialogDescription>
              {t(
                '目标仅保存在本浏览器，不写入 Markdown。中文按字，英文和数字按词统计。'
              )}
            </DialogDescription>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const next = Number(value);
                if (!Number.isSafeInteger(next) || next <= 0)
                  setError('请输入大于零的整数。');
                else save(next);
              }}
            >
              <label className="block text-sm">
                {t('目标字数')}
                <input
                  autoFocus
                  className="ws-input mt-2 w-full"
                  inputMode="numeric"
                  min="1"
                  onChange={(event) => setValue(event.target.value)}
                  step="1"
                  type="number"
                  value={value}
                />
              </label>
              {error && (
                <p className="my-2 text-amber-700 text-sm" role="alert">
                  {t(error)}
                </p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="ws-button"
                  onClick={() => save()}
                  type="button"
                >
                  {t('清除目标')}
                </button>
                <button className="ws-button ws-button-primary" type="submit">
                  {t('保存目标')}
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
