import type { ProgressEvent, ScanOptions } from '../shared/open-progress';

/** A request-local stream. Disconnect stops reads, never an in-flight recovery write. */
export function progressResponse<T>(
  request: Request,
  action: (options: ScanOptions) => Promise<T>,
  failure: (error: unknown) => Response
) {
  const abort = new AbortController();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval>;
  let lastStage = '';
  let lastSent = 0;
  const disconnect = () => abort.abort();
  request.signal.addEventListener('abort', disconnect, { once: true });
  if (request.signal.aborted) disconnect();
  const cleanup = () => {
    clearInterval(heartbeat);
    request.signal.removeEventListener('abort', disconnect);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ProgressEvent<T>) => {
        if (!closed && !abort.signal.aborted)
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      heartbeat = setInterval(() => send({ type: 'heartbeat' }), 5000);
      void (async () => {
        try {
          abort.signal.throwIfAborted();
          const value = await action({
            signal: abort.signal,
            onProgress(progress) {
              const now = Date.now();
              if (progress.stage !== lastStage || now - lastSent >= 200) {
                lastStage = progress.stage;
                lastSent = now;
                send({ type: 'progress', progress });
              }
            },
          });
          send({ type: 'result', value });
        } catch (error) {
          if (!abort.signal.aborted) {
            const response = failure(error);
            const result = await response.json();
            send({
              type: 'error',
              error: result.error,
              status: response.status,
            });
          }
        } finally {
          cleanup();
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      closed = true;
      abort.abort();
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
