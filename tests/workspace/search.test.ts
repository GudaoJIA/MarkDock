import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileService } from '../../src/features/workspace/server/files';

test('workspace search finds Chinese names and content, ranks names first, and reflects disk edits', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'noteai-search-')));
  try {
    await fs.mkdir(path.join(root, '子目录'));
    await fs.writeFile(path.join(root, '子目录', '写作.md'), '# 随笔\n\n你好 **世界**，写作练习。');
    await fs.writeFile(path.join(root, '其他.md'), '# 写作\n\nHELLO hello');
    await fs.writeFile(path.join(root, '.隐藏.md'), '写作');
    const files = new FileService(); const workspace = await files.open(root);
    assert.equal(typeof files.search, 'function');
    const result = await files.search(workspace.id, '写作');
    assert.deepEqual(result.results.map((item) => item.path), ['子目录/写作.md', '其他.md']);
    assert.equal(result.results[0].kind, 'name');
    assert.match(result.results[1].snippet, /写作/);
    assert.equal((await files.search(workspace.id, 'hello')).results.length, 1);
    assert.equal((await files.search(workspace.id, '你好 世界')).results.length, 1);
    await fs.writeFile(path.join(root, '其他.md'), '已从外部更改');
    assert.equal((await files.search(workspace.id, 'hello')).results.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

import { mergeSearch, searchDocument, textMatches } from '../../src/features/workspace/shared/search';
test('local unsaved edits replace disk matches and literal search treats regex characters as text', () => {
  const disk = { results: [searchDocument('A.md', '旧内容', '旧')!], skipped: [], truncated: false };
  assert.equal(mergeSearch(disk, [{ path: 'A.md', content: '本地新内容' }], '旧').results.length, 0);
  assert.equal(mergeSearch({ ...disk, results: [] }, [{ path: 'A.md', content: '本地新内容' }], '新').results[0].path, 'A.md');
  assert.deepEqual(textMatches('abc .* 中文 .*', '.*'), [{ start: 4, end: 6 }, { start: 10, end: 12 }]);
  assert.equal(textMatches('İ HELLO', 'hello')[0].start, 2);
});

test('search caps results, reports unreadable documents and excludes caller-owned sessions', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'noteai-search-limit-')));
  try {
    await Promise.all(Array.from({ length: 205 }, (_, index) => fs.writeFile(path.join(root, `文章${index}.md`), '匹配内容')));
    await fs.writeFile(path.join(root, '损坏.md'), Buffer.from([0xff]));
    const service = new FileService(); const { id } = await service.open(root);
    const result = await service.search(id, '匹配', ['文章0.md']);
    assert.equal(result.results.length, 200); assert.equal(result.truncated, true);
    assert.equal(result.skipped[0].path, '损坏.md'); assert.equal(result.results.some((item) => item.path === '文章0.md'), false);
    await assert.rejects(service.search(id, 'a'.repeat(201)), /200/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('high-frequency text search bounds match allocations', () => {
  assert.equal(textMatches('a'.repeat(100_000), 'a').length, 1000);
  assert.equal(textMatches('a'.repeat(100_000), 'a', 1).length, 1);
  assert.equal(searchDocument('huge.md', 'a'.repeat(100_000), 'a')?.kind, 'content');
});
