import { withAuthentication } from './auth-fixture';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readWorkspaceJson } from '../../src/features/workspace/server/request-json';
import { POST } from '../../src/app/api/workspace/route';

const origin = 'http://127.0.0.1:3000';
const limit = 6 * 1024 * 1024;
function streamed(chunks: Uint8Array[], length?: string) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close(); },
    cancel() { cancelled = true; },
  });
  const request = new Request(`${origin}/api/workspace`, { method: 'POST', body, duplex: 'half', headers: { origin, ...(length === undefined ? {} : {'content-length': length}) } } as RequestInit);
  return {request, cancelled: () => cancelled};
}

test('JSON body limit counts received UTF-8 bytes, including absent and dishonest Content-Length', async () => withAuthentication(async cookie => {
  for (const length of [undefined, '1']) {
    const f = streamed([new Uint8Array(limit), new Uint8Array(1), new Uint8Array(1)], length);
    f.request.headers.set('cookie', cookie);
    assert.equal((await POST(f.request)).status, 413); assert.equal(f.cancelled(), true);
  }
  const bytes = new TextEncoder().encode(JSON.stringify('中'.repeat(limit / 3)));
  assert.ok(bytes.length > limit);
  await assert.rejects(readWorkspaceJson(streamed([bytes]).request), (e: any) => e.status === 413);
  const atLimit = new TextEncoder().encode(JSON.stringify('a'.repeat(limit - 2)));
  assert.equal((await readWorkspaceJson(streamed([atLimit]).request) as string).length, limit - 2);
  const split = new TextEncoder().encode(JSON.stringify({value: '中文'}));
  assert.deepEqual(await readWorkspaceJson(streamed([...split].map(b => new Uint8Array([b]))).request), {value: '中文'});
  const bad = streamed([new TextEncoder().encode('{bad')]).request;
  bad.headers.set('cookie', cookie);
  assert.equal((await POST(bad)).status, 400);
}));

test('aborted or broken JSON streams never return a parsed operation and release their reader', async () => {
  const abort = new AbortController(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request(origin, {method: 'POST', body, signal: abort.signal, duplex: 'half'} as RequestInit);
  const result = readWorkspaceJson(request); abort.abort();
  await assert.rejects(result); assert.equal(cancelled, true); assert.equal(body.locked, false);
  const failed = new ReadableStream<Uint8Array>({start(c) { c.error(new Error('interrupted')); }});
  await assert.rejects(readWorkspaceJson(new Request(origin, {method: 'POST', body: failed, duplex: 'half'} as RequestInit)), /interrupted/);
  assert.equal(failed.locked, false);
});
