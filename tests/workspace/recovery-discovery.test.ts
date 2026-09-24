import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { FileService } from '../../src/features/workspace/server/files';
import { FileTransaction } from '../../src/features/workspace/server/file-transaction';
import { checkRecoveryScope } from '../../src/features/workspace/server/recovery-discovery';
import { translate } from '../../src/features/workspace/shared/translate';

async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-discovery-'))
  );
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
async function interrupted(owner: string) {
  await fs.writeFile(path.join(owner, 'a.md'), 'original');
  const tx = new FileTransaction(owner);
  await tx.prepare();
  await tx.move('a.md', 'b.md');
  const journal = path.join(owner, tx.directory, 'journal.json');
  await fs.writeFile(
    journal,
    JSON.stringify({
      version: 1,
      state: 'prepared',
      attempted: 1,
      steps: tx.steps,
    })
  );
  await fs.rename(path.join(owner, 'a.md'), path.join(owner, 'b.md'));
  return journal;
}
async function snapshot(root: string): Promise<unknown[]> {
  const result: unknown[] = [];
  for (const name of (await fs.readdir(root)).sort()) {
    const file = path.join(root, name),
      stat = await fs.lstat(file);
    result.push([
      name,
      stat.mode,
      stat.mtimeMs,
      stat.isDirectory()
        ? await snapshot(file)
        : stat.isSymbolicLink()
          ? await fs.readlink(file)
          : (await fs.readFile(file)).toString('base64'),
    ]);
  }
  return result;
}

test('fresh service cannot bypass parent or nested journals; discovery is read-only, original root remains recoverable', async () => {
  for (const ownerIsParent of [true, false])
    await fixture(async (root) => {
      const nested = path.join(root, 'child');
      await fs.mkdir(nested);
      const owner = ownerIsParent ? root : nested,
        selected = ownerIsParent ? nested : root;
      const journal = await interrupted(owner);
      const before = await snapshot(root);
      const service = new FileService(undefined, [root]);
      await assert.rejects(
        service.open(selected),
        (e: any) => e.status === 409 && e.message.includes(owner)
      );
      assert.deepEqual(await snapshot(root), before);
      await service.open(owner);
      assert.equal(
        await fs.readFile(path.join(owner, 'a.md'), 'utf8'),
        'original'
      );
      assert.equal(
        JSON.parse(await fs.readFile(journal, 'utf8')).state,
        'rolled-back'
      );
      await service.open(selected);
    });
});

test('unknown roots are discovered after a real service-process restart, before any recovery writes', async () =>
  fixture(async (root) => {
    const child = path.join(root, 'child');
    await fs.mkdir(child);
    await interrupted(root);
    const before = await snapshot(root);
    const script = path.join(
      os.tmpdir(),
      `markdock-discovery-${crypto.randomUUID()}.ts`
    );
    try {
      await fs.writeFile(
        script,
        `import {FileService} from ${JSON.stringify(new URL('../../src/features/workspace/server/files.ts', import.meta.url).href)}; try { await new FileService(undefined,[process.argv[2]]).open(process.argv[3]); process.exitCode=1; } catch(e) { if(e.status!==409) throw e; console.log('blocked'); }`
      );
      const result = spawnSync(
        process.execPath,
        ['--no-env-file', 'run', script, root, child],
        {
          encoding: 'utf8',
          timeout: 10000,
          env: {
            NODE_ENV: 'test',
            PATH: process.env.PATH,
            HOME: process.env.HOME,
          },
        }
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /blocked/);
      assert.deepEqual(await snapshot(root), before);
    } finally {
      await fs.unlink(script);
    }
  }));

test('malformed or symlinked foreign journals block without following symlinks; ordinary symlink directories are not scanned', async () =>
  fixture(async (root) => {
    const nested = path.join(root, 'child');
    await fs.mkdir(nested);
    const journal = await interrupted(nested);
    await fs.writeFile(journal, '{invalid');
    const before = await snapshot(root);
    const service = new FileService(undefined, [root]);
    await assert.rejects(service.open(root));
    assert.deepEqual(await snapshot(root), before);
    await fs.writeFile(
      journal,
      JSON.stringify({
        version: 1,
        state: 'rolled-back',
        attempted: 0,
        steps: [],
      })
    );
    await service.open(root);
    await fs.rename(
      path.join(nested, '.noteai-operations'),
      path.join(nested, 'records')
    );
    await fs.symlink('records', path.join(nested, '.noteai-operations'));
    const linked = await snapshot(root);
    await assert.rejects(service.open(root));
    assert.deepEqual(await snapshot(root), linked);
    await fs.unlink(path.join(nested, '.noteai-operations'));
    await fs.symlink(root, path.join(root, 'loop'));
    await service.open(root);
  }));

test('deployment roots bound ancestor inspection, including overlapping configured roots', async () =>
  fixture(async (root) => {
    const nested = path.join(root, 'child');
    await fs.mkdir(nested);
    await interrupted(root);
    // A disallowed ancestor is not inspected or recovered. Narrowing roots requires prior recovery.
    await new FileService(undefined, [nested]).open(nested);
    await assert.rejects(
      new FileService(undefined, [nested, root]).open(nested),
      (e: any) => e.status === 409
    );
  }));

