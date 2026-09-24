'use client';
import { SessionControls } from '@/features/auth/ui/session-controls';
import { useT } from '@/features/workspace/ui/interface-provider';

import { InterfaceProvider, useInterface } from '../ui/interface-provider';
import { ProjectSettings } from './project-settings';
import { SystemSettings } from './system-settings';

const MD_EXTENSION = /\.md$/i;

import {
  BookOpenIcon,
  FilePlus2Icon,
  FileTextIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  Settings2Icon,
  Trash2Icon,
} from 'lucide-react';
import {
  type CSSProperties,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { Button } from '@/components/ui/button';
import type { SearchTarget } from '@/features/workspace/editor/editor-search';
import {
  fileClient,
  managementClient,
} from '@/features/workspace/shared/client';
import { WorkspaceManager } from '@/features/workspace/state/manager';
import type { WorkspaceController } from '@/features/workspace/state/sessions';
import { DocumentEditor } from '../editor/document-editor';
import type { WorkspaceEditor } from '../editor/editor-kit';
import { createDocumentEditor } from '../editor/editor-kit';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { remapWritingGoals } from '../writing/writing-preferences';
import { FileTree } from './file-tree';
import { MoveDialog } from './move-dialog';
import { SearchDialog } from './search-dialog';
import { TrashPanel } from './trash-panel';
import { WorkspaceManagement } from './workspace-management';

const DEFAULT_PREFERENCES = JSON.stringify({ width: 260 });
const serverPreferences = () => DEFAULT_PREFERENCES;
const readPreferences = () => {
  try {
    const width = Number(localStorage.getItem('noteai.sidebarWidth'));
    return JSON.stringify({
      width: width >= 200 && width <= 420 ? width : 260,
    });
  } catch {
    return DEFAULT_PREFERENCES;
  }
};
const subscribePreferences = (listener: () => void) => {
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
};

const labels = {
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中…',
  error: '保存失败',
  conflict: '外部冲突',
};
type Action = {
  kind: 'open' | 'file' | 'directory' | 'rename' | 'copy' | 'reload';
  path?: string;
  name?: string;
};
export function WorkspaceApp() {
  return (
    <InterfaceProvider>
      <WorkspaceSession />
    </InterfaceProvider>
  );
}

function WorkspaceSession() {
  'use no memo';
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const preferences = useInterface();
  const [manager] = useState(
    () =>
      new WorkspaceManager(
        fileClient,
        { create: createDocumentEditor },
        managementClient
      )
  );
  useSyncExternalStore(manager.subscribe, manager.snapshot, manager.snapshot);
  useEffect(() => {
    manager.history.configure(preferences.history);
  }, [manager, preferences.history]);
  const cleanup = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(cleanup.current);
    let storage: Storage | undefined;
    try {
      storage = localStorage;
    } catch {
      /* Memory-only mode remains usable. */
    }
    void manager.initialize(storage);
    return () => {
      cleanup.current = setTimeout(() => manager.dispose(), 0);
    };
  }, [manager]);
  return (
    <WorkspaceView
      controller={manager.controller}
      key={manager.activeRoot ?? 'empty'}
      manager={manager}
      projectSettingsOpen={projectSettingsOpen}
      setProjectSettingsOpen={setProjectSettingsOpen}
    />
  );
}

