'use client';

import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  SearchQuery,
  search as searchExtension,
  searchKeymap,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { Redo2Icon, TextSearchIcon, Undo2Icon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Toolbar, ToolbarButton } from '@/components/ui/toolbar';
import { useInterface, useT } from '@/features/workspace/ui/interface-provider';
import { textMatches } from '../shared/search';
import { visitSource } from '../state/editable-document';
import type { DocumentSession, WorkspaceController } from '../state/sessions';
import { countWords } from '../writing/writing';
import { WritingStats } from '../writing/writing-panels';
import { useWritingPreferences } from '../writing/writing-preferences';
import type { WorkspaceEditor } from './editor-kit';
import type { SearchTarget } from './editor-search';
import { ModeButton } from './mode-button';
import { applySourceChanges, sourceOffset, sourceText } from './source-text';

const sourcePhrases = {
  'Go to line': '跳转到行',
  go: '跳转',
  'on line': '所在行',
  'replaced match on line $': '已替换第 $ 行匹配',
  Find: '查找',
  Replace: '替换',
  next: '下一处',
  previous: '上一处',
  all: '全部',
  'match case': '区分大小写',
  regexp: '正则表达式',
  'by word': '全词匹配',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  'current match': '当前匹配',
  'replaced $ matches': '已替换 $ 处',
};
const darkHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map((rule) => ({
    ...rule,
    ...(rule.color
      ? {
          color:
            (
              {
                '#708': '#c4a7ff',
                '#219': '#b5afff',
                '#164': '#8bd5b4',
                '#a11': '#a8d6a0',
                '#e40': '#efbf83',
                '#00f': '#82b1ff',
                '#30a': '#b5afff',
                '#085': '#8bd5b4',
                '#a50': '#efbf83',
                '#940': '#efbf83',
                '#f00': '#fca5a5',
              } as Record<string, string>
            )[rule.color] ?? 'var(--ws-secondary)',
        }
      : {}),
  }))
);

