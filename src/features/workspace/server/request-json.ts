import { WorkspaceError } from '../shared/types';

const MAX_JSON_BYTES = 6 * 1024 * 1024;

/** Content-Length is only a hint; enforce the limit while consuming the body. */
export async function readWorkspaceJson(
  request: Request,
  maxBytes = MAX_JSON_BYTES
): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > maxBytes)
    throw new WorkspaceError('请求过大。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing JSON body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    request.signal.throwIfAborted();
    while (true) {
      const next = await reader.read();
      request.signal.throwIfAborted();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new WorkspaceError('请求过大。', 413);
      }
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks, length)));
  } finally {
    request.signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}
