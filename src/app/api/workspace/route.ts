import { z } from 'zod';
import { requireWorkspaceRequest } from '@/features/auth/server/request';
import { progressResponse } from '@/features/workspace/server/progress-stream';
import { readWorkspaceJson } from '@/features/workspace/server/request-json';
import { failure, files } from '@/features/workspace/server/server';
import {
  changePins,
  managementState,
} from '@/features/workspace/server/workspace-management';
import {
  resourceTarget,
  settingsInputSchema,
} from '@/features/workspace/shared/resource-policy';
import { WorkspaceError } from '@/features/workspace/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const text = z.string().max(4096);
const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('management') }),
  z.object({
    operation: z.literal('pins'),
    action: z.enum(['pin', 'unpin']),
    paths: z.array(text).max(1000),
    revision: text,
  }),
  z.object({
    operation: z.literal('browse'),
    query: z.object({ scope: z.literal('host'), path: text.optional() }),
  }),
  z.object({ operation: z.literal('settings'), id: text }),
  z.object({
    operation: z.literal('settings-save'),
    id: text,
    input: settingsInputSchema,
    revision: text,
  }),
  z.object({ operation: z.literal('trash-list'), id: text }),
  z.object({
    operation: z.literal('trash'),
    id: text,
    path: text,
    version: text,
  }),
  z.object({
    operation: z.literal('trash-restore'),
    id: text,
    entry: z.string().uuid(),
  }),
  z.object({
    operation: z.literal('trash-purge'),
    id: text,
    entries: z.array(z.string().uuid()).min(1).max(5000),
  }),
  z.object({
    operation: z.literal('search'),
    id: text,
    query: z.string().max(200),
    exclude: z.array(text).max(5000).default([]),
  }),
  z.object({ operation: z.literal('open'), root: text }),
  z.object({
    operation: z.literal('save'),
    id: text,
    path: text,
    content: z.string().max(5 * 1024 * 1024),
    version: text,
  }),
  z.object({
    operation: z.literal('create'),
    id: text,
    parent: text,
    name: text,
    kind: z.enum(['file', 'directory']),
    content: z
      .string()
      .max(5 * 1024 * 1024)
      .optional(),
  }),
  z.object({
    operation: z.literal('rename'),
    id: text,
    path: text,
    name: text,
    version: text.optional(),
  }),
  z.object({
    operation: z.literal('move'),
    id: text,
    path: text,
    parent: text,
    version: text,
  }),
]);

export async function POST(request: Request) {
  try {
    await requireWorkspaceRequest(request);
    if (
      request.headers.get('content-type')?.startsWith('multipart/form-data')
    ) {
      const limit = 21 * 1024 * 1024;
      if (Number(request.headers.get('content-length')) > limit)
        throw new WorkspaceError('图片不能超过 20 MB。', 413);
      const reader = request.body?.getReader();
      if (!reader) throw new WorkspaceError('缺少图片。');
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > limit) {
          await reader.cancel();
          throw new WorkspaceError('图片不能超过 20 MB。', 413);
        }
        chunks.push(next.value);
      }
      const form = await new Response(Buffer.concat(chunks), {
        headers: { 'Content-Type': request.headers.get('content-type')! },
      }).formData();
      if (form.get('operation') !== 'upload-image')
        throw new WorkspaceError('未知文件操作。');
      const image = form.get('image');
      if (!(image instanceof File)) throw new WorkspaceError('请选择图片。');
      return Response.json(
        await files.uploadImage(
          text.parse(form.get('id')),
          text.parse(form.get('path')),
          new Uint8Array(await image.arrayBuffer()),
          request.signal,
          image.name,
          form.get('revision') ? text.parse(form.get('revision')) : undefined
        )
      );
    }
    const data = schema.parse(await readWorkspaceJson(request));
    switch (data.operation) {
      case 'management':
        return Response.json(await managementState(files));
      case 'pins':
        return Response.json(
          await changePins(files, data.action, data.paths, data.revision)
        );
      case 'browse':
        return Response.json(await files.browse(data.query));
      case 'settings':
        return Response.json(await files.settings(data.id));
      case 'settings-save':
        return Response.json(
          await files.updateSettings(data.id, data.input, data.revision)
        );
      case 'trash-list':
        return Response.json(await files.trashList(data.id));
      case 'trash':
        return Response.json(
          await files.trash(data.id, data.path, data.version)
        );
      case 'trash-restore':
        return Response.json(await files.restore(data.id, data.entry));
      case 'trash-purge':
        return Response.json(await files.purge(data.id, data.entries));
      case 'search':
        return Response.json(
          await files.search(data.id, data.query, data.exclude, request.signal),
          { headers: { 'Cache-Control': 'no-store' } }
        );
      case 'open':
        if (request.headers.get('accept') === 'application/x-ndjson')
          return progressResponse(
            request,
            (options) => files.open(data.root, options),
            failure
          );
        return Response.json(await files.open(data.root));
      case 'save':
        return Response.json(
          await files.save(data.id, data.path, data.content, data.version)
        );
      case 'create':
        return Response.json(
          await files.create(
            data.id,
            data.parent,
            data.name,
            data.kind,
            data.content
          )
        );
      case 'rename':
        return Response.json(
          await files.rename(data.id, data.path, data.name, data.version)
        );
      case 'move':
        return Response.json(
          await files.move(data.id, data.path, data.parent, data.version)
        );
    }
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request) {
  try {
    await requireWorkspaceRequest(request);
    const params = new URL(request.url).searchParams;
    const id = params.get('id') ?? '';
    const relative = params.get('path') ?? '';
    switch (params.get('operation')) {
      case 'resources':
        return Response.json(
          await files.resources(
            id,
            relative,
            params.get('cursor') ?? undefined,
            request.signal
          ),
          { headers: { 'Cache-Control': 'no-store' } }
        );
      case 'tree':
        if (request.headers.get('accept') === 'application/x-ndjson')
          return progressResponse(
            request,
            (options) =>
              files.tree(
                id,
                options,
                params.get('includeResources') === 'true'
              ),
            failure
          );
        return Response.json(
          await files.tree(
            id,
            undefined,
            params.get('includeResources') === 'true'
          ),
          {
            headers: { 'Cache-Control': 'no-store' },
          }
        );
      case 'read':
        return Response.json(await files.read(id, relative), {
          headers: { 'Cache-Control': 'no-store' },
        });
      case 'asset': {
        const raw = params.get('url');
        const resolved =
          raw === null
            ? relative
            : resourceTarget(
                params.get('document') ?? '',
                raw,
                (await files.settings(id)).settings
              );
        if (!resolved) throw new WorkspaceError('图片地址未配置或越界。', 403);
        const asset = await (params.get('scope') === 'resource'
          ? files.resourceImage(id, resolved, request.signal)
          : files.asset(id, resolved));
        return new Response(new Uint8Array(asset.data), {
          headers: {
            'Content-Type': asset.type,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'",
          },
        });
      }
      default:
        throw new WorkspaceError('未知文件操作。');
    }
  } catch (error) {
    return failure(error);
  }
}
