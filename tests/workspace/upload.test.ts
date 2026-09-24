import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileService } from '../../src/features/workspace/server/files';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
test('image uploads write unique local assets, validate actual bytes, and keep Markdown unchanged', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'noteai-image-')));
  try {
    const service = new FileService(); const { id } = await service.open(root);
    await service.create(id, '', '中文.md', 'file', '# 图片');
    assert.equal(typeof service.uploadImage, 'function');
    const a = await service.uploadImage(id, '中文.md', png);
    const b = await service.uploadImage(id, '中文.md', png);
    assert.match(a.url, /^[^/]+\.assets\/images\/[^/]+\.png$/); assert.notEqual(a.url, b.url);
    assert.deepEqual((await service.asset(id, a.path)).data, png);
    assert.equal((await service.read(id, '中文.md')).content, '# 图片');
    await assert.rejects(service.uploadImage(id, '中文.md', Buffer.from('<svg></svg>')), /格式/);
    await assert.rejects(service.uploadImage(id, '中文.md', Buffer.alloc(20 * 1024 * 1024 + 1)), /20/);
    await assert.rejects(service.uploadImage(id, '../越界.md', png), /路径/);
    await fs.mkdir(path.join(root, '子目录')); await service.create(id, '子目录', '文档.md', 'file');
    await fs.symlink(path.join(root, '中文.assets'), path.join(root, '子目录', '文档.assets'));
    await assert.rejects(service.uploadImage(id, '子目录/文档.md', png), /符号链接/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('aborted image uploads do not create assets', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'noteai-abort-image-')));
  try {
    const service = new FileService(); const { id } = await service.open(root);
    await service.create(id, '', 'A.md', 'file', '保留正文');
    const abort = new AbortController(); abort.abort();
    await assert.rejects(service.uploadImage(id, 'A.md', png, abort.signal));
    assert.deepEqual(await fs.readdir(root), ['A.md']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