function WorkspaceView({
  manager,
  controller,
  projectSettingsOpen,
  setProjectSettingsOpen,
}: {
  manager: WorkspaceManager<WorkspaceEditor>;
  projectSettingsOpen: boolean;
  setProjectSettingsOpen: (open: boolean) => void;
  controller: WorkspaceController<WorkspaceEditor>;
}) {
  'use no memo';
  const t = useT();
  useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot
  );
  const { locale, platform, showResourceDirectories } = useInterface();
  const preferences = JSON.parse(
    useSyncExternalStore(
      subscribePreferences,
      readPreferences,
      serverPreferences
    )
  );
  const [managementOpen, setManagementOpen] = useState(false);
  const openingId = manager.opening?.id;
  useEffect(() => {
    if (openingId === undefined) return;
    if (managementOpen) return;
    const timer = setTimeout(() => {
      setManagementOpen(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [openingId, managementOpen, manager.error]);
  const [dragStatus, setDragStatus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(
    new Set(
      manager.current?.expanded ??
        controller.tree
          .filter((entry) => entry.kind === 'directory')
          .map((entry) => entry.path)
    )
  );
  useEffect(() => {
    if (manager.activeRoot)
      manager.setExpanded(manager.activeRoot, [...expanded]);
  }, [expanded, manager]);
  const [selected, setSelected] = useState('');
  const [selectedKind, setSelectedKind] = useState<'file' | 'directory'>(
    'directory'
  );
  const query = '';
  const [widthInput, setWidth] = useState<number | null>(null);
  const width = widthInput ?? preferences.width;
  const [collapsed, setCollapsed] = useState(false);
  const expandSidebar = useRef<HTMLButtonElement>(null);
  const collapseSidebar = useRef<HTMLButtonElement>(null);
  const [moveSource, setMoveSource] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [systemSettingsOpen, setSystemSettingsOpen] = useState(false);
  const [trashed, setTrashed] = useState<{
    id: string;
    workspace: string;
  } | null>(null);
  const [searchTarget, setSearchTarget] = useState<SearchTarget>();
  const workspace = controller.workspace;
  const doc = controller.active;
  const parent =
    selectedKind === 'directory'
      ? selected
      : selected.split('/').slice(0, -1).join('/');

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (manager.hasUnsaved()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'f' &&
        !event.defaultPrevented &&
        !event.isComposing
      ) {
        event.preventDefault();
        if (controller.workspace && !controller.busy) setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    const timer = setInterval(() => {
      void controller.poll();
    }, 2500);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', shortcut);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [controller, manager]);

  const afterSwitch = (success: boolean) => {
    if (success) {
      setSearchTarget(undefined);
      setSearchOpen(false);
      setAction(null);
    }
    return success;
  };
  const open = async (directory: string) => {
    setManagementOpen(true);
    return afterSwitch(await manager.open(directory));
  };

  const showAction = (next: Action) => {
    controller.clearError();
    setName(next.name ?? '');
    setAction(next);
  };
  const afterRelocation = () => {
    if (controller.workspace && controller.lastRelocation)
      remapWritingGoals(
        controller.workspace.root,
        controller.lastRelocation.mappings
      );
    const mappings = controller.lastRelocation?.mappings ?? [];
    const mapped = (value: string) => {
      const item = mappings.find(
        (item) => value === item.from || value.startsWith(`${item.from}/`)
      );
      return item ? item.to + value.slice(item.from.length) : value;
    };
    setExpanded((old) => {
      const next = new Set([...old].map(mapped));
      for (const item of mappings) {
        const parts = item.to.split('/');
        for (let i = 1; i < parts.length; i++)
          next.add(parts.slice(0, i).join('/'));
      }
      return next;
    });
    setSelected(mapped(selected));
    setSearchOpen(false);
    setSearchTarget(undefined);
  };
  const move = async (source: string, parent: string) => {
    setSearchOpen(false);
    setSearchTarget(undefined);
    const success = await controller.move(source, parent);
    if (success) afterRelocation();
    return success;
  };
  const submit = async () => {
    if (!action) return;
    const filename = MD_EXTENSION.test(name) ? name : `${name}.md`;
    let success = false;
    if (action.kind === 'open') success = await open(name);
    else if (action.kind === 'reload') {
      await controller.reload();
      success = controller.active?.state === 'saved';
    } else if (action.kind === 'copy')
      success = await controller.copy(filename);
    else if (action.kind === 'rename')
      success = await controller.rename(action.path!, name);
    else
      success = await controller.create(
        action.path ?? '',
        action.kind === 'file' ? filename : name,
        action.kind
      );
    if (success) {
      if (action.kind === 'rename') afterRelocation();
      setAction(null);
      setSelected('');
      setSelectedKind('directory');
      if (action.path) setExpanded((old) => new Set([...old, action.path!]));
    }
  };

  return (
    <div
      className="ws-app flex h-dvh min-h-0 overflow-hidden bg-background text-stone-800"
      lang={locale}
    >
      <div
        aria-hidden={collapsed || undefined}
        className="ws-sidebar-motion flex shrink-0"
        data-open={!collapsed}
        inert={collapsed}
        style={{ '--ws-sidebar-width': `${width}px` } as CSSProperties}
      >
        <aside
          aria-label={t('文件管理')}
          className="flex shrink-0 flex-col border-stone-200/70 border-r bg-[#f8f8f7]"
          style={{ width }}
        >
          <div className="flex h-16 shrink-0 items-center gap-2 px-5">
            <BookOpenIcon size={19} />
            <span className="font-semibold text-sm tracking-wide">
              MarkDock
            </span>
            <button
              aria-label={t('收起侧栏')}
              className="ml-auto rounded p-1.5 text-stone-400 hover:bg-stone-200/50"
              onClick={() => {
                setCollapsed(true);
                requestAnimationFrame(() => expandSidebar.current?.focus());
              }}
              ref={collapseSidebar}
              type="button"
            >
              <PanelLeftCloseIcon size={17} />
            </button>
          </div>
          <div className="px-3">
            <WorkspaceManagement
              busy={controller.busy || manager.busy}
              current={manager.current}
              error={t(manager.error)}
              locations={manager.management?.locations ?? []}
              onCancelOpen={() => manager.cancelOpen()}
              onOpenChange={(value) => {
                setManagementOpen(value);
                if (!value) manager.clearError();
              }}
              onPin={(root, remove) => manager.pin(root, remove)}
              onRefresh={manager.refreshManagement}
              onSettings={() => setProjectSettingsOpen(true)}
              onSwitch={open}
              open={managementOpen || !!manager.error}
              progress={manager.opening}
              records={manager.records}
            />
          </div>
          <button
            aria-label={t('查找文档')}
            className="mx-3 mt-4 flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-500 hover:bg-stone-100"
            disabled={!workspace || controller.busy}
            onClick={() => setSearchOpen(true)}
            type="button"
          >
            <SearchIcon />
            <span>{t('查找文档')}</span>
            <kbd className="ml-auto text-stone-400 text-xs">
              {platform === 'mac' ? '⌘F' : 'Ctrl+F'}
            </kbd>
          </button>
          <div className="mt-6 mb-2 flex items-center px-5">
            <span className="font-medium text-[11px] text-stone-400 tracking-widest">
              {t('文档')}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                aria-label={t('新建文档')}
                className="text-stone-400 hover:text-stone-800 disabled:opacity-30"
                disabled={!workspace || controller.busy}
                onClick={() => showAction({ kind: 'file', path: parent })}
                title={t('在选中文件夹中新建文档')}
                type="button"
              >
                <FilePlus2Icon size={15} />
              </button>
              <button
                aria-label={t('新建文件夹')}
                className="text-stone-400 hover:text-stone-800 disabled:opacity-30"
                disabled={!workspace || controller.busy}
                onClick={() => showAction({ kind: 'directory', path: parent })}
                title={t('在选中文件夹中新建文件夹')}
                type="button"
              >
                <FolderPlusIcon size={15} />
              </button>
            </div>
          </div>
          <nav className="min-h-0 flex-1 overflow-auto px-2 pb-6">
            <FileTree
              active={doc?.path}
              busy={controller.busy}
              entries={controller.tree}
              expanded={expanded}
              key={`${controller.workspace?.id ?? ''}:${controller.workspace?.settings?.revision}:${doc?.path ?? ''}`}
              onDragStatusChange={setDragStatus}
              onExpand={(path) =>
                setExpanded((old) => {
                  const next = new Set(old);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                })
              }
              onMove={(source, parent) => {
                void move(source, parent);
              }}
              onMoveDialog={(entry) => {
                controller.clearError();
                setMoveSource(entry.path);
              }}
              onRename={(entry) =>
                showAction({
                  kind: 'rename',
                  path: entry.path,
                  name: entry.name,
                })
              }
              onSelect={(entry) => {
                setSelected(entry.path);
                setSelectedKind(entry.kind);
                if (entry.kind === 'file') void controller.select(entry.path);
              }}
              onTrash={(entry) => {
                const workspace = controller.workspace!.id;
                void controller.trash(entry.path).then((result) => {
                  if (result) {
                    setTrashed({ id: result.id, workspace });
                    setSelected('');
                  }
                });
              }}
              query={query}
              selected={selected}
              showResourceDirectories={showResourceDirectories}
              workspaceId={controller.workspace?.id ?? ''}
            />
          </nav>
          <div className="border-stone-200/60 border-t px-5 py-4 text-[11px] text-stone-400 leading-5">
            <button
              className="ws-button ws-sidebar-action mb-2 w-full"
              onClick={() => setSystemSettingsOpen(true)}
              type="button"
            >
              <Settings2Icon aria-hidden="true" className="size-4 shrink-0" />
              {t('设置')}
            </button>
            <button
              className="ws-button ws-sidebar-action mb-2 w-full"
              disabled={!controller.workspace || controller.busy}
              onClick={() => {
                setTrashed(null);
                setTrashOpen(true);
              }}
              type="button"
            >
              <Trash2Icon aria-hidden="true" className="size-4 shrink-0" />
              {t('垃圾箱')}
            </button>
            <SessionControls manager={manager} />
            {trashed && trashed.workspace === controller.workspace?.id && (
              <div role="status">
                {t('已移到垃圾箱')}{' '}
                <button
                  disabled={controller.busy}
                  onClick={() =>
                    void controller.restoreTrash(trashed.id).then((ok) => {
                      if (ok) setTrashed(null);
                    })
                  }
                  type="button"
                >
                  {t('恢复')}
                </button>
              </div>
            )}
            {trashOpen && controller.workspace && (
              <TrashPanel
                controller={controller}
                key={controller.workspace.id}
                onClose={() => setTrashOpen(false)}
              />
            )}
            <div
              aria-live="polite"
              className="h-5 truncate"
              data-drag-status
              role="status"
              title={!controller.busy && dragStatus ? dragStatus : undefined}
            >
              {!controller.busy && dragStatus ? (
                dragStatus
              ) : (
                <>
                  <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500" />
                  {t('本地文件 · 自动保存')}
                </>
              )}
            </div>
          </div>
        </aside>
        <div
          aria-label={t('调整侧栏宽度')}
          aria-orientation="vertical"
          aria-valuemax={420}
          aria-valuemin={200}
          aria-valuenow={width}
          className="z-10 -ml-1 w-1 shrink-0 cursor-col-resize hover:bg-stone-300 focus:bg-stone-300"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              const next = Math.max(
                200,
                Math.min(420, width + (event.key === 'ArrowRight' ? 10 : -10))
              );
              setWidth(next);
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              setWidth(Math.max(200, Math.min(420, event.clientX)));
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            try {
              localStorage.setItem('noteai.sidebarWidth', String(width));
            } catch {
              /* Preferences are optional. */
            }
          }}
          role="separator"
          tabIndex={0}
        />
      </div>
      {systemSettingsOpen && (
        <SystemSettings
          document={doc?.document}
          history={manager.history}
          onClose={() => setSystemSettingsOpen(false)}
        />
      )}
      {projectSettingsOpen && workspace && (
        <ProjectSettings
          controller={controller}
          key={workspace.id}
          onClose={() => {
            setProjectSettingsOpen(false);
            setSelected('');
            setSelectedKind('directory');
          }}
        />
      )}
      {searchOpen && workspace && (
        <SearchDialog
          controller={controller}
          onChoose={setSearchTarget}
          onClose={() => setSearchOpen(false)}
        />
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-stone-100 border-b px-7">
          {collapsed && (
            <button
              aria-label={t('展开侧栏')}
              className="mr-2 text-stone-400"
              onClick={() => {
                setCollapsed(false);
                requestAnimationFrame(() => collapseSidebar.current?.focus());
              }}
              ref={expandSidebar}
              type="button"
            >
              <PanelLeftOpenIcon size={18} />
            </button>
          )}
          <FileTextIcon className="shrink-0 text-stone-400" size={16} />
          <div className="min-w-0">
            <div className="truncate font-medium text-sm">
              {doc
                ? doc.path.split('/').at(-1)?.replace(MD_EXTENSION, '')
                : t('工作区')}
            </div>
            <div
              className="truncate text-[11px] text-stone-400"
              title={doc?.path}
            >
              {doc?.path ?? t('你的文件，安静地留在本地')}
            </div>
          </div>
          <div
            aria-live="polite"
            className={`ml-auto shrink-0 text-xs ${doc?.state === 'error' || doc?.state === 'conflict' ? 'text-amber-700' : 'text-stone-400'}`}
          >
            {controller.busy
              ? t('正在处理…')
              : doc?.readOnlyReason
                ? t('只读')
                : doc
                  ? t(labels[doc.state])
                  : ''}
          </div>
        </header>
        {(manager.error || manager.storageWarning || controller.error) && (
          <div
            className="flex items-center gap-3 border-b bg-amber-50 px-7 py-3 text-amber-800 text-sm"
            role="alert"
          >
            <span className="flex-1">
              {t(manager.error || manager.storageWarning || controller.error)}
            </span>
            <button
              onClick={() => {
                controller.clearError();
                manager.clearError(true);
              }}
              type="button"
            >
              {t('关闭')}
            </button>
          </div>
        )}
        {doc && ['conflict', 'error'].includes(doc.state) && (
          <div
            className="flex flex-wrap items-center gap-3 border-b bg-amber-50 px-7 py-3 text-amber-900 text-sm"
            role="alert"
          >
            <span className="flex-1">
              {t(doc.error || '自动保存已暂停，本地编辑仍保留在页面中。')}
            </span>
            {doc.state === 'error' && (
              <Button
                disabled={controller.busy}
                onClick={() => void controller.flush(doc)}
                size="sm"
                variant="outline"
              >
                {t('重试保存')}
              </Button>
            )}
            <Button
              disabled={controller.busy}
              onClick={() =>
                showAction({
                  kind: 'copy',
                  path: doc.path.split('/').slice(0, -1).join('/'),
                  name: doc.path
                    .split('/')
                    .at(-1)!
                    .replace(MD_EXTENSION, t('-本地副本.md')),
                })
              }
              size="sm"
              variant="outline"
            >
              {t('另存本地副本')}
            </Button>
            <Button
              disabled={controller.busy}
              onClick={() => showAction({ kind: 'reload' })}
              size="sm"
              variant="outline"
            >
              {t('重新载入磁盘文件')}
            </Button>
          </div>
        )}
        {doc ? (
          <DocumentEditor
            controller={controller}
            doc={doc}
            key={doc.key}
            onSearch={setSearchTarget}
            search={searchTarget?.path === doc.path ? searchTarget : undefined}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="w-full max-w-lg">
              <FolderOpenIcon
                className="mb-5 text-stone-300"
                size={34}
                strokeWidth={1.2}
              />
              <h1 className="font-semibold text-xl">
                {workspace
                  ? t('选择一篇文档，开始写作')
                  : t('打开你的文档文件夹')}
              </h1>
              <p className="mt-3 text-sm text-stone-500 leading-7">
                {workspace
                  ? t('从左侧选择 Markdown 文件，或新建第一篇文档。')
                  : t(
                      '文件夹将按原有层级显示。编辑会自动保存回原来的 Markdown 文件。'
                    )}
              </p>
              {!workspace && (
                <Button
                  className="mt-6"
                  onClick={() => setManagementOpen(true)}
                  type="button"
                >
                  <FolderOpenIcon size={15} />
                  {t('管理工作区')}
                </Button>
              )}
            </div>
          </div>
        )}
      </main>
      {moveSource && (
        <MoveDialog
          busy={controller.busy}
          entries={controller.tree}
          error={t(controller.error)}
          onClose={() => setMoveSource(null)}
          onMove={(parent) => move(moveSource, parent)}
          source={moveSource}
        />
      )}
      <Dialog
        onOpenChange={(value) => {
          if (!value && !controller.busy) setAction(null);
        }}
        open={!!action}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action?.kind === 'open'
                ? t('打开本地文件夹')
                : action?.kind === 'rename'
                  ? t('重命名')
                  : action?.kind === 'copy'
                    ? t('另存本地副本')
                    : action?.kind === 'reload'
                      ? t('重新载入磁盘文件')
                      : action?.kind === 'directory'
                        ? t('新建文件夹')
                        : t('新建文档')}
            </DialogTitle>
            <DialogDescription>
              {action?.kind === 'reload'
                ? t(
                    '这会放弃当前文档尚未保存的修改，并读取磁盘上的版本。可先另存副本保留本地编辑。'
                  )
                : action?.kind === 'open'
                  ? t('填写真实目录的绝对路径。文件将原地打开和保存。')
                  : t('位置：{0}', [
                      action?.path
                        ?.split('/')
                        .slice(0, action.kind === 'rename' ? -1 : undefined)
                        .join('/') ||
                        workspace?.name ||
                        t('工作区'),
                    ])}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {action?.kind !== 'reload' && (
              <label className="block space-y-2 text-sm">
                <span>
                  {action?.kind === 'open' ? t('目录路径') : t('名称')}
                </span>
                <input
                  autoFocus
                  className="ws-input w-full"
                  disabled={controller.busy}
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </label>
            )}
            {(manager.error || controller.error) && (
              <p className="mt-3 text-red-700 text-sm" role="alert">
                {t(manager.error || controller.error)}
              </p>
            )}
            <DialogFooter className="mt-5">
              <Button
                disabled={controller.busy}
                onClick={() => setAction(null)}
                type="button"
                variant="outline"
              >
                {t('取消')}
              </Button>
              <Button
                disabled={
                  controller.busy || (action?.kind !== 'reload' && !name.trim())
                }
                type="submit"
              >
                {controller.busy
                  ? t('处理中…')
                  : action?.kind === 'reload'
                    ? t('放弃修改并重新载入')
                    : t('确定')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
