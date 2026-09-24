'use client';

import { FileTextIcon, SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { reportAuthentication } from '@/features/auth/ui/session-expiry';
import {
  editorMatches,
  type SearchTarget,
} from '@/features/workspace/editor/editor-search';
import {
  mergeSearch,
  type SearchResponse,
  type SearchResult,
  textMatches,
} from '@/features/workspace/shared/search';
import type { WorkspaceController } from '@/features/workspace/state/sessions';
import { useT } from '@/features/workspace/ui/interface-provider';
import type { WorkspaceEditor } from '../editor/editor-kit';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';

export function SearchDialog({
  controller,
  onClose,
  onChoose,
}: {
  controller: WorkspaceController<WorkspaceEditor>;
  onClose: () => void;
  onChoose: (target: SearchTarget) => void;
}) {
  'use no memo';
  const t = useT();
  const revision = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot
  );
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('workspace');
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState<SearchResponse>({
    results: [],
    skipped: [],
    truncated: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [composition, setComposition] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const replacing = useRef(false);
  const active = controller.active;
  const needle = scope === 'current' ? query : query.trim();
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      if (composition) return;
      setLoading(true);
      const run = async () => {
        if (!needle) return { results: [], skipped: [], truncated: false };
        if (scope === 'current' && active) {
          const snippets =
            active.document?.mode === 'source'
              ? textMatches(active.serialize(), needle).map((match) =>
                  active
                    .serialize()
                    .slice(Math.max(0, match.start - 30), match.end + 65)
                )
              : editorMatches(active.editor, needle).map(
                  (match) => match.snippet
                );
          return {
            results: snippets.slice(0, 200).map((snippet, matchIndex) => ({
              path: active.path,
              kind: 'content' as const,
              snippet,
              matchIndex,
            })),
            skipped: [],
            truncated: snippets.length > 200,
          };
        }
        const local = [...controller.documents.values()]
          .filter(
            (doc) =>
              doc.state !== 'saved' ||
              doc.composing ||
              doc.document?.mode === 'source'
          )
          .map((doc) => ({
            path: doc.path,
            content: doc.serialize(),
            raw: doc.document?.mode === 'source',
          }));
        const reply = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'search',
            id: controller.workspace!.id,
            query: needle,
            exclude: local.map((doc) => doc.path),
          }),
          signal: abort.signal,
        });
        reportAuthentication(reply.status);
        const data = await reply.json();
        if (!reply.ok) throw new Error(data.error || '搜索失败，请重试。');
        return mergeSearch(data, local, needle);
      };
      void run()
        .then((value) => {
          if (!abort.signal.aborted) {
            setResponse(value);
            setIndex(0);
          }
        })
        .catch((cause) => {
          if (!abort.signal.aborted) setError(cause.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [needle, scope, revision, active, controller, composition]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const choose = async (item: SearchResult) => {
    if (controller.busy) {
      setError('请先等待或取消当前操作。');
      return;
    }
    await controller.select(item.path);
    if (controller.active?.path !== item.path) {
      setError(
        controller.active?.error ||
          controller.error ||
          '文档尚未保存，无法切换。'
      );
      return;
    }
    onChoose({
      path: item.path,
      query: needle,
      index: item.matchIndex,
      nonce: revision,
    });
    onClose();
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent
        className="ws-popover ws-search-dialog max-w-2xl gap-0 p-0"
        onCloseAutoFocus={(event) => {
          if (replacing.current) {
            event.preventDefault();
            return;
          }
          if (
            controller.active &&
            controller.active.document?.mode !== 'source'
          ) {
            event.preventDefault();
            requestAnimationFrame(() => controller.active?.editor.tf.focus());
          }
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || composition) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((old) =>
              Math.max(
                0,
                Math.min(
                  response.results.length - 1,
                  old + (event.key === 'ArrowDown' ? 1 : -1)
                )
              )
            );
          }
          if (
            event.key === 'Enter' &&
            response.results[index] &&
            !loading &&
            needle
          ) {
            event.preventDefault();
            void choose(response.results[index]);
          }
        }}
      >
        <DialogTitle className="px-5 pt-5 text-base">
          {t('查找文档')}
        </DialogTitle>
        <DialogDescription className="px-5 pt-1 text-xs">
          {t('按文件名或文内查找，回车打开并定位')}
        </DialogDescription>
        <div className="mx-5 mt-4 flex items-center gap-2 rounded-md border border-stone-200 px-3">
          <SearchIcon />
          <input
            aria-label={t('搜索文件名或正文')}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
            maxLength={200}
            onChange={(event) => {
              setError('');
              setQuery(event.target.value);
              setResponse({ results: [], skipped: [], truncated: false });
            }}
            onCompositionEnd={() => setComposition(false)}
            onCompositionStart={() => setComposition(true)}
            placeholder={t('搜索文件名或正文…')}
            value={query}
          />
        </div>
        <div className="flex items-center justify-between border-stone-200 border-b px-5 py-3 text-xs">
          <div className="flex gap-1">
            {[
              ['workspace', t('整个工作区')],
              ['current', t('当前文档')],
            ].map(([value, label]) => (
              <button
                aria-pressed={scope === value}
                className="ws-scope"
                disabled={value === 'current' && !active}
                key={value}
                onClick={() => {
                  setError('');
                  setScope(value);
                  setResponse({ results: [], skipped: [], truncated: false });
                }}
                type="button"
              >
                {t(label)}
              </button>
            ))}
          </div>
          <span className="text-stone-500">
            {loading
              ? t('查找中…')
              : needle
                ? `${response.results.length} ${scope === 'current' ? t('处匹配') : t('篇文档')}`
                : ''}
          </span>
        </div>
        <div
          aria-label={t('搜索结果')}
          className="max-h-[45vh] min-h-36 overflow-y-auto p-2"
          ref={list}
          role="listbox"
        >
          {!needle && (
            <p className="p-6 text-center text-sm text-stone-500">
              {t('输入文字开始查找')}
            </p>
          )}
          {needle && !loading && !response.results.length && !error && (
            <p className="p-6 text-center text-sm text-stone-500">
              {t('没有匹配结果')}
            </p>
          )}
          {response.results.map((item, itemIndex) => (
            <button
              aria-selected={index === itemIndex}
              className="ws-search-result w-full rounded-md p-3 text-left"
              key={`${item.path}:${item.matchIndex}`}
              onClick={() => void choose(item)}
              onMouseMove={() => setIndex(itemIndex)}
              role="option"
              type="button"
            >
              <span className="flex items-center gap-2 text-sm">
                <FileTextIcon />
                <span className="font-medium">
                  {item.path.split('/').at(-1)}
                </span>
                <span className="ml-auto text-stone-400 text-xs">
                  {item.kind === 'name' ? t('文件名') : t('正文')}
                </span>
              </span>
              <span className="mt-1 block truncate text-stone-400 text-xs">
                {item.path}
              </span>
              <span className="mt-1 block truncate text-sm text-stone-600">
                {item.snippet}
              </span>
            </button>
          ))}
        </div>
        {error && (
          <p className="px-5 py-2 text-amber-700 text-sm" role="alert">
            {t(error)}
          </p>
        )}
        {response.truncated && (
          <p className="px-5 py-2 text-stone-500 text-xs">
            {t('仅显示前 200 条结果，请缩小查询范围。')}
          </p>
        )}
        {response.skipped.length > 0 && (
          <details className="px-5 py-2 text-amber-700 text-xs">
            <summary>
              {response.skipped.length} {t('个文件未能搜索')}
            </summary>
            {response.skipped.map((item) => (
              <p key={item.path}>
                {item.path}：{item.reason}
              </p>
            ))}
          </details>
        )}
        <div className="border-stone-200 border-t px-5 py-3 text-stone-400 text-xs">
          {t('↑ ↓ 选择 · Enter 打开 · Esc 关闭')}
        </div>
        {scope === 'current' && active && (
          <div className="border-t p-3">
            <button
              className="ws-button"
              disabled={controller.busy || !!active.readOnlyReason}
              onClick={() => {
                replacing.current = true;
                onChoose({
                  path: active.path,
                  query: needle,
                  index: 0,
                  nonce: revision,
                  replace: true,
                });
                onClose();
              }}
              type="button"
            >
              {t('在当前文档中替换…')}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
