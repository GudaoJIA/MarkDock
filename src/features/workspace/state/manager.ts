import type {
  fileClient,
  ManagementSnapshot,
  managementClient,
} from '../shared/client';
import {
  checkCancelled,
  type OpeningState,
  type OpenProgress,
  type ScanOptions,
} from '../shared/open-progress';
import { HistoryBudget } from './history-budget';
import { type DocumentAdapter, WorkspaceController } from './sessions';

export const WORKSPACES_KEY = 'noteai.workspaces.v1';
export type WorkspaceRecord = {
  root: string;
  name: string;
  lastDocument?: string;
  expanded?: string[];
  error?: string;
};
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const basename = (root: string) =>
  root.split('/').filter(Boolean).at(-1) || root;

export class WorkspaceManager<E> {
  readonly history = new HistoryBudget();
  records: WorkspaceRecord[] = [];
  activeRoot?: string;
  busy = false;
  opening?: OpeningState;
  private openSequence = 0;
  private openingAbort?: AbortController;
  error = '';
  storageWarning = '';
  readonly empty: WorkspaceController<E>;
  private readonly sessions = new Map<string, WorkspaceController<E>>();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private storage?: StoragePort;
  management?: ManagementSnapshot;
  private managementGeneration = 0;
  private changingPins = false;
  private readonly preferences = new Map<string, WorkspaceRecord>();
  private readonly managementApi: typeof managementClient;
  private initialized = false;
  private disposed = false;
  private readonly client: typeof fileClient;
  private readonly adapter: DocumentAdapter<E>;

