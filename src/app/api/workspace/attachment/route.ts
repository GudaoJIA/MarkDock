import { z } from 'zod';
import { requireWorkspaceRequest } from '@/features/auth/server/request';
import { failure, files } from '@/features/workspace/server/server';
import { MAX_ATTACHMENT_BYTES } from '@/features/workspace/shared/attachments';
import { WorkspaceError } from '@/features/workspace/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const parameters = z.object({
  id: z.string().min(1).max(4096),
  path: z.string().min(1).max(4096),
});
const filename = z.string().min(1).max(255);
const HEADER_ESCAPE = /['()*]/g;
const encodedName = (name: string) =>
  encodeURIComponent(name).replace(
    HEADER_ESCAPE,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

export async function POST(request: Request) {
  try {
    await requireWorkspaceRequest(request);
    const query = new URL(request.url).searchParams;
    const { id, path } = parameters.parse(Object.fromEntries(query));
    const name = filename.parse(query.get('name'));
    if (Number(request.headers.get('content-length')) > MAX_ATTACHMENT_BYTES)
      throw new WorkspaceError('附件不能超过 100 MB。', 413);
    const body =
      request.body ??
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    return Response.json(
      await files.uploadAttachment(
        id,
        path,
        name,
        body,
        request.signal,
        query.get('revision') ?? undefined
      ),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return failure(error);
  }
}

async function download(request: Request, head: boolean) {
  try {
    await requireWorkspaceRequest(request);
    const { id, path } = parameters.parse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    const resource =
      new URL(request.url).searchParams.get('scope') === 'resource';
    const attachment = await (resource
      ? files.resourceDownload(id, path, request.signal, head)
      : files.attachment(id, path, request.signal, head));
    return new Response(head ? null : attachment.stream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodedName(attachment.name)}`,
        'Content-Length': String(attachment.size),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
export const GET = (request: Request) => download(request, false);
export const HEAD = (request: Request) => download(request, true);
