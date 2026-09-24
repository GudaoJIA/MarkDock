'use client';
import { useState, useSyncExternalStore } from 'react';
import {
  defaultHistoryLimits,
  historyPresets,
  MiB,
  validHistoryLimits,
} from '../shared/history-settings';
import type { EditableDocument } from '../state/editable-document';
import type { HistoryBudget } from '../state/history-budget';
import { useInterface, useT } from '../ui/interface-provider';
export function HistorySettings({
  history,
  document,
}: {
  history: HistoryBudget;
  document?: EditableDocument;
}) {
  const preferences = useInterface();
  const t = useT();
  const [input, setInput] = useState(preferences.history);
  const [error, setError] = useState('');
  useSyncExternalStore(history.subscribe, history.snapshot, history.snapshot);
  const stats = document?.historyStats ?? { undo: 0, redo: 0, bytes: 0 };
  return (
    <section className="space-y-5">
      <h2 className="font-medium">{t('撤销历史')}</h2>
      <div className="flex flex-wrap gap-2">
        {historyPresets.map((p) => (
          <button
            className="ws-button"
            key={p.label}
            onClick={() => {
              setInput({ ...p.limits });
              setError('');
            }}
            type="button"
          >
            {t(p.label)}
          </button>
        ))}
      </div>
      {(
        [
          ['batches', '每篇最多保留批次', 20, 1000],
          ['documentMiB', '每篇历史预算（MiB）', 4, 64],
          ['pageMiB', '页面历史总预算（MiB）', 16, 256],
        ] as const
      ).map(([key, label, min, max]) => (
        <label
          className="flex flex-wrap items-center justify-between gap-3 text-sm"
          key={key}
        >
          {t(label)}
          <input
            className="ws-input w-32"
            max={max}
            min={min}
            onChange={(e) =>
              setInput({
                ...input,
                [key]:
                  e.target.value === '' ? Number.NaN : Number(e.target.value),
              })
            }
            step="1"
            type="number"
            value={Number.isNaN(input[key]) ? '' : input[key]}
          />
        </label>
      ))}
      <p className="text-stone-500 text-xs">
        {t(
          '降低限制会淘汰最早的历史，无法恢复；正文和已保存文件不受影响。单篇预算不能超过页面预算。'
        )}
      </p>
      {error && (
        <p className="text-amber-700 text-sm" role="alert">
          {t(error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          className="ws-button"
          onClick={() => {
            setInput({ ...defaultHistoryLimits });
            setError('');
          }}
          type="button"
        >
          {t('恢复默认')}
        </button>
        <button
          className="ws-button ws-button-primary"
          onClick={() => {
            if (!validHistoryLimits(input)) {
              setError('请输入范围内的整数，且单篇预算不能超过页面预算。');
              return;
            }
            preferences.update({ history: { ...input } });
            setError('');
          }}
          type="button"
        >
          {t('应用')}
        </button>
      </div>
      <section
        aria-label={t('编辑历史估算占用')}
        className="space-y-3 rounded-lg border border-stone-200 p-4"
      >
        <h3 className="font-medium text-sm">{t('编辑历史估算占用')}</h3>
        <p className="text-sm">
          {t('当前文档：撤销 {0} 批次，重做 {1} 批次', [
            stats.undo,
            stats.redo,
          ])}
        </p>
        {[
          [t('当前文档'), stats.bytes, preferences.history.documentMiB],
          [t('当前页面全部文档'), history.bytes, preferences.history.pageMiB],
        ].map(([label, bytes, max]) => (
          <div className="space-y-1" key={String(label)}>
            <div className="flex justify-between gap-2 text-xs">
              <span>{label}</span>
              <span>
                {(Number(bytes) / MiB).toFixed(2)} / {max} MiB
              </span>
            </div>
            <progress
              aria-label={String(label)}
              className="h-2 w-full"
              max={Number(max) * MiB}
              value={Math.min(Number(bytes), Number(max) * MiB)}
            />
          </div>
        ))}
        <p className="text-stone-500 text-xs">
          {t(
            '按历史文本的 UTF-16 大小估算，包含撤销和重做；不包含图片、编辑器节点及浏览器其他内存。'
          )}
        </p>
        {document?.historyNotice && (
          <p className="text-amber-700 text-xs" role="status">
            {t(document.historyNotice)}
          </p>
        )}
      </section>
    </section>
  );
}