test('opening excludes hidden descendants, explicit roots recover themselves, and internal roots remain forbidden', async () =>
  fixture(async (root) => {
    await fs.mkdir(path.join(root, '.hidden'));
    await interrupted(path.join(root, '.hidden'));
    const service = new FileService(undefined, [root]);
    const before = await snapshot(path.join(root, '.hidden'));
    await service.open(root);
    assert.deepEqual(await snapshot(path.join(root, '.hidden')), before);
    await service.open(path.join(root, '.hidden'));
    assert.equal(await fs.readFile(path.join(root, '.hidden', 'a.md'), 'utf8'), 'original');
    await service.open(root);
    await fs.writeFile(path.join(root, 'one.md'), 'one');
    await fs.writeFile(path.join(root, 'two.md'), 'two');
    await assert.rejects(
      checkRecoveryScope(root, root, 1),
      (e: any) => e.status === 413
    );
    for (const name of [
      '.noteai-operations',
      '.noteai-trash',
      '.noteai-backups',
    ]) {
      await fs.mkdir(path.join(root, name), { recursive: true });
      await assert.rejects(
        service.open(path.join(root, name)),
        (e: any) => e.status === 403
      );
    }
  }));

test('recovery rechecks directories restored from internal staging before opening the workspace', async () =>
  fixture(async (root) => {
    const child = path.join(root, 'child');
    await fs.mkdir(child);
    const childJournal = await interrupted(child);
    const tx = new FileTransaction(root);
    await tx.prepare();
    const staged = `${tx.directory}/staged`;
    await tx.move('child', staged);
    await fs.writeFile(
      path.join(root, tx.directory, 'journal.json'),
      JSON.stringify({
        version: 1,
        state: 'prepared',
        attempted: 1,
        steps: tx.steps,
      })
    );
    await fs.rename(child, path.join(root, staged));
    const service = new FileService(undefined, [root]);
    await assert.rejects(
      service.open(root),
      (e: any) => e.status === 409 && e.message.includes(child)
    );
    assert.equal(
      JSON.parse(await fs.readFile(childJournal, 'utf8')).state,
      'prepared'
    );
    assert.equal(
      await fs.readFile(path.join(child, 'b.md'), 'utf8'),
      'original'
    );
    await service.open(child);
    await service.open(root);
    assert.equal(
      await fs.readFile(path.join(child, 'a.md'), 'utf8'),
      'original'
    );
  }));

test('two unfinished overlapping roots stop without guessing recovery order or changing data', async () =>
  fixture(async (root) => {
    const child = path.join(root, 'child');
    await fs.mkdir(child);
    await interrupted(root);
    await interrupted(child);
    const before = await snapshot(root);
    const service = new FileService(undefined, [root]);
    for (const selected of [root, child])
      await assert.rejects(
        service.open(selected),
        (e: any) => e.status === 409
      );
    assert.deepEqual(await snapshot(root), before);
  }));

test('invalid discovery boundaries are rejected; translated errors preserve the original workspace path', async () =>
  fixture(async (root) => {
    await assert.rejects(
      checkRecoveryScope(root, path.join(root, 'child')),
      (e: any) => e.status === 403
    );
    await checkRecoveryScope(root, `${root}/`);
    assert.equal(
      translate(
        'en',
        `发现其他工作区的未完成或无效操作记录，请先处理原工作区：${root}`
      ),
      `Another workspace has unfinished or invalid operation records. Resolve them in the original workspace first: ${root}`
    );
  }));

test('cancellation before recovery preserves the journal; cancellation at recovery start lets writes finish under lock', async () => {
  await fixture(async root => {
    await interrupted(root);
    const before = await snapshot(root);
    const service = new FileService(undefined, [root]);
    const abort = new AbortController();
    await assert.rejects(service.open(root, { signal: abort.signal, onProgress: p => {
      if (p.stage === 'checking' && p.entries) abort.abort();
    }}), e => e instanceof Error && e.name === 'AbortError');
    assert.deepEqual(await snapshot(root), before);
    const during = new AbortController();
    let recovering = false;
    await assert.rejects(service.open(root, { signal: during.signal, onProgress: p => {
      if (p.stage === 'recovering') { recovering = true; assert.equal(p.cancellable, false); during.abort(); }
    }}), e => e instanceof Error && e.name === 'AbortError');
    assert.equal(recovering, true);
    assert.equal(await fs.readFile(path.join(root, 'a.md'), 'utf8'), 'original');
    await assert.rejects(fs.stat(path.join(root, 'b.md')));
    assert.equal((await service.open(root)).root, root);
  });
});


test('opening skips dependency trees but moving a containing directory still rejects hidden unfinished operations', async () => {
  await fixture(async root => {
    const project = path.join(root, 'project');
    const hidden = path.join(project, 'node_modules', 'package');
    await fs.mkdir(hidden, { recursive: true });
    await interrupted(hidden);
    const service = new FileService(undefined, [root]);
    const workspace = await service.open(root);
    await assert.rejects(service.read(workspace.id, 'project/node_modules/package/b.md'), (e: any) => e.status === 403);
    const before = await snapshot(root);
    await assert.rejects(service.rename(workspace.id, 'project', 'renamed'), (e: any) => e.status === 409);
    assert.deepEqual(await snapshot(root), before);
    await service.open(hidden);
    await service.rename(workspace.id, 'project', 'renamed');
    assert.equal(await fs.readFile(path.join(root, 'renamed', 'node_modules', 'package', 'a.md'), 'utf8'), 'original');
  });
});
