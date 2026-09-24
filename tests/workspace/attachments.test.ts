import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { FileService } from '../../src/features/workspace/server/files';
import { MAX_ATTACHMENT_BYTES, attachmentTarget } from '../../src/features/workspace/shared/attachments';

const bytes = (data: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } });
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'noteai-attachments-')));
  const files = new FileService(); const workspace = await files.open(root);
  await fs.mkdir(path.join(root, '中文项目'));
  await fs.writeFile(path.join(root, '中文项目', '笔记.md'), '# 保留原文\n');
  return { root, files, id: workspace.id, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('attachments upload unique exact bytes, download original names, and stay off tree/search', async () => {
  const f = await fixture();
  try {
    assert.equal(typeof f.files.uploadAttachment, 'function');
    const name = '项目说明 #?% [一](1).pdf';
    const data = new TextEncoder().encode('attachment bytes\n中文\0');
    const first = await f.files.uploadAttachment(f.id, '中文项目/笔记.md', name, bytes(data));
    const second = await f.files.uploadAttachment(f.id, '中文项目/笔记.md', name, bytes(data));
    assert.notEqual(first.path, second.path);
    assert.equal(first.name, name);
    const target = attachmentTarget(f.id, '中文项目/笔记.md', first.url)!;
    assert.equal(target.path, first.path);
    const download = await f.files.attachment(f.id, target.path);
    assert.equal(download.name, name); assert.equal(download.size, data.byteLength);
    assert.deepEqual(new Uint8Array(await new Response(download.stream).arrayBuffer()), data);
    assert.equal(await fs.readFile(path.join(f.root, '中文项目', '笔记.md'), 'utf8'), '# 保留原文\n');
    await fs.writeFile(path.join(f.root, '中文项目', '笔记.assets', 'file', '隐藏.md'), '隐藏附件正文');
    const tree = await f.files.tree(f.id);
    assert.deepEqual(tree[0].children?.map((item) => item.name), ['笔记.md']);
    assert.equal((await f.files.search(f.id, '隐藏附件正文')).results.length, 0);
    const empty = await f.files.uploadAttachment(f.id, '中文项目/笔记.md', '空文件.bin', bytes(new Uint8Array()));
    const emptyDownload = await f.files.attachment(f.id, empty.path);
    assert.equal((await new Response(emptyDownload.stream).arrayBuffer()).byteLength, 0);
  } finally { await f.cleanup(); }
});

test('attachment paths decode once and never escape the workspace or match remote links', () => {
  assert.equal(attachmentTarget('id', '笔记.md', '../附件/x'), undefined);
  assert.equal(attachmentTarget('id', '笔记.md', 'https://example.com/附件/x'), undefined);
  assert.equal(attachmentTarget('id', '笔记.md', '%2Fetc/passwd'), undefined);
  assert.equal(attachmentTarget('id', '笔记.md', '附件/%2e%2e/x'), undefined);
  assert.equal(attachmentTarget('id', '笔记.md', '附件/%5cfile'), undefined);
  assert.equal(attachmentTarget('id', '笔记.md', '资料/file.pdf'), undefined);
  assert.equal(attachmentTarget('id', '中文/笔记.md', '../附件/a%2520%23%3F.pdf')?.path, '附件/a%20#?.pdf');
});

test('100 MB streams upload/download intact and oversized bodies leave no partial file', { timeout: 20000 }, async () => {
  const f = await fixture();
  const chunk = new Uint8Array(1024 * 1024).fill(37);
  const stream = (count: number) => new ReadableStream<Uint8Array>({ pull(controller) {
    if (count-- > 0) controller.enqueue(chunk); else controller.close();
  } });
  try {
    const file = await f.files.uploadAttachment(f.id, '中文项目/笔记.md', '边界.bin', stream(100));
    assert.equal(file.size, MAX_ATTACHMENT_BYTES);
    const downloaded = await f.files.attachment(f.id, file.path);
    const reader = downloaded.stream.getReader(); const actual = createHash('sha256'); let size = 0;
    while (true) { const next = await reader.read(); if (next.done) break; actual.update(next.value); size += next.value.byteLength; }
    assert.equal(size, MAX_ATTACHMENT_BYTES);
    const expected = createHash('sha256'); for (let i = 0; i < 100; i++) expected.update(chunk);
    assert.equal(actual.digest('hex'), expected.digest('hex'));
    await assert.rejects(f.files.uploadAttachment(f.id, '中文项目/笔记.md', '过大.bin', stream(101)), /100 MB/);
    assert.deepEqual(await fs.readdir(path.join(f.root, '中文项目', '笔记.assets', 'file')), [path.basename(file.path)]);
  } finally { await f.cleanup(); }
});

test('aborted/failed uploads clean temporary files; invalid paths, filenames and symlinks are rejected', async () => {
  const f = await fixture();
  try {
    const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      controller.enqueue(new Uint8Array(100)); abort.abort();
    } }, { highWaterMark: 0 });
    await assert.rejects(f.files.uploadAttachment(f.id, '中文项目/笔记.md', '取消.txt', body, abort.signal));
    assert.deepEqual(await fs.readdir(path.join(f.root, '中文项目', '笔记.assets', 'file')), []);
    const broken = new ReadableStream<Uint8Array>({ pull() { throw new Error('source failed'); } });
    await assert.rejects(f.files.uploadAttachment(f.id, '中文项目/笔记.md', '失败.txt', broken), /source failed/);
    assert.deepEqual(await fs.readdir(path.join(f.root, '中文项目', '笔记.assets', 'file')), []);
    for (const name of ['../x', 'a/b', 'a\\b', '.', '\0x', '换\n行', 'a'.repeat(218)]) {
      await assert.rejects(f.files.uploadAttachment(f.id, '中文项目/笔记.md', name, bytes(new Uint8Array())));
    }
    await assert.rejects(f.files.uploadAttachment(f.id, '../outside.md', 'x', bytes(new Uint8Array())), /路径/);
    await assert.rejects(f.files.attachment(f.id, '中文项目/笔记.md'), /只能下载附件/);
    await assert.rejects(f.files.attachment(f.id, '附件/../../outside.txt'), /路径/);
    await fs.symlink(path.join(f.root, '中文项目', '笔记.md'), path.join(f.root, '中文项目', '笔记.assets', 'file', '链接.txt'));
    await assert.rejects(f.files.attachment(f.id, '中文项目/笔记.assets/file/链接.txt'), /符号链接/);
    await fs.symlink(path.join(f.root, '中文项目', '笔记.assets', 'file'), path.join(f.root, '根文档.assets'));
    await fs.writeFile(path.join(f.root, '根文档.md'), '');
    await assert.rejects(f.files.uploadAttachment(f.id, '根文档.md', 'x', bytes(new Uint8Array())), /符号链接/);
    await assert.rejects(f.files.attachment(f.id, '中文项目/笔记.assets/file/丢失.txt'));
  } finally { await f.cleanup(); }
});
