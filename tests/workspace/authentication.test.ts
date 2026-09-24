import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  Authentication,
  AUTH_COOKIE,
  sessionCookie,
  requestToken,
  validPassword,
} from '../../src/features/auth/server/authentication';
import { POST as authPost } from '../../src/app/api/auth/route';
import {
  GET as fileGet,
  POST as filePost,
} from '../../src/app/api/workspace/route';
import {
  GET as attachmentGet,
  HEAD as attachmentHead,
  POST as attachmentPost,
} from '../../src/app/api/workspace/attachment/route';
import { withAuthentication } from './auth-fixture';

const password = 'temporary password for tests';
async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-auth-'))
  );
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
const origin = 'http://127.0.0.1:3000';
function request(
  pathname: string,
  method: string,
  cookie?: string,
  body?: unknown
) {
  return new Request(origin + pathname, {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('credentials initialize closed, use salted hashes and restrictive permissions; resets invalidate all old sessions', async () =>
  fixture(async (root) => {
    const auth = new Authentication(root);
    assert.equal(await auth.credentials(), null);
    assert.equal(await auth.authenticated(), false);
    await assert.rejects(auth.login(password), (e: any) => e.status === 503);
    await auth.setPassword(password);
    const filename = path.join(root, '.markdock-auth.json');
    const bytes = await fs.readFile(filename, 'utf8');
    assert.ok(!bytes.includes(password));
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
    const token = await auth.login(password);
    assert.equal(await auth.authenticated(token), true);
    assert.equal(await new Authentication(root).authenticated(token), false);
    await assert.rejects(
      auth.setPassword('another secure password'),
      (e: any) => e.status === 409
    );
    assert.equal(await fs.readFile(filename, 'utf8'), bytes);
    await new Authentication(root).setPassword('another secure password', true);
    assert.equal(await auth.authenticated(token), false);
    await assert.rejects(auth.login(password), (e: any) => e.status === 401);
    const current = await auth.login('another secure password');
    auth.logout(current);
    assert.equal(await auth.authenticated(current), false);
  }));

test('idle and absolute session expiry are enforced', async () =>
  fixture(async (root) => {
    let now = 1000;
    const auth = new Authentication(root, () => now);
    await auth.setPassword(password);
    let token = await auth.login(password);
    now += 30 * 60 * 1000;
    assert.equal(await auth.authenticated(token), false);
    token = await auth.login(password);
    for (let i = 0; i < 24; i++) {
      now += 29 * 60 * 1000;
      assert.equal(await auth.authenticated(token), true);
    }
    now += 25 * 60 * 1000;
    assert.equal(await auth.authenticated(token), false);
    assert.equal(await auth.authenticated('invalid'), false);
  }));

test('failed login rate limits expire after the cooldown', async () =>
  fixture(async (root) => {
    let now = 1000;
    const auth = new Authentication(root, () => now);
    await auth.setPassword(password);
    for (let i = 0; i < 5; i++)
      await assert.rejects(auth.login('wrong'), (e: any) => e.status === 401);
    await assert.rejects(auth.login(password), (e: any) => e.status === 429);
    now += 60_000;
    const token = await auth.login(password);
    assert.equal(await auth.authenticated(token), true);
  }));

test('concurrent password verification is rejected and later logins remain available', async () =>
  fixture(async (root) => {
    const auth = new Authentication(root);
    await auth.setPassword(password);
    const pending = auth.login(password);
    await assert.rejects(auth.login(password), (e: any) => e.status === 429);
    assert.equal(await auth.authenticated(await pending), true);
    assert.equal(await auth.authenticated(await auth.login(password)), true);
  }));

test(
  'session cap retains 32 sessions and evicts only the oldest on the next login',
  // Exercise real scrypt verification for every login; keep other tests at the default timeout.
  { timeout: 30_000 },
  async () =>
    fixture(async (root) => {
      const auth = new Authentication(root, () => 1000);
      await auth.setPassword(password);
      const tokens: string[] = [];
      for (let i = 0; i < 32; i++) tokens.push(await auth.login(password));
      for (const token of tokens)
        assert.equal(await auth.authenticated(token), true);
      const newest = await auth.login(password);
      assert.equal(await auth.authenticated(tokens[0]), false);
      for (const token of tokens.slice(1))
        assert.equal(await auth.authenticated(token), true);
      assert.equal(await auth.authenticated(newest), true);
    })
);

test('malformed, permissive and symlinked credential files fail closed without overwriting them', async () =>
  fixture(async (root) => {
    const auth = new Authentication(root);
    await auth.setPassword(password);
    const filename = path.join(root, '.markdock-auth.json');
    const bytes = await fs.readFile(filename);
    await fs.chmod(filename, 0o644);
    await assert.rejects(auth.credentials(), (e: any) => e.status === 503);
    await fs.chmod(filename, 0o600);
    await fs.writeFile(filename, '{invalid');
    await assert.rejects(
      auth.setPassword(password, true),
      (e: any) => e.status === 503
    );
    assert.equal(await fs.readFile(filename, 'utf8'), '{invalid');
    await fs.unlink(filename);
    await fs.writeFile(path.join(root, 'original'), bytes, { mode: 0o600 });
    await fs.symlink('original', filename);
    await assert.rejects(auth.credentials(), (e: any) => e.status === 503);
    assert.deepEqual(await fs.readFile(path.join(root, 'original')), bytes);
    assert.equal(validPassword('a'.repeat(14)), false);
    assert.equal(validPassword(' a long password with spaces '), true);
    assert.equal(validPassword('a'.repeat(129)), false);
    assert.equal(validPassword('a'.repeat(15) + '\n'), false);
  }));

test('file, image, management and attachment endpoints authenticate before consuming bodies; login/logout cookies and origin checks', async () =>
  withAuthentication(async (cookie, directory) => {
    const anonymous = [
      [fileGet, '/api/workspace?operation=tree', 'GET'],
      [fileGet, '/api/workspace?operation=read', 'GET'],
      [fileGet, '/api/workspace?operation=asset', 'GET'],
      [filePost, '/api/workspace', 'POST'],
      [attachmentGet, '/api/workspace/attachment', 'GET'],
      [attachmentHead, '/api/workspace/attachment', 'HEAD'],
      [attachmentPost, '/api/workspace/attachment', 'POST'],
    ] as const;
    for (const [handler, url, method] of anonymous)
      assert.equal((await handler(request(url, method))).status, 401);
    const untouched = request('/api/workspace', 'POST', undefined, {
      operation: 'open',
      root: directory,
    });
    assert.equal((await filePost(untouched)).status, 401);
    assert.equal(untouched.bodyUsed, false);
    const foreign = request('/api/workspace', 'POST', cookie, {
      operation: 'open',
      root: directory,
    });
    foreign.headers.set('origin', 'https://foreign.example');
    assert.equal((await filePost(foreign)).status, 403);
    const success = await authPost(
      request('/api/auth', 'POST', undefined, {
        operation: 'login',
        password: 'isolated test password only',
      })
    );
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('cache-control'), 'no-store');
    const setCookie = success.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\//);
    assert.doesNotMatch(setCookie, /Secure/);
    const signed = setCookie.split(';')[0];
    assert.equal(
      (
        await filePost(
          request('/api/workspace', 'POST', signed, {
            operation: 'open',
            root: directory,
          })
        )
      ).status,
      200
    );
    const logout = await authPost(
      request('/api/auth', 'POST', signed, { operation: 'logout' })
    );
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal(
      (
        await filePost(
          request('/api/workspace', 'POST', signed, {
            operation: 'open',
            root: directory,
          })
        )
      ).status,
      401
    );
    const noOrigin = request('/api/auth', 'POST', undefined, {
      operation: 'login',
      password,
    });
    noOrigin.headers.delete('origin');
    assert.equal((await authPost(noOrigin)).status, 403);
    const spoofed = request('/api/auth', 'POST', undefined, {
      operation: 'login',
      password,
    });
    spoofed.headers.set('host', 'foreign.example');
    assert.equal((await authPost(spoofed)).status, 403);
    const oversized = request('/api/auth', 'POST', undefined, {
      operation: 'login',
      password: 'x'.repeat(5000),
    });
    assert.equal((await authPost(oversized)).status, 413);
    assert.match(
      sessionCookie(new Request('https://localhost/api/auth'), 'token'),
      /; Secure$/
    );
    assert.equal(
      requestToken(
        new Request(origin, {
          headers: { cookie: `${AUTH_COOKIE}=one; ${AUTH_COOKIE}=two` },
        })
      ),
      undefined
    );
  }));

test('password hashes created by the Bun CLI are verifiable by Node, and concurrent initialization never overwrites credentials', async () =>
  fixture(async (root) => {
    const { spawnSync } = await import('node:child_process');
    const outcomes = await Promise.allSettled([
      new Authentication(root).setPassword(password),
      new Authentication(root).setPassword('different temporary password'),
    ]);
    assert.equal(
      outcomes.filter((result) => result.status === 'fulfilled').length,
      1
    );
    const chosen =
      outcomes[0].status === 'fulfilled'
        ? password
        : 'different temporary password';
    const credentials = (await new Authentication(root).credentials())!.value;
    const script = `const fs=require('node:fs'),crypto=require('node:crypto');const {password,salt,hash}=JSON.parse(fs.readFileSync(0,'utf8'));crypto.scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024},(error,key)=>{if(error)throw error;process.exitCode=crypto.timingSafeEqual(key,Buffer.from(hash,'hex'))?0:1;});`;
    const result = spawnSync('node', ['-e', script], {
      input: JSON.stringify({ password: chosen, ...credentials }),
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      await new Authentication(root).credentials().then((v) => v!.value.salt),
      credentials.salt
    );
  }));

test('password-file administration does not echo secrets, rejects unsafe files and resets only explicitly', async () =>
  fixture(async (root) => {
    const { spawnSync } = await import('node:child_process');
    const input = path.join(root, 'password.txt'),
      directory = path.join(root, 'service');
    await fs.writeFile(input, password + '\n', { mode: 0o600 });
    const run = (...flags: string[]) =>
      spawnSync(
        process.execPath,
        [
          '--no-env-file',
          'run',
          path.resolve('scripts/auth-password.ts'),
          '--password-file',
          input,
          ...flags,
        ],
        {
          encoding: 'utf8',
          timeout: 10000,
          env: {
            NODE_ENV: 'test',
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            MARKDOCK_DATA_DIR: directory,
          },
        }
      );
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!(result.stdout + result.stderr).includes(password));
    const auth = new Authentication(directory);
    const token = await auth.login(password);
    result = run();
    assert.notEqual(result.status, 0);
    assert.equal(await auth.authenticated(token), true);
    result = run('--reset');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await auth.authenticated(token), false);
    await fs.chmod(input, 0o644);
    assert.notEqual(run('--reset').status, 0);
    await fs.unlink(input);
    await fs.writeFile(path.join(root, 'secret'), password, { mode: 0o600 });
    await fs.symlink('secret', input);
    assert.notEqual(run('--reset').status, 0);
  }));
