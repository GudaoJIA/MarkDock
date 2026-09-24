import { z } from 'zod';
import { WorkspaceError } from '../shared/types';
import { FileService } from './files';

const state = globalThis as typeof globalThis & {
  noteaiFileService?: FileService;
};
export const files = state.noteaiFileService ?? new FileService();
// Keep opened roots and in-flight queues while refreshing methods during HMR.
if (process.env.NODE_ENV === 'development')
  Object.setPrototypeOf(files, FileService.prototype);
state.noteaiFileService = files;
export function failure(error: unknown) {
  if (error instanceof WorkspaceError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } }
    );
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json(
      { error: '请求格式不正确。' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  const code = (error as NodeJS.ErrnoException).code;
  const messages: Record<string, [number, string]> = {
    ENOENT: [404, '文件或目录不存在，可能已被移动。'],
    EEXIST: [409, '已存在同名文件或文件夹。'],
    EACCES: [403, '没有权限访问此文件或目录。'],
    EPERM: [403, '系统拒绝了此次文件操作。'],
    ENOTDIR: [400, '路径不是目录。'],
  };
  const [status, message] = messages[code ?? ''] ?? [
    500,
    '文件操作失败，请检查磁盘和目录权限后重试。',
  ];
  return Response.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}
