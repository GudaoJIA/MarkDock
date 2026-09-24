import { z } from 'zod';
import { checkRequest } from '@/features/auth/server/access';
import {
  authentication,
  requestToken,
  sessionCookie,
} from '@/features/auth/server/authentication';
import { readWorkspaceJson } from '@/features/workspace/server/request-json';
import { failure } from '@/features/workspace/server/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const input = z.discriminatedUnion('operation', [
  z
    .object({ operation: z.literal('login'), password: z.string().max(512) })
    .strict(),
  z.object({ operation: z.literal('logout') }).strict(),
]);
export async function POST(request: Request) {
  try {
    checkRequest(request);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return Response.json(
        { error: '请求格式不正确。' },
        { status: 415, headers: { 'Cache-Control': 'no-store' } }
      );
    const body = input.parse(await readWorkspaceJson(request, 4096));
    const auth = authentication();
    const token =
      body.operation === 'login' ? await auth.login(body.password) : '';
    // A successful login rotates the current browser token as well.
    auth.logout(requestToken(request));
    return Response.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Set-Cookie': sessionCookie(request, token),
        },
      }
    );
  } catch (error) {
    const response = failure(error);
    response.headers.set('Cache-Control', 'no-store');
    if (response.status === 429) response.headers.set('Retry-After', '60');
    return response;
  }
}
