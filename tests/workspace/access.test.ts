import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deployment } from '../../src/features/workspace/server/deployment.mjs';
import { checkRequest, requestOrigin } from '../../src/features/auth/server/access';
import { sessionCookie } from '../../src/features/auth/server/authentication';
import { POST } from '../../src/app/api/auth/route';

const remote = {
  MARKDOCK_PUBLIC_ORIGIN: 'https://notes.example.test:8443',
  MARKDOCK_WORKSPACE_ROOTS: '["/workspaces"]',
  MARKDOCK_DATA_DIR: '/service-data',
  MARKDOCK_HOST: '0.0.0.0',
};
function configured<T>(env: Record<string, string | undefined>, run: () => T): T {
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
function request(method = 'POST', override: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/auth', {
    method,
    headers: { host: 'notes.example.test:8443', origin: remote.MARKDOCK_PUBLIC_ORIGIN,
      'sec-fetch-site': 'same-origin', ...override },
  });
}

test('remote access is explicit HTTPS with mandatory roots/data; local startup stays loopback', () => {
  assert.deepEqual(deployment({}), { hostname: '127.0.0.1', port: 3000, origin: null, roots: null });
  assert.equal(deployment(remote).origin, remote.MARKDOCK_PUBLIC_ORIGIN);
  for (const origin of ['http://notes.example.test', 'https://notes.example.test/',
    'https://notes.example.test/path', 'https://user:password@notes.example.test',
    'https://notes.example.test?x', 'https://notes.example.test#x', 'null', 'not-url'])
    assert.throws(() => deployment({...remote, MARKDOCK_PUBLIC_ORIGIN: origin}));
  for (const roots of ['', '[]', 'null', '["relative"]', '{}'])
    assert.throws(() => deployment({...remote, MARKDOCK_WORKSPACE_ROOTS: roots}));
  for (const directory of ['', 'relative'])
    assert.throws(() => deployment({...remote, MARKDOCK_DATA_DIR: directory}));
  for (const host of ['0.0.0.0', '::', '192.168.1.3'])
    assert.throws(() => deployment({MARKDOCK_HOST: host}));
  for (const port of ['0', '65536', '1.5', '-1', 'abc'])
    assert.throws(() => deployment({PORT: port}));
  assert.throws(() => deployment({MARKDOCK_HOST: 'some-host.example'}));
});

test('proxy host, scheme, port and Origin are checked against configuration, never forwarded headers', () => configured(remote, () => {
  assert.equal(checkRequest(request()), remote.MARKDOCK_PUBLIC_ORIGIN);
  assert.match(sessionCookie(request(), 'token'), /; Secure$/);
  assert.match(sessionCookie(request(), ''), /Max-Age=0; Secure$/);
  for (const host of ['localhost:3000', 'other.example', 'notes.example.test',
    'notes.example.test:8443.evil', 'notes.example.test:8443/path', 'user@notes.example.test:8443',
    'notes.example.test:8443,evil.example', 'notes.example.test:8443#x'])
    assert.throws(() => checkRequest(request('POST', { host,
      'x-forwarded-host': 'notes.example.test:8443', 'x-forwarded-proto': 'https' })), /站点/);
  for (const origin of ['http://notes.example.test:8443', 'https://notes.example.test', 'null',
    'https://notes.example.test:8443.evil', '', 'https://evil.example'])
    assert.throws(() => checkRequest(request('POST', {origin})));
  for (const site of ['cross-site', 'same-site', 'none'])
    assert.throws(() => checkRequest(request('GET', {'sec-fetch-site': site})));
  for (const method of ['GET', 'HEAD']) {
    const r = request(method); r.headers.delete('origin');
    assert.doesNotThrow(() => checkRequest(r));
    r.headers.set('origin', 'https://evil.example');
    assert.throws(() => checkRequest(r));
  }
  const forged = request('POST', { 'x-forwarded-host': 'evil.example',
    'x-forwarded-proto': 'http', forwarded: 'host=evil.example;proto=http' });
  assert.equal(checkRequest(forged), remote.MARKDOCK_PUBLIC_ORIGIN);
  assert.match(sessionCookie(forged, 'token'), /; Secure$/);
  assert.equal(requestOrigin(new Headers({host:'notes.example.test:8443'})), remote.MARKDOCK_PUBLIC_ORIGIN);
  assert.throws(() => requestOrigin(new Headers()), /站点/);
}));

test('missing/invalid deployment configuration fails before authentication body is consumed', async () => {
  const original = process.env.MARKDOCK_PUBLIC_ORIGIN;
  process.env.MARKDOCK_PUBLIC_ORIGIN = 'http://insecure.example';
  try {
    const req = new Request('http://localhost/api/auth', { method: 'POST',
      headers: {origin:'http://localhost', 'content-type':'application/json'},
      body: JSON.stringify({operation:'login',password:'not a real password'}) });
    assert.equal((await POST(req)).status, 503);
    assert.equal(req.bodyUsed, false);
  } finally {
    if (original === undefined) delete process.env.MARKDOCK_PUBLIC_ORIGIN;
    else process.env.MARKDOCK_PUBLIC_ORIGIN = original;
  }
});

test('local source/host checks remain closed, forwarded HTTPS does not upgrade cookies', () => {
  const r = new Request('http://localhost:3000/api/auth', {method:'POST',headers:{
    host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','x-forwarded-proto':'https'}});
  assert.doesNotThrow(() => checkRequest(r));
  assert.doesNotMatch(sessionCookie(r,'token'), /Secure/);
  r.headers.set('host', 'evil.example');
  assert.throws(() => checkRequest(r));
});

test('production launcher loads env before binding and invalid configuration exits without starting Next', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-start-'));
  try {
    await fs.writeFile(path.join(root,'.env.production'), 'MARKDOCK_HOST=0.0.0.0\n');
    const result = spawnSync('node', [path.resolve('scripts/start.mjs')], {
      cwd: root, encoding:'utf8', timeout:10000,
      env: {PATH:process.env.PATH, HOME:process.env.HOME, NODE_ENV:'production'},
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /MARKDOCK_PUBLIC_ORIGIN/);
    assert.doesNotMatch(result.stdout, /Ready|Local:/);
    assert.deepEqual(await fs.readdir(root), ['.env.production']);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
