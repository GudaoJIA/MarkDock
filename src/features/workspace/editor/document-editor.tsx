'use client';

import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { KEYS, type TRange } from 'platejs';
import { Plate } from 'platejs/react';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Editor, EditorContainer } from '@/components/ui/editor';
import {
  editorMatches,
  type SearchTarget,
} from '@/features/workspace/editor/editor-search';
import type {
  DocumentSession,
  WorkspaceController,
} from '@/features/workspace/state/sessions';
import { useInterface, useT } from '@/features/workspace/ui/interface-provider';
import {
  countWords,
  documentText,
  guardWritingInput,
  writingModel,
} from '@/features/workspace/writing/writing';
import { touchesRaw } from '../shared/raw';
import { shortcutCommand } from '../shared/shortcuts';
import { WritingContext } from '../writing/writing-context';
import { Outline, WritingStats } from '../writing/writing-panels';
import {
  setOutline,
  useWritingPreferences,
} from '../writing/writing-preferences';
import { AttachmentDialog } from './attachment-dialog';
import {
  changeBlockFormat,
  EditingContext,
  runCommand,
  toggleTextFormat,
} from './commands';
import { DocumentContext } from './document-context';
import type { WorkspaceEditor } from './editor-kit';
import { useImageImport } from './image-import';
import { ImageViewer } from './image-viewer';
import { type InsertAction, InsertDialog } from './insert-dialog';
import { setMarkdownComposing } from './markdown-input';
import { ReplaceBar } from './replace-bar';
import { WorkspaceToolbar } from './toolbar';

const SourceEditor = dynamic(() => import('./source-editor'), { ssr: false });
type DocumentEditorProps = {
  doc: DocumentSession<WorkspaceEditor>;
  controller: WorkspaceController<WorkspaceEditor>;
  search?: SearchTarget;
  onSearch: (target?: SearchTarget) => void;
};

export function DocumentEditor(props: DocumentEditorProps) {
  const t = useT();
  useSyncExternalStore(
    props.controller.history.subscribe,
    props.controller.history.snapshot,
    props.controller.history.snapshot
  );
  useEffect(() => {
    void import('./source-editor');
  }, []);
  return (
    <>
      {props.doc.document?.historyNotice && (
        <p className="px-5 py-1 text-amber-700 text-xs" role="status">
          {t(props.doc.document.historyNotice)}
        </p>
      )}
      <div
        className="ws-mode-view flex min-h-0 flex-1 flex-col"
        data-mode={props.doc.document?.mode ?? 'rich'}
      >
        {props.doc.document?.mode === 'source' ? (
          <SourceEditor {...props} />
        ) : (
          <RichDocumentEditor {...props} />
        )}
      </div>
    </>
  );
}