const external = Annotation.define<boolean>();
export default function SourceEditor({
  doc,
  controller,
  search,
}: {
  doc: DocumentSession<WorkspaceEditor>;
  controller: WorkspaceController<WorkspaceEditor>;
  search?: SearchTarget;
}) {
  'use no memo';
  const t = useT();
  const writing = useWritingPreferences();
  const { locale, resolvedAppearance, platform } = useInterface();
  const presentation = useRef(new Compartment());
  const presentationLocale = useRef(locale);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const model = doc.document!;
  const content = doc.serialize();
  useEffect(() => {
    if (!host.current) return;
    const length = sourceText(model.text()).length;
    const state = EditorState.create({
      doc: sourceText(model.text()),
      selection: model.sourceSelection
        ? {
            anchor: Math.min(model.sourceSelection.anchor, length),
            head: Math.min(model.sourceSelection.head, length),
          }
        : undefined,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        markdown({ addKeymap: false }),
        searchExtension({ top: true }),
        presentation.current.of([]),
        editable.current.of(EditorState.readOnly.of(controller.busy)),
        keymap.of([
          {
            key: 'Mod-z',
            run: () => {
              if (!doc.composing) model.undo();
              return true;
            },
          },
          {
            key: 'Mod-Shift-z',
            run: () => {
              if (!doc.composing) model.redo();
              return true;
            },
          },
          {
            key: 'Mod-y',
            run: () => {
              if (!doc.composing) model.redo();
              return true;
            },
          },
          {
            key: 'Mod-s',
            run: () => {
              void controller.flush(doc);
              return true;
            },
          },
          { key: 'Mod-Shift-h', run: openSearchPanel },
          ...searchKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        EditorView.domEventHandlers({
          compositionstart: () => {
            controller.composition(doc, true);
          },
          compositionend: () => {
            queueMicrotask(() => controller.composition(doc, false));
          },
          scroll: (_event, current) => {
            model.sourceScroll = current.scrollDOM.scrollTop;
          },
        }),
        EditorView.updateListener.of((update) => {
          const selection = update.state.selection.main;
          model.sourceSelection = {
            anchor: selection.anchor,
            head: selection.head,
          };
          if (
            update.docChanged &&
            !update.transactions.some((t) => t.annotation(external))
          ) {
            const changes: { from: number; to: number; insert: string }[] = [];
            update.changes.iterChanges((from, to, _fromB, _toB, inserted) =>
              changes.push({ from, to, insert: inserted.toString() })
            );
            const group = update.transactions.every((t) =>
              t.isUserEvent('input.type')
            )
              ? 'source-typing'
              : undefined;
            model.editSource(applySourceChanges(model.text(), changes), group);
          } else if (update.selectionSet && !update.docChanged)
            model.breakHistory();
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'var(--font-mono, monospace)',
            lineHeight: '1.8',
          },
          '.cm-content': { padding: '32px 24px 160px', minHeight: '100%' },
          '.cm-gutters': {
            background: 'var(--ws-subtle)',
            border: 'none',
            color: 'var(--ws-muted)',
          },
          '.cm-activeLine': { background: 'var(--ws-hover)' },
          '&.cm-focused': { outline: 'none' },
          '.cm-search': { padding: '8px', fontFamily: 'sans-serif' },
          '.cm-textfield': {
            border: '1px solid var(--ws-strong-line)',
            borderRadius: '4px',
            padding: '3px 6px',
          },
        }),
      ],
    });
    const editorView = new EditorView({ state, parent: host.current });
    view.current = editorView;
    if (visitSource(model) && state.selection.main.head)
      editorView.dispatch({
        effects: EditorView.scrollIntoView(state.selection.main.head, {
          y: 'center',
        }),
      });
    else editorView.scrollDOM.scrollTop = model.sourceScroll;
    editorView.focus();
    return () => {
      model.sourceScroll = editorView.scrollDOM.scrollTop;
      editorView.destroy();
      view.current = null;
    };
  }, [doc, controller, model]);
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const refreshSearch =
      presentationLocale.current !== locale && searchPanelOpen(current.state);
    const query = refreshSearch ? getSearchQuery(current.state) : null;
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (refreshSearch) closeSearchPanel(current);
    current.dispatch({
      effects: presentation.current.reconfigure([
        EditorState.phrases.of(locale === 'en' ? {} : sourcePhrases),
        EditorView.contentAttributes.of({
          'aria-label': t('Markdown 源码 {0}', [
            doc.path.split('/').at(-1) ?? doc.path,
          ]),
          spellcheck: 'false',
        }),
        EditorView.theme({}, { dark: resolvedAppearance === 'dark' }),
        syntaxHighlighting(
          resolvedAppearance === 'dark'
            ? darkHighlightStyle
            : defaultHighlightStyle
        ),
      ]),
    });
    if (refreshSearch && query) {
      openSearchPanel(current);
      current.dispatch({ effects: setSearchQuery.of(query) });
      focused?.focus({ preventScroll: true });
    }
    presentationLocale.current = locale;
  }, [locale, resolvedAppearance, t, doc]);
  useEffect(() => {
    const current = view.current;
    if (!current || current.state.doc.toString() === sourceText(content))
      return;
    const max = sourceText(content).length;
    const selection = model.sourceSelection;
    current.dispatch({
      changes: {
        from: 0,
        to: current.state.doc.length,
        insert: sourceText(content),
      },
      selection: selection
        ? {
            anchor: Math.min(selection.anchor, max),
            head: Math.min(selection.head, max),
          }
        : undefined,
      annotations: external.of(true),
    });
  }, [content, model]);
  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(
        EditorState.readOnly.of(controller.busy)
      ),
    });
  }, [controller.busy]);
  useEffect(() => {
    const current = view.current;
    if (!current || !search) return;
    current.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: search.query, literal: true })
      ),
    });
    if (search.replace) openSearchPanel(current);
    const text = model.text();
    const hit = textMatches(text, search.query)[search.index];
    if (hit)
      current.dispatch({
        selection: {
          anchor: sourceOffset(text, hit.start),
          head: sourceOffset(text, hit.end),
        },
        scrollIntoView: true,
      });
  }, [search, model]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-source-editor>
      <div className="ws-toolbar-shell flex h-12 shrink-0 items-center border-stone-200 border-b px-2">
        <Toolbar
          aria-label={t('编辑工具栏')}
          className="ws-toolbar flex w-full min-w-0 items-center gap-1"
        >
          <ToolbarButton
            aria-label={t('撤销')}
            disabled={!model.canUndo || doc.composing || controller.busy}
            onClick={() => model.undo()}
            tooltip={`${t('撤销')} ${platform === 'mac' ? '⌘Z' : 'Ctrl+Z'}`}
          >
            <Undo2Icon />
          </ToolbarButton>
          <ToolbarButton
            aria-label={t('重做')}
            disabled={!model.canRedo || doc.composing || controller.busy}
            onClick={() => model.redo()}
            tooltip={`${t('重做')} ${platform === 'mac' ? '⌘⇧Z' : 'Ctrl+Shift+Z'}`}
          >
            <Redo2Icon />
          </ToolbarButton>
          <span className="ws-divider" />
          <ToolbarButton
            aria-label={t('查找与替换')}
            onClick={() => {
              if (view.current) openSearchPanel(view.current);
            }}
            tooltip={`${t('查找与替换')} ${platform === 'mac' ? '⌘⇧H' : 'Ctrl+Shift+H'}`}
          >
            <TextSearchIcon />
          </ToolbarButton>
          <div
            className="ml-auto flex shrink-0 items-center gap-0.5"
            data-toolbar-right
          >
            <ModeButton
              mode="source"
              onToggle={() => controller.switchMode(doc)}
            />
          </div>
        </Toolbar>
      </div>
      <div
        className="ws-mode-surface min-h-0 flex-1 overflow-hidden"
        ref={host}
      />
      <WritingStats
        goal={writing.goals?.[controller.workspace!.root]?.[doc.path]}
        path={doc.path}
        root={controller.workspace!.root}
        selected={0}
        words={countWords(content)}
      />
    </div>
  );
}
