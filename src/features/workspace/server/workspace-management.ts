import path from 'node:path';
import { WorkspaceError } from '../shared/types';
import type { FileService } from './files';
export async function managementState(files: FileService) {
  const snapshot = await files.serviceConfig.read();
  const pins = await Promise.all(
    snapshot.settings.pins.map(async (root) => {
      try {
        await files.browse({ scope: 'host', path: root });
        return { root, name: path.basename(root) || root };
      } catch (e) {
        return {
          root,
          name: path.basename(root) || root,
          error: (e as Error).message,
        };
      }
    })
  );
  return { ...snapshot, pins, locations: await files.locations() };
}
export async function changePins(
  files: FileService,
  action: 'pin' | 'unpin',
  paths: string[],
  revision: string
) {
  const normalized = paths.map((root) => {
    if (!path.isAbsolute(root) || root.includes('\0'))
      throw new WorkspaceError('工作区路径必须是绝对路径。');
    return path.resolve(root);
  });
  if (action === 'pin')
    for (const root of normalized)
      await files.browse({ scope: 'host', path: root });
  await files.serviceConfig.update(revision, (current) => {
    const pins =
      action === 'unpin'
        ? current.pins.filter((root) => !normalized.includes(root))
        : [...new Set([...current.pins, ...normalized])];
    return { ...current, pins };
  });
  return managementState(files);
}
