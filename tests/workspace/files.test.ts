import { checkRequest } from '../../src/features/auth/server/access';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileService } from '../../src/features/workspace/server/files';

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'noteai-test-')));
  const service = new FileService();
  const workspace = await service.open(root);
  return { root, service, id: workspace.id, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('resource directories stay off the document tree and search while their files remain readable', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.root, 'assets'));
    await fs.mkdir(path.join(f.root, '文章', 'assets'), { recursive: true });
    await fs.writeFile(path.join(f.root, 'assets', '隐藏.md'), '资源内容');
    await fs.writeFile(path.join(f.root, '文章', 'assets', '隐藏.md'), '资源内容');
    await fs.writeFile(path.join(f.root, '文章', '正文.md'), '可见正文');
    const tree = await f.service.tree(f.id);
    assert.deepEqual(tree.map((entry) => entry.name), ['文章']);
    assert.deepEqual(tree[0].children?.map((entry) => entry.name), ['正文.md']);
    assert.equal((await f.service.search(f.id, '资源内容')).results.length, 0);
    assert.equal((await f.service.read(f.id, 'assets/隐藏.md')).content, '资源内容');
  } finally { await f.cleanup(); }
});

test('opening a workspace requires an existing directory and never creates it', async () => {
  const f = await fixture();
  try {
    const missing = path.join(f.root, 'missing');
    await assert.rejects(f.service.open(missing));
    await assert.rejects(fs.stat(missing));
    await fs.symlink(f.root, path.join(f.root, 'linked'));
    await assert.rejects(f.service.open(path.join(f.root, 'linked')), /符号链接/);
  } finally { await f.cleanup(); }
});

test('real tree, Unicode paths, hidden/symlink filtering, safe create and rename', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.id, '', '随笔', 'directory');
    await f.service.create(f.id, '随笔', '文章10.md', 'file', '# 你好');
    await f.service.create(f.id, '随笔', '文章2.md', 'file');
    await fs.writeFile(path.join(f.root, 'private.txt'), 'private');
    await fs.writeFile(path.join(f.root, '.hidden.md'), 'hidden');
    await fs.symlink(path.join(f.root, '随笔'), path.join(f.root, 'linked'));
    const tree = await f.service.tree(f.id);
    assert.deepEqual(tree.map((node) => node.name), ['随笔']);
    assert.deepEqual(tree[0].children?.map((node) => node.name), ['文章2.md', '文章10.md']);
    await assert.rejects(f.service.read(f.id, 'linked/文章2.md'), /符号链接/);
    await assert.rejects(f.service.read(f.id, '../private.md'), /路径/);
    await assert.rejects(f.service.create(f.id, '', '../outside.md', 'file'), /名称/);
    await assert.rejects(f.service.create(f.id, '随笔', '文章2.md', 'file'));
    await assert.rejects(f.service.rename(f.id, '随笔/文章2.md', '文章10.md'), /同名/);
    await f.service.rename(f.id, '随笔', '新随笔');
    assert.equal((await f.service.read(f.id, '新随笔/文章2.md')).content, '');
    await assert.rejects(f.service.read('invalid', 'x.md'), /失效/);
  } finally { await f.cleanup(); }
});

test('save backs up original bytes, preserves mode, rejects stale and concurrent saves', async () => {
  const f = await fixture();
  try {
    const original = '\uFEFF---\r\ntitle: 中文\r\n---\r\n\r\n# 原文\r\n';
    await fs.writeFile(path.join(f.root, '文章.md'), original, { mode: 0o640 });
    const before = await f.service.read(f.id, '文章.md');
    assert.equal(before.content, original);
    await f.service.save(f.id, '文章.md', original, before.version);
    assert.equal((await fs.readdir(f.root)).length, 1);
    const competing = await Promise.allSettled([
      f.service.save(f.id, '文章.md', '# 修改一\n', before.version),
      f.service.save(f.id, '文章.md', '# 修改二\n', before.version),
    ]);
    assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(competing.filter((result) => result.status === 'rejected').length, 1);
    const backups = await fs.readdir(path.join(f.root, '.noteai-backups'));
    assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(f.root, '.noteai-backups', backups[0]), 'utf8'), original);
    assert.equal((await fs.stat(path.join(f.root, '文章.md'))).mode & 0o777, 0o640);
    const current = await f.service.read(f.id, '文章.md');
    await fs.writeFile(path.join(f.root, '文章.md'), '外部修改');
    await assert.rejects(f.service.save(f.id, '文章.md', '本地修改', current.version), /外部修改/);
    assert.equal(await fs.readFile(path.join(f.root, '文章.md'), 'utf8'), '外部修改');
    assert.equal((await fs.readdir(f.root)).some((name) => name.endsWith('.tmp')), false);
  } finally { await f.cleanup(); }
});

test('rejects invalid UTF-8, unsafe images, symlink destination and backup directory', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, 'bad.md'), new Uint8Array([0xff, 0xfe]));
    await assert.rejects(f.service.read(f.id, 'bad.md'), /UTF-8/);
    await fs.writeFile(path.join(f.root, 'unsafe.svg'), '<svg/>');
    await assert.rejects(f.service.asset(f.id, 'unsafe.svg'), /格式/);
    await fs.writeFile(path.join(f.root, 'image.png'), new Uint8Array([137, 80, 78, 71]));
    assert.equal((await f.service.asset(f.id, 'image.png')).type, 'image/png');
    await fs.writeFile(path.join(f.root, 'safe.md'), 'safe');
    const file = await f.service.read(f.id, 'safe.md');
    await fs.mkdir(path.join(f.root, 'other'));
    await fs.symlink(path.join(f.root, 'other'), path.join(f.root, '.noteai-backups'));
    await assert.rejects(f.service.save(f.id, 'safe.md', 'edited', file.version), /符号链接/);
    assert.equal(await fs.readFile(path.join(f.root, 'safe.md'), 'utf8'), 'safe');
  } finally { await f.cleanup(); }
});

test('file requests require localhost and same-origin mutations', () => {
  const make = (origin?: string, host = '127.0.0.1:3000', site?: string) => new Request(`http://${host}/api/workspace`, { method: 'POST', headers: { host, ...(origin ? { origin } : {}), ...(site ? { 'sec-fetch-site': site } : {}) } });
  assert.doesNotThrow(() => checkRequest(make('http://127.0.0.1:3000')));
  assert.doesNotThrow(() => checkRequest(new Request('http://localhost:3000/api/workspace', { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } })));
  assert.throws(() => checkRequest(make('https://attacker.example')), /来源/);
  assert.throws(() => checkRequest(make()), /同源/);
  assert.throws(() => checkRequest(make('http://evil.example:3000', 'evil.example:3000')), /本机/);
  assert.throws(() => checkRequest(make('http://127.0.0.1:3000', '127.0.0.1:3000', 'cross-site')), /来源/);
});