function RichDocumentEditor({
  doc,
  controller,
  search,
  onSearch: updateSearch,
}: DocumentEditorProps) {
  'use no memo';
  const t = useT();
  const preferencesInterface = useInterface();
  const [tableRequest, setTableRequest] = useState(0);
  const [insert, setInsert] = useState<
    InsertAction | { kind: 'attachment'; selection: TRange | null } | null
  >(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const editor = doc.editor;
  const imageImport = useImageImport(doc, controller);
  const model = writingModel(editor);
  useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot);
  const preferences = useWritingPreferences();
  const outlineOpen = preferences.outline ?? false;
  const [activeHeading, setActiveHeading] = useState<string>();
  const [flash, setFlash] = useState<string>();
  const [image, setImage] = useState<{
    source: string;
    alt: string;
    selection: TRange | null;
    scroll: number;
  } | null>(null);
  const [words, setWords] = useState(() => countWords(documentText(editor)));
  const [selectedWords, setSelectedWords] = useState(0);
  const locked =
    controller.busy ||
    doc.composing ||
    !!insert ||
    !!image ||
    ['error', 'conflict'].includes(doc.state);
  const refresh = () => {
    model.revealSelection();
    model.emit();
    if (!doc.composing) setWords(countWords(documentText(editor)));
  };
  const onSearch = (target?: SearchTarget) => {
    updateSearch(target);
    if (!target)
      requestAnimationFrame(() =>
        editor.tf.focus({ at: doc.selection as TRange | undefined })
      );
  };
  const openReplace = () => {
    if (!locked)
      onSearch({
        path: doc.path,
        query: search?.query ?? '',
        index: search?.index ?? 0,
        nonce: Date.now(),
        replace: true,
      });
  };
  const replaceShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (
      !event.isComposing &&
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === 'h' &&
      !document.querySelector('[role="dialog"]')
    ) {
      event.preventDefault();
      openReplace();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => replaceShortcut(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(undefined), 1100);
    return () => clearTimeout(timer);
  }, [flash]);
  const trackHeading = () => {
    const container = scrollRef.current;
    if (!container) return;
    const top = container.getBoundingClientRect().top + 70;
    const visible = [
      ...container.querySelectorAll<HTMLElement>('[data-section-level]'),
    ].filter((node) => node.getClientRects().length);
    const currentHeading =
      visible
        .filter((node) => node.getBoundingClientRect().top <= top)
        .at(-1) ?? visible[0];
    setActiveHeading(currentHeading?.dataset.writingId);
  };
  const jump = (id: string) => {
    const index = model.index(id);
    if (index < 0) return;
    model.reveal(index);
    setActiveHeading(id);
    setFlash(id);
    requestAnimationFrame(() =>
      scrollRef.current
        ?.querySelector(`[data-writing-id="${id}"]`)
        ?.scrollIntoView({ block: 'start' })
    );
  };
  const closeImage = () => {
    const selection = image?.selection;
    const scroll = image?.scroll ?? doc.scroll;
    setImage(null);
    requestAnimationFrame(() => {
      editor.tf.focus({ at: selection ?? undefined });
      if (scrollRef.current) scrollRef.current.scrollTop = scroll;
    });
  };
  const matches = search
    ? editorMatches(editor, search.query, Number.POSITIVE_INFINITY)
    : [];
  const count = matches.length;
  const current = Math.min(search?.index ?? 0, Math.max(0, count - 1));
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (doc.selection) editor.tf.focus({ at: doc.selection as TRange });
      if (scrollRef.current) scrollRef.current.scrollTop = doc.scroll;
    });
    return () => cancelAnimationFrame(frame);
  }, [doc, editor]);
  useEffect(() => {
    if (!search) return;
    {
      const match = editorMatches(
        editor,
        search.query,
        Number.POSITIVE_INFINITY
      )[current];
      if (match) model.reveal(match.range.anchor.path[0]);
    }
    const frame = requestAnimationFrame(() => {
      {
        const match = editorMatches(
          editor,
          search.query,
          Number.POSITIVE_INFINITY
        )[current];
        if (match) {
          try {
            editor.api
              .toDOMRange(match.range)
              ?.startContainer.parentElement?.scrollIntoView({
                block: 'center',
              });
          } catch {
            /* A concurrent edit can invalidate a rendered range until the next revision. */
          }
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [search, current, doc, editor, model]);
  const open = (kind: 'link' | 'image' | 'attachment', file?: File) => {
    if (doc.composing || controller.busy || touchesRaw(editor)) return;
    if (kind === 'link' && editor.api.some({ match: { type: KEYS.codeBlock } }))
      return;
    setInsert({
      kind,
      file,
      selection: editor.selection ? structuredClone(editor.selection) : null,
    });
  };
  const findBar = search?.replace ? (
    <ReplaceBar
      count={count}
      current={current}
      editor={editor}
      locked={locked}
      onChanged={refresh}
      onSearch={onSearch}
      search={search}
    />
  ) : (
    search && (
      <div
        aria-label={t('文内查找')}
        className="ws-find-bar flex items-center gap-2 border-stone-200 border-b bg-stone-50 px-5 py-2 text-xs"
        role="region"
      >
        <span className="truncate">
          {t('查找：')}
          {search.query}
        </span>
        <span aria-live="polite" className="ml-auto whitespace-nowrap">
          {count
            ? `${current + 1} / ${count}`
            : t('正文中无匹配（可能命中文件名或图片说明）')}
        </span>
        <button
          aria-label={t('上一处匹配')}
          className="ws-icon-button"
          disabled={!count}
          onClick={() =>
            onSearch({
              ...search,
              index: (current - 1 + count) % count,
              nonce: search.nonce + 1,
            })
          }
          type="button"
        >
          <ChevronUpIcon />
        </button>
        <button
          aria-label={t('下一处匹配')}
          className="ws-icon-button"
          disabled={!count}
          onClick={() =>
            onSearch({
              ...search,
              index: (current + 1) % count,
              nonce: search.nonce + 1,
            })
          }
          type="button"
        >
          <ChevronDownIcon />
        </button>
        <button
          aria-label={t('关闭文内查找')}
          className="ws-icon-button"
          onClick={() => onSearch(undefined)}
          type="button"
        >
          <XIcon />
        </button>
      </div>
    )
  );
  return (
    <DocumentContext.Provider
      value={{
        workspaceId: controller.workspace!.id,
        path: doc.path,
        settings: controller.workspace!.settings?.settings,
      }}
    >
      <WritingContext.Provider
        value={{
          model,
          locked,
          flash,
          preview: (source, alt) => {
            if (!controller.busy)
              setImage({
                source,
                alt,
                scroll: scrollRef.current?.scrollTop ?? doc.scroll,
                selection: editor.selection
                  ? structuredClone(editor.selection)
                  : null,
              });
          },
        }}
      >
        <EditingContext.Provider
          value={{
            image: () => open('image'),
            attachment: () => open('attachment'),
            link: () => open('link'),
            composing: doc.composing,
          }}
        >
          <Plate
            decorate={({ entry: [, path] }) =>
              matches.flatMap((match, index) => {
                if (index >= 1000 && index !== current) return [];
                const prefix = match.range.anchor.path.slice(0, path.length);
                return prefix.every((part, i) => part === path[i])
                  ? [
                      {
                        ...match.range,
                        workspaceSearch: true,
                        searchActive: index === current,
                      },
                    ]
                  : [];
              })
            }
            editor={editor}
            onSelectionChange={({ selection }) => {
              controller.rememberSelection(doc, selection);
              model.revealSelection(selection);
              if (!doc.composing)
                setSelectedWords(
                  selection ? countWords(documentText(editor, selection)) : 0
                );
            }}
            onValueChange={() => {
              controller.changed(doc);
              refresh();
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col">
              <div
                className="ws-toolbar-shell flex h-12 shrink-0 items-center justify-start border-stone-200 border-b px-2"
                inert={controller.busy || !!insert}
              >
                <WorkspaceToolbar
                  document={doc.document}
                  onOutline={() => setOutline(!outlineOpen)}
                  onReplace={openReplace}
                  onToggleMode={() => controller.switchMode(doc)}
                  outlineOpen={outlineOpen}
                  tableRequest={tableRequest}
                />
              </div>
              {findBar}
              {imageImport.status && (
                <p className="px-5 py-1 text-stone-600 text-xs" role="status">
                  {t(imageImport.status)}
                </p>
              )}
              <div className="ws-writing-layout relative flex min-h-0 flex-1">
                <EditorContainer
                  className="ws-mode-surface min-h-0 min-w-0 flex-1"
                  data-writing-surface
                  onScroll={(event) => {
                    controller.rememberScroll(
                      doc,
                      event.currentTarget.scrollTop
                    );
                    trackHeading();
                  }}
                  ref={scrollRef}
                >
                  <Editor
                    aria-label={t('编辑 {0}', [
                      doc.path.split('/').at(-1) ?? doc.path,
                    ])}
                    className="ws-prose min-h-full px-8 pt-10 pb-48 text-base leading-8 sm:px-[max(40px,calc(50%-350px))]"
                    onCompositionEnd={() => {
                      setMarkdownComposing(editor, false);
                      queueMicrotask(() => {
                        controller.composition(doc, false);
                        setWords(countWords(documentText(editor)));
                      });
                    }}
                    onCompositionStart={() => {
                      setMarkdownComposing(editor, true);
                      controller.composition(doc, true);
                    }}
                    onCut={(event) => {
                      if (model.guardDelete(true)) {
                        event.preventDefault();
                        return true;
                      }
                    }}
                    onDOMBeforeInput={(event) =>
                      guardWritingInput(model, event)
                    }
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes('Files'))
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                      const at = editor.api.findEventRange(event);
                      if (imageImport.receive(event.dataTransfer, at)) {
                        event.preventDefault();
                        return true;
                      }
                    }}
                    onKeyDown={(event) => {
                      if (locked) return;
                      if (
                        (event.target as HTMLElement).closest(
                          '[contenteditable="false"]'
                        )
                      )
                        return;
                      if (event.defaultPrevented) return true;
                      if (event.nativeEvent.isComposing) return;
                      const command = shortcutCommand(
                        event.nativeEvent,
                        preferencesInterface.shortcuts[
                          preferencesInterface.platform
                        ]
                      );
                      if (command) {
                        event.preventDefault();
                        if (touchesRaw(editor)) return true;
                        if (
                          ['bold', 'italic', 'strikethrough', 'code'].includes(
                            command
                          )
                        )
                          toggleTextFormat(editor, command);
                        else if (command === 'link') {
                          if (
                            !editor.api.some({
                              match: { type: KEYS.codeBlock },
                            })
                          )
                            open('link');
                        } else if (
                          editor.api.some({
                            match: { type: [KEYS.table, KEYS.codeBlock] },
                          })
                        )
                          return true;
                        else if (command === 'table')
                          setTableRequest((n) => n + 1);
                        else if (
                          [
                            'p',
                            'h1',
                            'h2',
                            'h3',
                            'h4',
                            'h5',
                            'h6',
                            'ul',
                            'ol',
                            'todo',
                            'blockquote',
                          ].includes(command)
                        )
                          changeBlockFormat(editor, command);
                        else
                          runCommand(
                            editor,
                            command,
                            () => open('image'),
                            () => open('attachment')
                          );
                        return true;
                      }

                      if (
                        (event.metaKey || event.ctrlKey) &&
                        ['z', 'y'].includes(event.key.toLowerCase())
                      ) {
                        event.preventDefault();
                        if (event.shiftKey || event.key.toLowerCase() === 'y')
                          doc.document?.redo();
                        else doc.document?.undo();
                        return true;
                      }
                      if (
                        touchesRaw(editor) &&
                        (event.metaKey || event.ctrlKey) &&
                        (event.altKey || (event.shiftKey && event.key === '>'))
                      ) {
                        event.preventDefault();
                        return true;
                      }
                      if (
                        touchesRaw(editor) &&
                        !(event.metaKey || event.ctrlKey) &&
                        (event.key === 'Enter' || event.key === 'Tab')
                      ) {
                        event.preventDefault();
                        editor.tf.insertText(
                          event.key === 'Enter' ? '\n' : '\t'
                        );
                        return true;
                      }
                      if (
                        ['Backspace', 'Delete'].includes(event.key) &&
                        model.guardDelete(event.key === 'Backspace')
                      ) {
                        event.preventDefault();
                        return;
                      }
                      const table = editor.api.node({
                        match: { type: KEYS.table },
                      });
                      if (table && event.key === 'Enter') {
                        event.preventDefault();
                        const cell = editor.api.node({
                          match: { type: [KEYS.td, KEYS.th] },
                        });
                        const cells = [
                          ...editor.api.nodes({
                            at: table[1],
                            match: { type: [KEYS.td, KEYS.th] },
                          }),
                        ];
                        const index = cells.findIndex(
                          (entry) => entry[1].join('.') === cell?.[1].join('.')
                        );
                        const next =
                          cells[
                            Math.max(
                              0,
                              Math.min(
                                cells.length - 1,
                                index + (event.shiftKey ? -1 : 1)
                              )
                            )
                          ];
                        if (next) editor.tf.select(editor.api.start(next[1])!);
                        return true;
                      }
                      if (
                        table &&
                        (event.metaKey || event.ctrlKey) &&
                        (event.altKey || (event.shiftKey && event.key === '>'))
                      ) {
                        event.preventDefault();
                        return true;
                      }
                      if (
                        (event.metaKey || event.ctrlKey) &&
                        event.key.toLowerCase() === 's'
                      ) {
                        event.preventDefault();
                        void controller.flush(doc);
                      }
                      if (event.key === 'Escape' && search) onSearch(undefined);
                    }}
                    onPaste={(event) => {
                      if (imageImport.receive(event.clipboardData)) {
                        event.preventDefault();
                        return true;
                      }
                      if (touchesRaw(editor)) {
                        event.preventDefault();
                        editor.tf.withNewBatch(() =>
                          editor.tf.insertText(
                            event.clipboardData.getData('text/plain')
                          )
                        );
                        return true;
                      }
                    }}
                    placeholder={t('在这里开始写作，输入 / 插入内容…')}
                    readOnly={controller.busy || !!insert || !!image}
                    renderLeaf={(props) => (
                      <span {...props.attributes}>
                        {props.leaf.workspaceSearch ? (
                          <mark
                            className={
                              props.leaf.searchActive
                                ? 'ws-search-active'
                                : 'ws-search-mark'
                            }
                          >
                            {props.children}
                          </mark>
                        ) : (
                          props.children
                        )}
                      </span>
                    )}
                    variant="none"
                  />
                  {!insert && !controller.busy && <WorkspaceToolbar floating />}
                </EditorContainer>
                <Outline
                  active={activeHeading ?? model.headings()[0]?.id}
                  model={model}
                  onClose={() => {
                    setOutline(false);
                    editor.tf.focus();
                  }}
                  onJump={jump}
                  open={outlineOpen}
                />
              </div>
              <WritingStats
                goal={
                  preferences.goals?.[controller.workspace!.root]?.[doc.path]
                }
                path={doc.path}
                root={controller.workspace!.root}
                selected={selectedWords}
                words={words}
              />
              {image && (
                <ImageViewer
                  alt={image.alt}
                  onClose={closeImage}
                  source={image.source}
                />
              )}
              {insert?.kind === 'attachment' ? (
                <AttachmentDialog
                  controller={controller}
                  doc={doc}
                  onClose={() => setInsert(null)}
                  selection={insert.selection}
                />
              ) : (
                insert && (
                  <InsertDialog
                    action={insert}
                    controller={controller}
                    doc={doc}
                    onClose={() => setInsert(null)}
                  />
                )
              )}
            </div>
          </Plate>
        </EditingContext.Provider>
      </WritingContext.Provider>
    </DocumentContext.Provider>
  );
}
