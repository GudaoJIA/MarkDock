import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileService } from '../../src/features/workspace/server/files';

test('directory browsing is shallow, sorted and read-only, with bounded breadcrumbs', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-browse-')));
  try {
    for (const name of ['b', 'a', '中文 空格', '.private', 'node_modules']) await fs.mkdir(path.join(root, name));
    await fs.mkdir(path.join(root, 'a/nested'));
    await fs.writeFile(path.join(root, 'note.md'), 'unchanged');
    await fs.symlink('a', path.join(root, 'link'));
    const before = await fs.readdir(root);
    const service = new FileService();
    const host = await service.browse({ scope: 'host', path: root });
    assert.deepEqual(host.directories.map(entry => entry.name), ['a', 'b', '中文 空格'].sort((a,b) => a.localeCompare(b, 'zh-CN', {numeric:true})));
    assert.equal(host.parent, path.dirname(root));
    assert.equal(host.breadcrumbs.at(-1)?.path, root);
    assert.deepEqual(await fs.readdir(root), before);
    const nested = await service.browse({ scope: 'host', path: path.join(root,'a/nested') });
    assert.equal(nested.parent, path.join(root,'a'));
    assert.deepEqual(nested.directories, []);
    assert.equal(nested.breadcrumbs.at(-1)?.path, path.join(root,'a/nested'));
    assert.equal(await fs.readFile(path.join(root, 'note.md'), 'utf8'), 'unchanged');
  } finally { await fs.rm(root, {recursive:true, force:true}); }
});

test('directory browsing rejects invalid paths, symlinks, missing folders and denied permissions', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-browse-')));
  try {
    const service = new FileService();
    await fs.mkdir(path.join(root, 'blocked'));
    await fs.writeFile(path.join(root, 'file'), 'keep');
    await fs.symlink(os.tmpdir(), path.join(root, 'escape'));
    for (const candidate of ['relative', path.join(root, 'escape'), path.join(root, 'missing'), path.join(root,'file')]) {
      await assert.rejects(service.browse({scope:'host', path:candidate}));
    }
    await fs.chmod(path.join(root, 'blocked'), 0);
    if (process.getuid?.() !== 0) await assert.rejects(service.browse({scope:'host', path:path.join(root,'blocked')}));
    await fs.chmod(path.join(root,'blocked'), 0o700);
    assert.equal(await fs.readFile(path.join(root,'file'), 'utf8'), 'keep');
  } finally { await fs.chmod(path.join(root,'blocked'), 0o700).catch(()=>{}); await fs.rm(root,{recursive:true,force:true}); }
});
