import { withAuthentication } from './auth-fixture';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GET, HEAD, POST } from '../../src/app/api/workspace/attachment/route';
import { files } from '../../src/features/workspace/server/server';
import { MAX_ATTACHMENT_BYTES } from '../../src/features/workspace/shared/attachments';

test('attachment HTTP streams raw uploads and forces downloads with Unicode filename and safe headers', async () => withAuthentication(async cookie => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'noteai-attachment-route-')));
  try {
    await fs.writeFile(path.join(root, '笔记.md'), '');
    const workspace = await files.open(root);
    const origin = 'http://127.0.0.1:3000';
    const name = '说明 #?% (中文).html';
    const query = new URLSearchParams({ id: workspace.id, path: '笔记.md', name });
    const url = `${origin}/api/workspace/attachment?${query}`;
    const content = '<script>alert("download only")</script>\n中文';
    const uploaded = await POST(new Request(url, { method: 'POST', headers: { origin, cookie }, body: content }));
    assert.equal(uploaded.status, 200);
    const result = await uploaded.json();
    const downloadUrl = `${origin}/api/workspace/attachment?${new URLSearchParams({ id: workspace.id, path: result.path })}`;
    // Browsers do not send Origin on a same-origin HEAD fetch.
    const head = await HEAD(new Request(downloadUrl, { method: 'HEAD', headers: { cookie, 'sec-fetch-site': 'same-origin' } }));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(content)));
    assert.equal(head.headers.get('content-type'), 'application/octet-stream');
    assert.equal(head.headers.get('x-content-type-options'), 'nosniff');
    const disposition = head.headers.get('content-disposition')!;
    assert.ok(disposition.startsWith('attachment;'));
    assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), name);
    const download = await GET(new Request(downloadUrl, { headers: { cookie } }));
    assert.equal(await download.text(), content);
    assert.equal((await HEAD(new Request(downloadUrl, { method: 'HEAD', headers: { origin: 'https://foreign.example' } }))).status, 403);
    assert.equal((await POST(new Request(url, { method: 'POST', body: '' }))).status, 403);
    assert.equal((await POST(new Request(url, { method: 'POST', headers: { origin, cookie, 'content-length': String(MAX_ATTACHMENT_BYTES + 1) }, body: '' }))).status, 413);
    await fs.unlink(path.join(root, result.path));
    assert.equal((await GET(new Request(downloadUrl, { headers: { cookie } }))).status, 404);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}));
