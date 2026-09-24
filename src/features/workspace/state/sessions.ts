import type { fileClient } from '../shared/client';
import {
  checkCancelled,
  reportProgress,
  type ScanOptions,
} from '../shared/open-progress';
import type { SettingsInput } from '../shared/resource-policy';
import {
  type FileSnapshot,
  type RelocationResult,
  type SaveState,
  type TreeEntry,
  type Workspace,
  WorkspaceError,
} from '../shared/types';
import type { EditableDocument, EditingMode } from './editable-document';
import { HistoryBudget } from './history-budget';
import {
  readEditingMode,
  remapEditingModes,
  saveEditingMode,
} from './view-preferences';

export type DocumentAdapter<E> = {
  create: (
    file: FileSnapshot,
    workspace: Workspace,
    history?: HistoryBudget
  ) => {
    editor: E;
    serialize: () => string;
    readOnlyReason?: string;
    document?: EditableDocument;
  };
};

export type DocumentSession<E> = {
  key: string;
  path: string;
  file: FileSnapshot;
  editor: E;
  document?: EditableDocument;
  pendingMode?: EditingMode;
  serialize: () => string;
  savedSerialized: string;
  state: SaveState;
  error?: string;
  readOnlyReason?: string;
  composing: boolean;
  scroll: number;
  selection?: unknown;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<boolean>;
};

