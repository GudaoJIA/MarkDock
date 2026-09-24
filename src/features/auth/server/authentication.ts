import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  createSynced,
  makeDirectories,
  renameSynced,
  writeSynced,
} from '@/features/workspace/server/durable-fs';
import { safePath } from '@/features/workspace/server/file-transaction';
import { WorkspaceError } from '@/features/workspace/shared/types';
import { requestOrigin } from './access';

export const AUTH_COOKIE = 'markdock-session';
export const SESSION_SECONDS = 12 * 60 * 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const IDLE_MS = 30 * 60 * 1000;
const credentialSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal('scrypt'),
    salt: z.string().regex(/^[a-f0-9]{32}$/),
    hash: z.string().regex(/^[a-f0-9]{128}$/),
  })
  .strict();
const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex');
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key))
    );
  });
export function validPassword(password: string) {
  const length = [...password].length;
  return (
    length >= 15 &&
    length <= 128 &&
    [...password].every(
      (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127
    )
  );
}
export function authDirectory() {
  return (
    process.env.MARKDOCK_DATA_DIR || path.join(homedir(), '.config/markdock')
  );
}
type AuthenticationState = {
  sessions: Map<
    string,
    { revision: string; expires: number; lastSeen: number }
  >;
  verifying: boolean;
  failures: number;
  blockedUntil: number;
};
const freshState = (): AuthenticationState => ({
  sessions: new Map(),
  verifying: false,
  failures: 0,
  blockedUntil: 0,
});
export class Authentication {
  private readonly state: AuthenticationState;
  readonly directory: string;
  private readonly now: () => number;
  constructor(
    directory = authDirectory(),
    now = Date.now,
    shared = freshState()
  ) {
    this.state = shared;
    this.directory = directory;
    this.now = now;
    if (!path.isAbsolute(directory))
      throw new WorkspaceError('MARKDOCK_DATA_DIR 必须是绝对路径。');
  }
  private async filename(missing = false) {
    const filename = path.join(this.directory, '.markdock-auth.json');
    return await safePath(
      path.parse(filename).root,
      path.relative(path.parse(filename).root, filename),
      missing
    );
  }
  async credentials() {
    try {
      const filename = await this.filename(true);
      const handle = await fs.open(
        filename,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) !== 0)
          throw new Error('invalid credentials');
        const raw = await handle.readFile('utf8');
        return {
          value: credentialSchema.parse(JSON.parse(raw)),
          revision: digest(raw),
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new WorkspaceError(
        '登录配置无效或无法读取，请在服务器检查凭证文件与权限。',
        503
      );
    }
  }
  // Local administration only. Stop the service before resetting a password.
  async setPassword(password: string, reset = false) {
    if (!validPassword(password))
      throw new WorkspaceError('密码须为 15–128 个字符，不能包含控制字符。');
    const current = await this.credentials();
    if (current && !reset)
      throw new WorkspaceError(
        '已设置密码；重置前请停止服务并使用 --reset。',
        409
      );
    const salt = randomBytes(16).toString('hex');
    const value = {
      version: 1,
      algorithm: 'scrypt',
      salt,
      hash: (await derive(password, salt)).toString('hex'),
    };
    await this.filename(true);
    await makeDirectories(
      this.directory,
      path.parse(this.directory).root,
      0o700
    );
    const filename = await this.filename(true);
    const content = `${JSON.stringify(value)}\n`;
    if (current) {
      const temporary = path.join(
        this.directory,
        `.auth-${randomBytes(16).toString('hex')}.tmp`
      );
      try {
        await writeSynced(temporary, content, 'wx', 0o600);
        if ((await this.credentials())?.revision !== current.revision)
          throw new WorkspaceError('登录配置已被修改，请重试。', 409);
        await renameSynced(temporary, filename);
      } finally {
        await fs.unlink(temporary).catch(() => undefined);
      }
    } else await createSynced(filename, content, 0o600);
    this.state.sessions.clear();
    this.state.failures = 0;
    this.state.blockedUntil = 0;
  }
  async login(password: string) {
    if (this.state.verifying || this.now() < this.state.blockedUntil)
      throw new WorkspaceError('登录尝试过于频繁，请稍后重试。', 429);
    this.state.verifying = true;
    try {
      const current = await this.credentials();
      if (!current)
        throw new WorkspaceError('尚未设置密码，请先在服务器初始化登录。', 503);
      const matches =
        validPassword(password) &&
        timingSafeEqual(
          await derive(password, current.value.salt),
          Buffer.from(current.value.hash, 'hex')
        );
      if (!matches) {
        this.state.failures++;
        if (this.state.failures >= 5) {
          this.state.blockedUntil = this.now() + 60_000;
          this.state.failures = 0;
        }
        throw new WorkspaceError('密码不正确。', 401);
      }
      if ((await this.credentials())?.revision !== current.revision)
        throw new WorkspaceError('登录配置已被修改，请重试。', 409);
      this.state.failures = 0;
      this.state.blockedUntil = 0;
      const now = this.now();
      for (const [key, session] of this.state.sessions)
        if (
          session.expires <= now ||
          session.lastSeen + IDLE_MS <= now ||
          session.revision !== current.revision
        )
          this.state.sessions.delete(key);
      if (this.state.sessions.size >= 32)
        this.state.sessions.delete(this.state.sessions.keys().next().value!);
      const token = randomBytes(32).toString('base64url');
      this.state.sessions.set(digest(token), {
        revision: current.revision,
        expires: now + SESSION_SECONDS * 1000,
        lastSeen: now,
      });
      return token;
    } finally {
      this.state.verifying = false;
    }
  }
  async authenticated(token?: string) {
    if (!token || !TOKEN.test(token)) return false;
    const key = digest(token);
    const session = this.state.sessions.get(key);
    if (!session) return false;
    const now = this.now();
    if (
      session.expires <= now ||
      session.lastSeen + IDLE_MS <= now ||
      session.revision !== (await this.credentials())?.revision
    ) {
      this.state.sessions.delete(key);
      return false;
    }
    session.lastSeen = now;
    return true;
  }
  logout(token?: string) {
    if (token) this.state.sessions.delete(digest(token));
  }
}
const state = globalThis as typeof globalThis & {
  markdockAuth?: Map<string, AuthenticationState>;
};
state.markdockAuth ??= new Map();
export function authentication() {
  const configured = authDirectory();
  if (!path.isAbsolute(configured))
    throw new WorkspaceError('MARKDOCK_DATA_DIR 必须是绝对路径。');
  const directory = path.normalize(configured);
  let shared = state.markdockAuth!.get(directory);
  if (!shared) {
    shared = freshState();
    state.markdockAuth!.set(directory, shared);
  }
  // Server Components and Route Handlers have separate module constructors.
  // Share plain state only; errors must belong to the calling bundle.
  return new Authentication(directory, Date.now, shared);
}
export function requestToken(request: Request) {
  const entries = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${AUTH_COOKIE}=`));
  return entries.length === 1
    ? entries[0].slice(AUTH_COOKIE.length + 1)
    : undefined;
}
export function sessionCookie(request: Request, token: string) {
  return `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_SECONDS : 0}${requestOrigin(request.headers, new URL(request.url)).startsWith('https:') ? '; Secure' : ''}`;
}
