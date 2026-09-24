import { reportAuthentication } from '@/features/auth/ui/session-expiry';
import type { OpenProgress, ScanOptions } from './open-progress';
import { WorkspaceError } from './types';

const stages = new Set([
  'saving',
  'waiting',
  'checking',
  'recovering',
  'tree',
  'document',
]);
export async function readProgressResponse<T>(
  response: Response,
  options: ScanOptions
): Promise<T> {
  reportAuthentication(response.status);
  if (!response.ok) {
    const result = await response.json();
    throw new WorkspaceError(result.error || '文件操作失败。', response.status);
  }
  const interrupted = () =>
    new WorkspaceError('打开进度连接中断，请重试。', 502);
  if (
    !response.headers.get('content-type')?.startsWith('application/x-ndjson') ||
    !response.body
  )
    throw interrupted();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      while (buffer.includes('\n')) {
        const boundary = buffer.indexOf('\n');
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        let event: {
          type?: string;
          value?: T;
          error?: string;
          status?: number;
          progress?: OpenProgress;
        };
        try {
          event = JSON.parse(line);
        } catch {
          throw interrupted();
        }
        if (!event || typeof event !== 'object') throw interrupted();
        if (event.type === 'result' && 'value' in event) {
          options.signal?.throwIfAborted();
          return event.value as T;
        }
        if (
          event.type === 'error' &&
          typeof event.error === 'string' &&
          typeof event.status === 'number'
        ) {
          reportAuthentication(event.status);
          throw new WorkspaceError(event.error, event.status);
        }
        if (event.type === 'progress') {
          const p = event.progress;
          if (
            !p ||
            !stages.has(p.stage) ||
            typeof p.cancellable !== 'boolean' ||
            (p.entries !== undefined &&
              (!Number.isSafeInteger(p.entries) || p.entries < 0))
          )
            throw interrupted();
          options.onProgress?.(p);
        } else if (event.type !== 'heartbeat') throw interrupted();
      }
      if (next.done) throw interrupted();
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function progressRequest<T>(
  operation: 'open' | 'tree',
  data: Record<string, string>,
  options: ScanOptions
) {
  const get = operation === 'tree';
  const response = await fetch(
    get
      ? `/api/workspace?${new URLSearchParams({ operation, ...data })}`
      : '/api/workspace',
    {
      method: get ? 'GET' : 'POST',
      cache: 'no-store',
      signal: options.signal,
      headers: {
        Accept: 'application/x-ndjson',
        ...(!get && { 'Content-Type': 'application/json' }),
      },
      ...(!get && { body: JSON.stringify({ operation, ...data }) }),
    }
  );
  return readProgressResponse<T>(response, options);
}