  constructor(
    client: typeof fileClient,
    adapter: DocumentAdapter<E>,
    managementApi: typeof managementClient
  ) {
    this.managementApi = managementApi;
    this.client = client;
    this.adapter = adapter;
    this.empty = new WorkspaceController(client, adapter, this.history);
  }
  get controller() {
    return this.sessions.get(this.activeRoot ?? '') ?? this.empty;
  }
  get current() {
    return (
      this.records.find((record) => record.root === this.activeRoot) ??
      this.preferences.get(this.activeRoot ?? '')
    );
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  private emit() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  clearError(clearWarning = false) {
    this.error = '';
    if (clearWarning) this.storageWarning = '';
    this.emit();
  }

  async initialize(storage?: StoragePort) {
    if (this.initialized) return;
    this.initialized = true;
    this.storage = storage;
    let lastRoot: string | undefined;
    try {
      const raw = storage?.getItem(WORKSPACES_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const preferences = saved.preferences ?? {};
        for (const [root, item] of Object.entries(preferences)) {
          if (!root.startsWith('/') || !item || typeof item !== 'object')
            continue;
          const value = item as { lastDocument?: unknown; expanded?: unknown };
          this.preferences.set(root, {
            root,
            name: basename(root),
            lastDocument:
              typeof value.lastDocument === 'string'
                ? value.lastDocument
                : undefined,
            expanded: Array.isArray(value.expanded)
              ? value.expanded.filter(
                  (part): part is string => typeof part === 'string'
                )
              : undefined,
          });
        }
        if (typeof saved.activeRoot === 'string') lastRoot = saved.activeRoot;
      }
    } catch {
      this.storageWarning =
        '无法读取编辑偏好；服务端固定列表和磁盘文档不受影响。';
    }
    try {
      this.applyManagement(await this.managementApi.read());
    } catch (cause) {
      this.records = [];
      this.error = (cause as Error).message;
    }
    this.emit();
    if (lastRoot && this.records.some((record) => record.root === lastRoot))
      await this.open(lastRoot);
  }

  private persist() {
    try {
      this.storage?.setItem(
        WORKSPACES_KEY,
        JSON.stringify({
          preferences: Object.fromEntries(
            [...this.preferences].map(([root, record]) => [
              root,
              { lastDocument: record.lastDocument, expanded: record.expanded },
            ])
          ),
          activeRoot: this.records.some((item) => item.root === this.activeRoot)
            ? this.activeRoot
            : undefined,
        })
      );
    } catch {
      this.storageWarning = '无法保存编辑偏好；固定列表和磁盘文档不受影响。';
    }
  }
  private applyManagement(state: ManagementSnapshot) {
    for (const record of this.records)
      this.preferences.set(record.root, record);
    this.management = state;
    this.records = state.pins.map((pin) => ({
      ...this.preferences.get(pin.root),
      ...pin,
    }));
    this.persist();
    this.emit();
  }
  refreshManagement = async () => {
    if (this.changingPins) return;
    const generation = ++this.managementGeneration;
    try {
      const state = await this.managementApi.read();
      if (generation !== this.managementGeneration || this.disposed) return;
      this.applyManagement(state);
    } catch (cause) {
      this.error = (cause as Error).message;
      this.emit();
    }
  };
  async pin(root: string, remove = false) {
    if (!this.management || this.changingPins || this.busy) return false;
    const closing = remove && root === this.activeRoot;
    const previous = this.controller;
    if (
      closing &&
      (previous.busy ||
        [...previous.documents.values()].some((doc) => doc.composing))
    ) {
      this.error = '请先完成输入或等待、取消当前上传，再取消固定工作区。';
      this.emit();
      return false;
    }
    this.changingPins = true;
    this.managementGeneration++;
    if (closing) {
      this.busy = true;
      previous.busy = true;
      previous.setPolling(false);
      previous.emit();
      this.emit();
    }
    try {
      if (closing) {
        if (previous.workspace && previous.hasUnsaved()) {
          const renewed = await this.client.open(previous.workspace.root);
          Object.assign(previous.workspace, renewed);
        }
        if (!(await previous.flushAll()) || previous.hasUnsaved()) {
          this.error = '当前工作区尚未保存，请先重试保存或处理外部冲突。';
          return false;
        }
      }
      this.applyManagement(
        await this.managementApi.pins(
          remove ? 'unpin' : 'pin',
          [root],
          this.management.revision
        )
      );
      if (closing) {
        this.activeRoot = undefined;
        this.persist();
      }
      this.error = '';
      this.emit();
      return true;
    } catch (cause) {
      this.changingPins = false;
      await this.refreshManagement();
      this.error = (cause as Error).message;
      this.emit();
      return false;
    } finally {
      this.changingPins = false;
      if (closing) {
        previous.busy = false;
        if (this.controller === previous) previous.setPolling(true);
        previous.emit();
        this.busy = false;
      }
      this.emit();
    }
  }
  setExpanded(root: string, expanded: string[]) {
    const record =
      this.preferences.get(root) ??
      this.records.find((item) => item.root === root);
    if (
      record &&
      JSON.stringify(record.expanded) !== JSON.stringify(expanded)
    ) {
      record.expanded = expanded;
      this.persist();
    }
  }

  async logout(signOut: () => Promise<void>) {
    const controllers = [...this.sessions.values(), this.empty];
    if (
      this.busy ||
      controllers.some(
        (controller) =>
          controller.busy ||
          [...controller.documents.values()].some((doc) => doc.composing)
      )
    ) {
      this.error = '请先完成输入或等待、取消当前上传，再退出登录。';
      this.emit();
      return false;
    }
    this.busy = true;
    this.error = '';
    for (const controller of controllers) {
      controller.busy = true;
      controller.setPolling(false);
      controller.emit();
    }
    this.emit();
    try {
      for (const controller of controllers) {
        if (!(await controller.flushAll()) || controller.hasUnsaved()) {
          this.error = '仍有未保存内容或冲突，未退出登录。请先处理。';
          return false;
        }
      }
      await signOut();
      return true;
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : '退出登录失败，请重试。';
      return false;
    } finally {
      for (const controller of controllers) {
        controller.busy = false;
        controller.emit();
      }
      this.controller.setPolling(true);
      this.busy = false;
      this.emit();
    }
  }

  cancelOpen() {
    if (!this.opening?.cancellable) return;
    this.openingAbort?.abort();
  }

  async open(root: string) {
    if (this.busy || this.changingPins) return false;
    const previous = this.controller;
    if (
      previous.busy ||
      [...previous.documents.values()].some((doc) => doc.composing)
    ) {
      this.error = '请先完成输入或等待、取消当前上传，再切换工作区。';
      this.emit();
      return false;
    }
    this.busy = true;
    previous.setPolling(false);
    previous.busy = true;
    previous.emit();
    this.error = '';
    this.emit();
    const id = ++this.openSequence;
    const abort = new AbortController();
    this.openingAbort = abort;
    const startedAt = Date.now();
    const update = (progress: OpenProgress) => {
      if (id !== this.openSequence || this.disposed || abort.signal.aborted)
        return;
      this.opening = { ...progress, id, root, startedAt };
      this.emit();
    };
    const options: ScanOptions = { signal: abort.signal, onProgress: update };
    update({
      stage: previous.hasUnsaved() ? 'saving' : 'checking',
      cancellable: false,
    });
    let canonicalRoot = root;
    let openingTarget = false;
    try {
      if (previous.workspace && previous.hasUnsaved()) {
        const renewed = await this.client.open(previous.workspace.root, {
          signal: abort.signal,
          onProgress: () => update({ stage: 'saving', cancellable: false }),
        });
        Object.assign(previous.workspace, renewed);
      }
      if (!(await previous.flushAll())) {
        this.error = '当前工作区尚未保存，请先重试保存或处理外部冲突。';
        return false;
      }
      checkCancelled(options);
      openingTarget = true;
      const workspace = await this.client.open(root, options);
      checkCancelled(options);
      if (this.disposed) return false;
      canonicalRoot = workspace.root;
      let target = this.sessions.get(canonicalRoot);
      if (!target)
        target = new WorkspaceController(
          this.client,
          this.adapter,
          this.history
        );
      const preference =
        this.preferences.get(canonicalRoot) ??
        this.records.find(
          (item) => item.root === canonicalRoot || item.root === root
        );
      update({ stage: 'tree', entries: 0, cancellable: true });
      try {
        await target.resume(workspace, options, preference?.lastDocument);
      } catch (error) {
        if (!this.sessions.has(canonicalRoot)) target.dispose();
        throw error;
      }
      if (this.disposed) return false;
      let record = this.records.find(
        (item) => item.root === canonicalRoot || item.root === root
      );
      if (!record) {
        record = { root: canonicalRoot, name: workspace.name };
      }
      this.preferences.set(canonicalRoot, record);
      record.root = canonicalRoot;
      record.name = workspace.name;
      record.error = undefined;
      this.records = this.records.filter(
        (item) => item === record || item.root !== canonicalRoot
      );
      this.sessions.set(canonicalRoot, target);
      if (!this.subscriptions.has(canonicalRoot)) {
        const controller = target;
        this.subscriptions.set(
          canonicalRoot,
          controller.subscribe(() => {
            const item = this.preferences.get(canonicalRoot);
            if (item && item.lastDocument !== controller.active?.path) {
              item.lastDocument = controller.active?.path;
              this.persist();
            }
          })
        );
      }
      record.lastDocument = target.active?.path;
      this.activeRoot = canonicalRoot;
      target.setPolling(true);
      this.persist();
      return true;
    } catch (cause) {
      if (abort.signal.aborted) return false;
      this.error =
        cause instanceof Error
          ? cause.message
          : '工作区打开失败，请检查目录和权限。';
      const record = this.records.find(
        (item) => item.root === canonicalRoot || item.root === root
      );
      if (record && openingTarget) record.error = this.error;
      return false;
    } finally {
      if (this.controller === previous) previous.setPolling(true);
      previous.busy = false;
      previous.emit();
      this.opening = undefined;
      this.openingAbort = undefined;
      this.busy = false;
      this.emit();
    }
  }
  hasUnsaved() {
    return [...this.sessions.values()].some((controller) =>
      controller.hasUnsaved()
    );
  }
  dispose() {
    this.disposed = true;
    this.openingAbort?.abort();
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    for (const controller of this.sessions.values()) controller.dispose();
    this.empty.dispose();
  }
}
