import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GET } from '../../src/app/api/health/route';
import { Authentication } from '../../src/features/auth/server/authentication';

test('liveness returns only static status without authentication or filesystem access', async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('bundled administration runs in Node without Bun, source files or installed dependencies', async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-admin-bundle-'))
  );
  try {
    const executable = path.join(root, 'auth-password.mjs');
    await fs.copyFile(
      path.resolve('.next/admin/auth-password.mjs'),
      executable
    );
    const secret = path.join(root, 'password');
    const password = 'isolated node bundle password';
    await fs.writeFile(secret, password, { mode: 0o600 });
    const data = path.join(root, 'config');
    const run = (...flags: string[]) =>
      spawnSync('node', [executable, '--password-file', secret, ...flags], {
        cwd: root,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          NODE_ENV: 'test',
          PATH: process.env.PATH,
          HOME: root,
          MARKDOCK_DATA_DIR: data,
        },
      });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!(result.stdout + result.stderr).includes(password));
    const auth = new Authentication(data);
    const token = await auth.login(password);
    assert.equal(await auth.authenticated(token), true);
    assert.notEqual(run().status, 0);
    assert.equal(await auth.authenticated(token), true);
    result = run('--reset');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await auth.authenticated(token), false);
    assert.equal(
      (await fs.stat(path.join(data, '.markdock-auth.json'))).mode & 0o777,
      0o600
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('container launcher rejects missing mounts/configuration before starting standalone', () => {
  const result = spawnSync(
    'node',
    [path.resolve('scripts/container-start.mjs')],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        MARKDOCK_HOST: '127.0.0.1',
      },
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /容器必须显式配置/);
  assert.doesNotMatch(result.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/);
});

test('container mount admission rejects symlinks, missing paths and configuration inside document roots', async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-mounts-'))
  );
  try {
    const documents = path.join(root, 'documents');
    const config = path.join(root, 'config');
    await fs.mkdir(documents);
    await fs.mkdir(config);
    await fs.symlink(documents, path.join(root, 'linked'));
    await fs.mkdir(path.join(documents, 'service'));
    const run = (data: string, allowed: string) =>
      spawnSync('node', [path.resolve('scripts/container-start.mjs')], {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          NODE_ENV: 'test',
          PATH: process.env.PATH,
          MARKDOCK_PUBLIC_ORIGIN: 'https://notes.example.test',
          MARKDOCK_DATA_DIR: data,
          MARKDOCK_WORKSPACE_ROOTS: JSON.stringify([allowed]),
        },
      });
    for (const [data, allowed, message] of [
      [config, path.join(root, 'missing'), /ENOENT/],
      [config, path.join(root, 'linked'), /符号链接/],
      [path.join(documents, 'service'), documents, /允许根之外/],
    ] as const) {
      const result = run(data, allowed);
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
      assert.match(
        result.stderr,
        process.getuid?.() === 0 ? /非 root/ : message
      );
    }
    assert.deepEqual(await fs.readdir(config), []);
    assert.deepEqual(await fs.readdir(documents), ['service']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
