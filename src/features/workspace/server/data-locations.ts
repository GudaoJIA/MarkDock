import path from 'node:path';
import { WorkspaceError } from '../shared/types';
import { readDataRoots } from './deployment.mjs';
export function configuredDataRoots(
  raw = process.env.MARKDOCK_WORKSPACE_ROOTS
): string[] | null {
  try {
    return readDataRoots(raw);
  } catch (error) {
    throw new WorkspaceError((error as Error).message, 500);
  }
}

export function dataBoundary(target: string, roots: string[] | null): string {
  if (roots === null) return path.parse(target).root;
  const match = roots
    .filter((root) => {
      const relative = path.relative(root, target);
      return (
        relative === '' ||
        (!path.isAbsolute(relative) &&
          relative !== '..' &&
          !relative.startsWith(`..${path.sep}`))
      );
    })
    .sort((a, b) => b.length - a.length)[0];
  if (!match) throw new WorkspaceError('目录不在部署允许的数据位置内。', 403);
  return match;
}
