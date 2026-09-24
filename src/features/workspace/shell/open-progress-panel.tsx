'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { OpeningState, OpenStage } from '../shared/open-progress';
import { useT } from '../ui/interface-provider';

const labels: Record<OpenStage, string> = {
  saving: '检查并保存当前草稿',
  waiting: '等待文件操作',
  checking: '检查恢复记录',
  recovering: '恢复未完成操作',
  tree: '加载文档列表',
  document: '打开文档',
};
export function OpenProgressPanel({
  progress,
  onCancel,
}: {
  progress: OpeningState;
  onCancel: () => void;
}) {
  const t = useT();
  const [now, setNow] = useState(progress.startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section
      aria-label={t('正在打开工作区')}
      className="min-w-0 rounded-lg border border-stone-200 bg-stone-50 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm" role="status">
            {t(labels[progress.stage])}
          </p>
          <p
            className="mt-1 truncate text-stone-500 text-xs"
            title={progress.root}
          >
            {progress.root}
          </p>
        </div>
        {progress.cancellable && (
          <Button onClick={onCancel} size="sm" variant="outline">
            {t('取消打开')}
          </Button>
        )}
      </div>
      <div
        aria-label={t(labels[progress.stage])}
        className="my-3 h-1.5 overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
      >
        <div className="ws-opening-progress h-full w-1/3 rounded-full bg-sky-600/60" />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-stone-500 text-xs">
        <span>
          {progress.entries === undefined
            ? t('此阶段暂不可取消，请等待处理完成。')
            : `${t('已检查目录条目')}：${progress.entries.toLocaleString()}`}
        </span>
        <span>
          {t('耗时')}：
          {Math.max(0, Math.floor((now - progress.startedAt) / 1000))} {t('秒')}
        </span>
      </div>
    </section>
  );
}
