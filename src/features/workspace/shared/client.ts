import { reportAuthentication } from '@/features/auth/ui/session-expiry';
import type { ScanOptions } from './open-progress';
import { progressRequest } from './progress-client';
import type { ResourceListing } from './resource-listing';
import type { SettingsInput, SettingsSnapshot } from './resource-policy';
import {
  type DirectoryListing,
  type DirectoryQuery,
  type FileSnapshot,
  type RelocationResult,
  type TrashEntry,
  type TreeEntry,
  type Workspace,
  WorkspaceError,
} from './types';

export async function fileRequest<T>(
  operation: string,
  data: Record<string, unknown> = {},
  get = false,
  signal?: AbortSignal
): Promise<T> {
  const params = new URLSearchParams({ operation });
  if (get)
    for (const [key, value] of Object.entries(data))
      params.set(key, String(value));
  const response = await fetch(
    get ? `/api/workspace?${params}` : '/api/workspace',
    {
      method: get ? 'GET' : 'POST',
      cache: 'no-store',
      signal,
      ...(get
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation, ...data }),
          }),
    }
  );
  reportAuthentication(response.status);
  const result = await response.json();
  if (!response.ok)
    throw new WorkspaceError(result.error || '文件操作失败。', response.status);
  return result as T;
}

export const fileClient = {
  browse: (query: DirectoryQuery) =>
    fileRequest<DirectoryListing>('browse', { query }),
  settings: (id: string) => fileRequest<SettingsSnapshot>('settings', { id }),
  saveSettings: (id: string, input: SettingsInput, revision: string) =>
    fileRequest<SettingsSnapshot>('settings-save', { id, input, revision }),
  trashList: (id: string) => fileRequest<TrashEntry[]>('trash-list', { id }),
  trash: (id: string, path: string, version: string) =>
    fileRequest<TrashEntry>('trash', { id, path, version }),
  restore: (id: string, entry: string) =>
    fileRequest<{ path: string }>('trash-restore', { id, entry }),
  purge: (id: string, entries: string[]) =>
    fileRequest<{ failed: { id: string; error: string }[] }>('trash-purge', {
      id,
      entries,
    }),
  open: (root: string, options?: ScanOptions) =>
    options
      ? progressRequest<Workspace>('open', { root }, options)
      : fileRequest<Workspace>('open', { root }),
  tree: (id: string, options?: ScanOptions) =>
    options
      ? progressRequest<TreeEntry[]>(
          'tree',
          { id, includeResources: 'true' },
          options
        )
      : fileRequest<TreeEntry[]>('tree', { id, includeResources: true }, true),
  read: (id: string, path: string) =>
    fileRequest<FileSnapshot>('read', { id, path }, true),
  save: (id: string, path: string, content: string, version: string) =>
    fileRequest<FileSnapshot>('save', { id, path, content, version }),
  create: (
    id: string,
    parent: string,
    name: string,
    kind: 'file' | 'directory',
    content = ''
  ) =>
    fileRequest<{ path: string }>('create', {
      id,
      parent,
      name,
      kind,
      content,
    }),
  rename: (id: string, path: string, name: string, version?: string) =>
    fileRequest<RelocationResult>('rename', { id, path, name, version }),
  move: (id: string, path: string, parent: string, version: string) =>
    fileRequest<RelocationResult>('move', { id, path, parent, version }),
};

export type ManagementSnapshot =
  import('./service-settings').ServiceSnapshot & {
    pins: { root: string; name: string; error?: string }[];
    locations: { root: string; name: string; error?: string }[];
  };
export const managementClient = {
  read: () => fileRequest<ManagementSnapshot>('management'),
  pins: (action: 'pin' | 'unpin', paths: string[], revision: string) =>
    fileRequest<ManagementSnapshot>('pins', { action, paths, revision }),
};

export const resourceClient = {
  list: (id: string, path: string, cursor?: string, signal?: AbortSignal) =>
    fileRequest<ResourceListing>(
      'resources',
      { id, path, ...(cursor ? { cursor } : {}) },
      true,
      signal
    ),
};
