import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileService } from '../../src/features/workspace/server/files';
import { progressResponse } from '../../src/features/workspace/server/progress-stream';
import { checkRecoveryScope } from '../../src/features/workspace/server/recovery-discovery';
import { withWorkspaceLock } from '../../src/features/workspace/server/workspace-lock';
import { readProgressResponse } from '../../src/features/workspace/shared/progress-client';
import type { OpenProgress } from '../../src/features/workspace/shared/open-progress';
import { WorkspaceError } from '../../src/features/workspace/shared/types';

const failure = (e: unknown) => Response.json({ error: e instanceof Error ? e.message : 'error' }, { status: e instanceof WorkspaceError ? e.status : 500 });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-progress-')));
  await fs.writeFile(path.join(root, 'note.md'), '# hello\n');
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('opening reports actual scan counts, no recovery stage without pending writes, and cancellable tree', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.root, 'node_modules'));
    await fs.writeFile(path.join(f.root, 'node_modules', 'dependency.js'), 'fixture');
    const service = new FileService(undefined, [f.root]);
    const events: OpenProgress[] = [];
    const options = { onProgress: (p: OpenProgress) => events.push(p) };
    const workspace = await service.open(f.root, options);
    assert.equal(events.filter(p => p.stage === 'checking').at(-1)?.entries, 1);
    assert.ok(!events.some(p => p.stage === 'recovering'));
    const tree = await service.tree(workspace.id, options);
    assert.equal(tree.length, 1);
    assert.equal(events.at(-1)?.stage, 'tree');
    assert.equal(events.at(-1)?.cancellable, true);
    assert.equal(await fs.readFile(path.join(f.root, 'note.md'), 'utf8'), '# hello\n');
  } finally { await f.cleanup(); }
});

test('scan cancellation releases locks and allows a subsequent open without recovery blockage', async () => {
  const f = await fixture();
  try {
    const service = new FileService(undefined, [f.root]);
    const abort = new AbortController();
    await assert.rejects(service.open(f.root, { signal: abort.signal, onProgress: p => {
      if (p.entries === 1) abort.abort();
    }}), e => e instanceof Error && e.name === 'AbortError');
    const w = await service.open(f.root);
    assert.equal((await service.tree(w.id)).length, 1);
  } finally { await f.cleanup(); }
});

test('visible files count toward limits; excluded directories neither consume budget nor expose nested records', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, 'file.js'), 'fixture');
    await assert.rejects(checkRecoveryScope(f.root, f.root, 1), e => e instanceof WorkspaceError && e.status === 413);
    await fs.mkdir(path.join(f.root, 'node_modules', 'pkg', '.noteai-operations', 'broken'), { recursive: true });
    await fs.writeFile(path.join(f.root, 'node_modules', 'pkg', '.noteai-operations', 'broken', 'journal.json'), 'invalid');
    await fs.writeFile(path.join(f.root, '.hidden-file'), 'hidden');
    await checkRecoveryScope(f.root, f.root, 2);
    await assert.rejects(checkRecoveryScope(f.root, f.root, 100, { includeExcluded: true }), e => e instanceof WorkspaceError && e.status === 409);
  } finally { await f.cleanup(); }
});

test('waiting stage is emitted only for an actual overlapping operation; cancelled waiter cannot release predecessor lock', async () => {
  const f = await fixture();
  let release!: () => void;
  try {
    const lock = withWorkspaceLock(f.root, () => new Promise<void>(r => { release = r; }));
    await tick();
    const abort = new AbortController();
    const events: OpenProgress[] = [];
    const opening = new FileService(undefined, [f.root]).open(f.root, { signal: abort.signal, onProgress: p => events.push(p) });
    const rejected = assert.rejects(opening, e => e instanceof Error && e.name === 'AbortError');
    while (!events.length) await tick();
    assert.equal(events[0].stage, 'waiting');
    assert.equal(events[0].cancellable, false);
    abort.abort();
    release();
    await lock;
    await rejected;
    await new FileService(undefined, [f.root]).open(f.root);
  } finally { release?.(); await f.cleanup(); }
});

test('stream transmits progress and terminal result; scan counts are throttled, stages immediate', async () => {
  const events: OpenProgress[] = [];
  const response = progressResponse(new Request('http://localhost'), async options => {
    for (let entries = 0; entries < 100; entries++) options.onProgress?.({ stage: 'checking', entries, cancellable: true });
    options.onProgress?.({ stage: 'recovering', cancellable: false });
    return { id: 'workspace' };
  }, failure);
  assert.equal(response.headers.get('X-Accel-Buffering'), 'no');
  assert.deepEqual(await readProgressResponse(response, { onProgress: p => events.push(p) }), { id: 'workspace' });
  assert.deepEqual(events.map(p => p.stage), ['checking', 'recovering']);
});

test('stream error is never interpreted as a successful HTTP 200 response', async () => {
  const response = progressResponse(new Request('http://localhost'), async () => { throw new WorkspaceError('scope too large', 413); }, failure);
  await assert.rejects(readProgressResponse(response, {}), e => e instanceof WorkspaceError && e.status === 413);
});

test('parser handles split UTF-8 lines and rejects truncated or malformed streams', async () => {
  const raw = new TextEncoder().encode(' {"type":"heartbeat"}\n{"type":"result","value":"中文"}\n');
  const response = new Response(new ReadableStream({ start(c) { for (const byte of raw) c.enqueue(new Uint8Array([byte])); c.close(); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  assert.equal(await readProgressResponse(response, {}), '中文');
  for (const body of ['{"type":"heartbeat"}\n', '{"type":"result","value":1}', 'invalid\n', '{"type":"progress","progress":{"stage":"oops"}}\n']) {
    await assert.rejects(readProgressResponse(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }), {}), /连接中断/);
  }
});

test('consumer disconnect aborts read work and does not enqueue further stream data', async () => {
  let signal: AbortSignal | undefined;
  let release!: () => void;
  const response = progressResponse(new Request('http://localhost'), async options => {
    signal = options.signal;
    await new Promise<void>(r => { release = r; });
    options.onProgress?.({ stage: 'tree', entries: 1, cancellable: true });
    return true;
  }, failure);
  const reader = response.body!.getReader();
  await reader.cancel();
  assert.equal(signal?.aborted, true);
  release();
  await tick();
});
