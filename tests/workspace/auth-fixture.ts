import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  authentication,
  AUTH_COOKIE,
} from '../../src/features/auth/server/authentication';

export async function withAuthentication(
  run: (cookie: string, directory: string) => Promise<void>
) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'markdock-auth-test-'))
  );
  const previous = process.env.MARKDOCK_DATA_DIR;
  process.env.MARKDOCK_DATA_DIR = directory;
  try {
    const auth = authentication();
    await auth.setPassword('isolated test password only');
    const token = await auth.login('isolated test password only');
    try {
      await run(`${AUTH_COOKIE}=${token}`, directory);
    } finally {
      auth.logout(token);
    }
  } finally {
    if (previous === undefined) delete process.env.MARKDOCK_DATA_DIR;
    else process.env.MARKDOCK_DATA_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
}
