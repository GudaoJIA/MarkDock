import type { SettingsSnapshot } from './resource-policy';
export type TreeEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  children?: TreeEntry[];
  /** Read-only resource folder; children are loaded only when expanded. */
  resource?: boolean;
};

export type Workspace = {
  id: string;
  root: string;
  name: string;
  settings?: SettingsSnapshot;
};
export type FileSnapshot = { path: string; content: string; version: string };
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
export type TrashEntry = {
  version: 1 | 2;
  resources?: string[];
  id: string;
  path: string;
  deletedAt: string;
  assets: boolean;
  state: 'trashed' | 'deleting';
};

export class WorkspaceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'WorkspaceError';
  }
}

export type PathChange = { from: string; to: string };
export type RelocationResult = {
  path: string;
  mappings: PathChange[];
  files: FileSnapshot[];
};

export type DirectoryQuery = { scope: 'host'; path?: string };
export type DirectoryListing = {
  path: string;
  parent: string | null;
  breadcrumbs: { name: string; path: string }[];
  directories: { name: string; path: string }[];
};