export class WorkspaceController<E> {
  workspace?: Workspace;
  tree: TreeEntry[] = [];
  active?: DocumentSession<E>;
  documents = new Map<string, DocumentSession<E>>();
  busy = false;
  error = '';
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private polling = false;
  private pollingEnabled = true;
  private pollGeneration = 0;
  setPolling(enabled: boolean) {
    this.pollingEnabled = enabled;
    this.pollGeneration++;
  }
  private taskPending = false;
  beginTask(doc: DocumentSession<E>) {
    if (this.busy || doc.composing || doc !== this.active) return;
    this.busy = true;
    this.taskPending = true;
    this.emit();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.busy = false;
      this.taskPending = false;
      this.emit();
    };
  }
  private readonly client: typeof fileClient;
  private readonly adapter: DocumentAdapter<E>;

  readonly history: HistoryBudget;
  constructor(
    client: typeof fileClient,
    adapter: DocumentAdapter<E>,
    history = new HistoryBudget()
  ) {
    this.history = history;
    this.client = client;
    this.adapter = adapter;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  emit = () => {
    this.revision++;
    for (const listener of this.listeners) listener();
  };
  clearError() {
    this.error = '';
    this.emit();
  }
  rememberSelection(doc: DocumentSession<E>, selection: unknown) {
    if (selection) doc.selection = structuredClone(selection);
  }
  rememberScroll(doc: DocumentSession<E>, scroll: number) {
    doc.scroll = scroll;
  }
  private message(error: unknown) {
    return error instanceof Error ? error.message : '操作失败，请重试。';
  }

  private make(file: FileSnapshot): DocumentSession<E> {
    const parsed = this.adapter.create(file, this.workspace!, this.history);
    const doc: DocumentSession<E> = {
      ...parsed,
      key: crypto.randomUUID(),
      path: file.path,
      file,
      savedSerialized: parsed.serialize(),
      state: 'saved' as SaveState,
      composing: false,
      scroll: 0,
    };
    doc.document?.connect(() => this.changed(doc));
    doc.document?.switchMode(readEditingMode(this.workspace!.root, file.path));
    return doc;
  }

  switchMode(doc: DocumentSession<E>) {
    if (!doc.document) return;
    const mode =
      (doc.pendingMode ?? doc.document.mode) === 'rich' ? 'source' : 'rich';
    if (doc.composing) {
      doc.pendingMode = mode;
      return;
    }
    this.applyMode(doc, mode);
  }
  private applyMode(doc: DocumentSession<E>, mode: EditingMode) {
    if (!doc.document) return;
    if (doc.document.mode === 'rich') doc.document.richScroll = doc.scroll;
    doc.document.switchMode(mode);
    if (mode === 'rich') {
      doc.selection = doc.document.richSelection;
      doc.scroll = doc.document.richScroll;
    }
    saveEditingMode(this.workspace!.root, doc.path, mode);
    doc.pendingMode = undefined;
    this.emit();
  }

  async open(root: string) {
    if (this.busy) return false;
    this.busy = true;
    this.error = '';
    this.emit();
    try {
      if (!(await this.flushAll())) return false;
      const workspace = await this.client.open(root);
      const tree = await this.client.tree(workspace.id);
      this.workspace = workspace;
      this.tree = tree;
      for (const doc of this.documents.values()) {
        clearTimeout(doc.timer);
        doc.document?.dispose?.();
      }
      this.documents.clear();
      this.active = undefined;
      return true;
    } catch (error) {
      this.error = this.message(error);
      return false;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Called while the workspace manager holds the transition lock. */
  async resume(
    workspace: Workspace,
    options?: ScanOptions,
    preferred?: string
  ) {
    const tree = await this.client.tree(workspace.id, options);
    checkCancelled(options);
    const paths: string[] = [];
    const collect = (entries: TreeEntry[]) => {
      for (const entry of entries) {
        if (entry.resource) continue;
        if (entry.kind === 'file') paths.push(entry.path);
        else collect(entry.children ?? []);
      }
    };
    collect(tree);
    const previous = this.active;
    const path =
      previous?.path ??
      (preferred && paths.includes(preferred) ? preferred : paths[0]);
    let file: FileSnapshot | undefined;
    if (path) {
      reportProgress(options, { stage: 'document', cancellable: false });
      file = await this.client.read(workspace.id, path);
    }
    checkCancelled(options);
    // No view/session mutation before all reads and cancellation checks finish.
    if (this.workspace) Object.assign(this.workspace, workspace);
    else this.workspace = workspace;
    this.tree = tree;
    this.error = '';
    if (previous && file && file.version !== previous.file.version) {
      if (previous.state === 'saved') {
        const replacement = this.make(file);
        previous.document?.dispose?.();
        replacement.scroll = previous.scroll;
        this.documents.set(previous.path, replacement);
        this.active = replacement;
      } else this.conflict(previous);
    } else if (!previous && file) {
      const doc = this.documents.get(file.path);
      if (
        !doc ||
        (doc.file.version !== file.version && doc.state === 'saved')
      ) {
        const replacement = this.make(file);
        doc?.document?.dispose?.();
        this.documents.set(file.path, replacement);
        this.active = replacement;
      } else {
        if (doc.file.version !== file.version) this.conflict(doc);
        this.active = doc;
      }
    }
    this.emit();
  }

  async select(path: string) {
    if (!this.workspace || this.busy || this.active?.path === path) return;
    this.busy = true;
    this.error = '';
    this.emit();
    try {
      if (this.active && !(await this.flush(this.active))) return;
      let doc = this.documents.get(path);
      const file = await this.client.read(this.workspace.id, path);
      if (
        !doc ||
        (doc.file.version !== file.version && doc.state === 'saved')
      ) {
        const replacement = this.make(file);
        clearTimeout(doc?.timer);
        doc?.document?.dispose?.();
        doc = replacement;
        this.documents.set(path, doc);
      } else if (doc.file.version !== file.version) this.conflict(doc);
      this.active = doc;
    } catch (error) {
      this.error = this.message(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  changed(doc: DocumentSession<E>) {
    if (doc.readOnlyReason) return;
    doc.document?.capture();
    clearTimeout(doc.timer);
    if (doc.state !== 'conflict' && doc.state !== 'error') {
      doc.state = doc.serialize() === doc.savedSerialized ? 'saved' : 'dirty';
      if (doc.state === 'dirty' && !doc.composing)
        doc.timer = setTimeout(() => {
          void this.flush(doc);
        }, 800);
    }
    this.emit();
  }

  composition(doc: DocumentSession<E>, composing: boolean) {
    doc.document?.composition(composing);
    doc.composing = composing;
    clearTimeout(doc.timer);
    if (composing) this.emit();
    else {
      this.changed(doc);
      if (doc.pendingMode) this.applyMode(doc, doc.pendingMode);
    }
  }

  async flush(doc: DocumentSession<E>): Promise<boolean> {
    clearTimeout(doc.timer);
    if (doc.composing) {
      this.error = '请先完成输入法组字，再切换文档。';
      this.emit();
      return false;
    }
    if (doc.saving) return doc.saving;
    if (doc.state === 'conflict') return false;
    if (doc.readOnlyReason || doc.serialize() === doc.savedSerialized) {
      doc.state = 'saved';
      this.emit();
      return true;
    }
    const id = this.workspace!.id;
    doc.saving = (async () => {
      try {
        while (doc.serialize() !== doc.savedSerialized) {
          if (doc.composing) {
            doc.state = 'dirty';
            return false;
          }
          const content = doc.serialize();
          doc.state = 'saving';
          doc.error = undefined;
          this.emit();
          const file = await this.client.save(
            id,
            doc.path,
            content,
            doc.file.version
          );
          doc.file = file;
          doc.savedSerialized = content;
        }
        doc.state = 'saved';
        return true;
      } catch (error) {
        doc.state =
          error instanceof WorkspaceError && [409, 404].includes(error.status)
            ? 'conflict'
            : 'error';
        doc.error = this.message(error);
        return false;
      } finally {
        doc.saving = undefined;
        this.emit();
      }
    })();
    return doc.saving;
  }

  async flushAll() {
    for (const doc of this.documents.values()) {
      if (!(await this.flush(doc))) return false;
    }
    return true;
  }

  hasUnsaved() {
    return (
      this.taskPending ||
      [...this.documents.values()].some(
        (doc) => doc.composing || doc.state !== 'saved' || !!doc.saving
      )
    );
  }

  private conflict(doc: DocumentSession<E>) {
    clearTimeout(doc.timer);
    doc.state = 'conflict';
    doc.error = '磁盘上的文件发生了变化，自动保存已暂停。';
  }

  async poll() {
    if (!this.workspace || this.busy || this.polling || !this.pollingEnabled)
      return;
    this.polling = true;
    const generation = this.pollGeneration;
    const workspace = this.workspace;
    const active = this.active;
    try {
      if (workspace.settings) {
        const settings = await this.client.settings(workspace.id);
        if (
          generation !== this.pollGeneration ||
          workspace !== this.workspace ||
          this.busy
        )
          return;
        if (settings.revision !== workspace.settings.revision) {
          workspace.settings = settings;
          this.emit();
        }
      }
      const tree = await this.client.tree(workspace.id);
      if (
        generation !== this.pollGeneration ||
        workspace !== this.workspace ||
        this.busy
      )
        return;
      if (JSON.stringify(tree) !== JSON.stringify(this.tree)) {
        this.tree = tree;
        this.emit();
      }
      if (active && !active.saving && !active.composing) {
        const file = await this.client.read(workspace.id, active.path);
        if (
          workspace !== this.workspace ||
          generation !== this.pollGeneration ||
          active !== this.active ||
          this.busy ||
          active.saving ||
          active.composing
        )
          return;
        if (file.version !== active.file.version) {
          if (active.state === 'saved') {
            active.document?.dispose?.();
            const replacement = this.make(file);
            replacement.scroll = active.scroll;
            this.documents.set(active.path, replacement);
            this.active = replacement;
          } else this.conflict(active);
          this.emit();
        }
      }
    } catch (error) {
      if (
        generation === this.pollGeneration &&
        this.workspace === workspace &&
        !this.busy
      ) {
        if (
          active === this.active &&
          active &&
          error instanceof WorkspaceError &&
          error.status === 404
        )
          this.conflict(active);
        else this.error = this.message(error);
        this.emit();
      }
    } finally {
      this.polling = false;
    }
  }

  async reload() {
    if (!this.active || !this.workspace || this.busy) return;
    this.busy = true;
    this.emit();
    try {
      const previous = this.active;
      clearTimeout(previous.timer);
      const doc = this.make(
        await this.client.read(this.workspace.id, previous.path)
      );
      previous.document?.dispose?.();
      this.documents.set(doc.path, doc);
      this.active = doc;
      this.error = '';
    } catch (error) {
      this.error = this.message(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async copy(name: string) {
    if (!this.active || !this.workspace || this.busy || this.active.composing)
      return false;
    this.busy = true;
    this.error = '';
    this.emit();
    try {
      const doc = this.active;
      const parent = doc.path.split('/').slice(0, -1).join('/');
      const result = await this.client.create(
        this.workspace.id,
        parent,
        name,
        'file',
        doc.serialize()
      );
      const replacement = this.make(
        await this.client.read(this.workspace.id, result.path)
      );
      clearTimeout(doc.timer);
      doc.document?.dispose?.();
      this.documents.delete(doc.path);
      this.documents.set(result.path, replacement);
      this.active = replacement;
      this.tree = await this.client.tree(this.workspace.id);
      return true;
    } catch (error) {
      this.error = this.message(error);
      return false;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async create(parent: string, name: string, kind: 'file' | 'directory') {
    if (!this.workspace || this.busy) return false;
    this.busy = true;
    this.error = '';
    this.emit();
    let nextPath: string | undefined;
    try {
      if (!(await this.flushAll())) return false;
      const result = await this.client.create(
        this.workspace.id,
        parent,
        name,
        kind
      );
      this.tree = await this.client.tree(this.workspace.id);
      if (kind === 'file') nextPath = result.path;
    } catch (error) {
      this.error = this.message(error);
      return false;
    } finally {
      this.busy = false;
      this.emit();
    }
    if (nextPath) await this.select(nextPath);
    return true;
  }

  lastRelocation?: RelocationResult;
  async saveSettings(input: SettingsInput, revision: string) {
    if (!this.workspace || this.busy) return false;
    this.busy = true;
    this.pollGeneration++;
    this.error = '';
    this.emit();
    try {
      if (!(await this.flushAll()))
        throw new Error('请先完成输入、保存或处理冲突。');
      this.workspace.settings = await this.client.saveSettings(
        this.workspace.id,
        input,
        revision
      );
      this.tree = await this.client.tree(this.workspace.id);
      return true;
    } catch (error) {
      this.error = this.message(error);
      return false;
    } finally {
      this.busy = false;
      this.pollGeneration++;
      this.emit();
    }
  }
  async trash(path: string) {
    if (!this.workspace || this.busy) return;
    this.busy = true;
    this.pollGeneration++;
    this.error = '';
    this.emit();
    try {
      if (!(await this.flushAll()))
        throw new Error('请先完成输入、保存修改或处理外部冲突。');
      const file =
        this.documents.get(path)?.file ??
        (await this.client.read(this.workspace.id, path));
      const entry = await this.client.trash(
        this.workspace.id,
        path,
        file.version
      );
      const doc = this.documents.get(path);
      if (doc) clearTimeout(doc.timer);
      this.documents.get(path)?.document?.dispose?.();
      this.documents.delete(path);
      if (this.active?.path === path) this.active = undefined;
      this.tree = await this.client.tree(this.workspace.id);
      return entry;
    } catch (error) {
      this.error = this.message(error);
    } finally {
      this.busy = false;
      this.pollGeneration++;
      this.emit();
    }
  }
  async restoreTrash(entry: string) {
    if (!this.workspace || this.busy) return false;
    this.busy = true;
    this.pollGeneration++;
    this.error = '';
    this.emit();
    try {
      if (!(await this.flushAll()))
        throw new Error('请先保存修改或处理外部冲突。');
      await this.client.restore(this.workspace.id, entry);
      this.tree = await this.client.tree(this.workspace.id);
      return true;
    } catch (error) {
      this.error = this.message(error);
      return false;
    } finally {
      this.busy = false;
      this.pollGeneration++;
      this.emit();
    }
  }
  private async relocate(path: string, name: string, moving: boolean) {
    if (!this.workspace || this.busy) return false;
    this.busy = true;
    this.pollGeneration++;
    this.error = '';
    this.emit();
    try {
      if (!(await this.flushAll())) {
        this.error = '请先完成输入、保存修改或处理外部冲突。';
        return false;
      }
      const source =
        this.documents.get(path)?.file ??
        (moving ? await this.client.read(this.workspace.id, path) : undefined);
      const result = moving
        ? await this.client.move(this.workspace.id, path, name, source!.version)
        : await this.client.rename(
            this.workspace.id,
            path,
            name,
            source?.version
          );
      const mappings = result.mappings ?? [{ from: path, to: result.path }];
      remapEditingModes(this.workspace!.root, mappings);
      for (const [key, doc] of [...this.documents]) {
        const change = mappings.find(
          (item) => key === item.from || key.startsWith(`${item.from}/`)
        );
        const next = change ? change.to + key.slice(change.from.length) : key;
        const file = result.files?.find((item) => item.path === next);
        let replacement = doc;
        if (file && file.content !== doc.file.content) {
          doc.document?.dispose?.();
          replacement = this.make(file);
          replacement.scroll = doc.scroll;
        } else {
          doc.path = next;
          doc.file = file ?? { ...doc.file, path: next };
        }
        this.documents.delete(key);
        this.documents.set(next, replacement);
        if (this.active === doc) this.active = replacement;
      }
      this.lastRelocation = { ...result, mappings, files: result.files ?? [] };
      this.tree = await this.client.tree(this.workspace.id);
      return true;
    } catch (error) {
      this.error = this.message(error);
      return false;
    } finally {
      this.busy = false;
      this.pollGeneration++;
      this.emit();
    }
  }
  rename(path: string, name: string) {
    return this.relocate(path, name, false);
  }
  move(path: string, parent: string) {
    return this.relocate(path, parent, true);
  }

  dispose() {
    this.setPolling(false);
    for (const doc of this.documents.values()) {
      clearTimeout(doc.timer);
      doc.document?.dispose?.();
    }
  }
}
