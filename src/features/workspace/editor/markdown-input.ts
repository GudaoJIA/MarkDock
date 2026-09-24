'use client';

import { BlockquoteRules, HeadingRules } from '@platejs/basic-nodes';
import {
  BulletedListRules,
  OrderedListRules,
  TaskListRules,
} from '@platejs/list';
import { MarkdownPlugin, markdownToAstProcessor } from '@platejs/markdown';
import {
  type AnyInputRule,
  createBlockStartInputRule,
  createMarkInputRule,
  KEYS,
  NodeApi,
  PathApi,
  type SlateEditor,
  type Value,
} from 'platejs';
import { createPlatePlugin } from 'platejs/react';
import {
  deserializeDocument,
  markdownIssue,
  markdownMeaning,
} from '@/features/workspace/shared/markdown';
import { RAW_BLOCK } from '../shared/raw';
import { blockFormatState, changeListLevel } from './commands';

const LINE_BREAK = /\r\n|\r|\n/;
const HEADING_KEY = /^h[1-6]$/;
const CODE_FENCE = /^(?:`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const THEMATIC_BREAK = /^(?:-{3,}|\*{3,}|_{3,})$/;
const UNCHECKED_TASK = /^\[(?: )?\]$/;
const CHECKED_TASK = /^\[[xX]\]$/;
const INLINE_DELIMITER = /[*_~`]/;
const OPEN_TICKS = /^`+/;

const composition = new WeakMap<
  SlateEditor,
  { composing: boolean; pending: boolean; queued: boolean }
>();
function inputState(editor: SlateEditor) {
  let state = composition.get(editor);
  if (!state) {
    state = { composing: false, pending: false, queued: false };
    composition.set(editor, state);
  }
  return state;
}

export function setMarkdownComposing(editor: SlateEditor, composing: boolean) {
  const state = inputState(editor);
  state.composing = composing;
  state.pending = !composing;
  if (!composing) checkComposition(editor);
}

function checkComposition(editor: SlateEditor) {
  const state = inputState(editor);
  if (!state.pending || state.queued || state.composing) return;
  state.queued = true;
  queueMicrotask(() => {
    state.queued = false;
    if (state.composing || editor.api.isComposing()) return;
    state.pending = false;
    if (
      blocked(editor, false) ||
      !editor.selection ||
      !editor.api.isCollapsed()
    )
      return;
    const committedSelection = structuredClone(editor.selection);
    const before = editor.api.before(editor.selection, { unit: 'offset' });
    if (!before) return;
    const text = editor.api.string({
      anchor: before,
      focus: editor.selection.focus,
    });
    const rules = editor.meta.inputRules.insertText.byTrigger[text] ?? [];
    if (!rules.length) return;
    editor.tf.select(before);
    const range = editor.api.range('start', editor.selection)!;
    const context = {
      cause: 'insertText',
      editor,
      text,
      committedSelection,
      insertText: editor.tf.insertText,
      isCollapsed: true,
      getBlockEntry: () => editor.api.block(),
      getBlockStartRange: () => range,
      getBlockStartText: () => editor.api.string(range),
      getBlockTextBeforeSelection: () => editor.api.string(range),
      getCharBefore: () => undefined,
      getCharAfter: () => text,
    };
    let handled = false;
    try {
      for (const rule of rules) {
        const ctx = { ...context, pluginKey: rule.pluginKey } as any;
        if (rule.enabled?.(ctx) === false) continue;
        const match = rule.resolve ? rule.resolve(ctx) : true;
        if (match === undefined) continue;
        // The trigger is already present from the IME commit, so do not insert it twice.
        editor.tf.select(committedSelection);
        handled = rule.apply(ctx, match) !== false;
        if (handled) break;
      }
    } finally {
      if (!handled) editor.tf.select(committedSelection);
    }
  });
}

const literalParagraphs = (text: string): Value =>
  text
    .split(LINE_BREAK)
    .map((line) => ({ type: KEYS.p, children: [{ text: line }] }));

export function markdownPasteFragment(
  editor: SlateEditor,
  data: DataTransfer
): Value | undefined {
  if (
    data.getData('text/html') ||
    data.files?.length ||
    data.getData('application/x-slate-fragment')
  )
    return;
  const text = data.getData('text/plain');
  if (!text) return;
  if (markdownIssue(editor, text)) return literalParagraphs(text);
  try {
    const fragment = deserializeDocument(editor, text);
    const saved = editor
      .getApi(MarkdownPlugin)
      .markdown.serialize({ value: fragment, preserveEmptyParagraphs: false });
    if (
      fragment.length &&
      markdownMeaning(editor, text) === markdownMeaning(editor, saved)
    )
      return fragment;
  } catch {
    /* Keep unrepresentable pasted content as literal text. */
  }
  return literalParagraphs(text);
}

export function insertMarkdownFragment(editor: SlateEditor, fragment: Value) {
  if (
    fragment.length === 1 &&
    fragment[0].type === KEYS.p &&
    !fragment[0].listStyleType
  ) {
    editor.tf.insertFragment(fragment);
    return;
  }
  // Media's generic insertFragment can move the original paragraph behind the entire paste.
  // Insert structural fragments at an explicit block boundary and keep both text tails.
  editor.tf.withoutNormalizing(() => {
    if (editor.selection && !editor.api.isCollapsed())
      editor.tf.deleteFragment();
    const entry = editor.api.block();
    if (!entry || !editor.selection) {
      editor.tf.insertNodes(fragment);
      return;
    }
    const [node, path] = entry;
    let at = path;
    if (!NodeApi.string(node)) editor.tf.removeNodes({ at: path });
    else if (!editor.api.isStart(editor.selection.anchor, path)) {
      if (!editor.api.isEnd(editor.selection.focus, path))
        editor.tf.splitNodes({ at: editor.selection, always: true });
      at = PathApi.next(path);
    }
    editor.tf.insertNodes(fragment, { at });
    const last = [...at];
    last[last.length - 1] += fragment.length - 1;
    if (
      [KEYS.img, KEYS.table, KEYS.hr].includes(fragment.at(-1)!.type as any)
    ) {
      const next = PathApi.next(last);
      if (NodeApi.get(editor, next)?.type !== KEYS.p)
        editor.tf.insertNodes(
          { type: KEYS.p, children: [{ text: '' }] },
          { at: next }
        );
      editor.tf.select(editor.api.start(next)!);
    } else editor.tf.select(editor.api.end(last)!);
  });
}

export const WorkspaceMarkdownInputPlugin = createPlatePlugin({
  key: 'workspaceMarkdownInput',
}).overrideEditor(({ editor, tf: { apply, insertData, tab } }) => ({
  transforms: {
    tab(options) {
      const target = editor.dom.currentKeyboardEvent?.target;
      if (
        typeof HTMLElement !== 'undefined' &&
        target instanceof HTMLElement &&
        target.closest('[contenteditable="false"]')
      )
        return false;
      if (editor.api.isReadOnly() || editor.api.isComposing()) return true;
      if (
        editor.api.some({
          match: { type: [KEYS.table, KEYS.codeBlock, RAW_BLOCK] },
        })
      )
        return tab(options);
      const state = blockFormatState(editor);
      if (state.enabled && state.inList) {
        changeListLevel(editor, options.reverse ? -1 : 1);
        return true;
      }
      if (state.list || state.type === 'mixed') return true;
      return tab(options);
    },
    apply(operation) {
      apply(operation);
      checkComposition(editor);
    },
    insertData(data) {
      if (
        inputState(editor).composing ||
        editor.api.isComposing() ||
        editor.api.isReadOnly()
      )
        return;
      const text = data.getData('text/plain');
      editor.tf.withNewBatch(() => {
        if (text && editor.api.some({ match: { type: KEYS.table } }))
          editor.tf.insertFragment(
            literalParagraphs(text.replace(/[\r\n\t\u2028\u2029]+/g, ' '))
          );
        else if (
          text &&
          (editor.api.some({ match: { type: KEYS.codeBlock } }) ||
            editor.api.marks()?.[KEYS.code])
        )
          editor.tf.insertText(text);
        else {
          const fragment = markdownPasteFragment(editor, data);
          if (fragment) insertMarkdownFragment(editor, fragment);
          else insertData(data);
        }
      });
    },
  },
}));

function blocked(editor: SlateEditor, structural: boolean) {
  return (
    inputState(editor).composing ||
    editor.api.isComposing() ||
    editor.api.isReadOnly() ||
    editor.api.some({
      match: {
        type: structural
          ? [KEYS.table, KEYS.codeBlock, RAW_BLOCK]
          : [KEYS.codeBlock, RAW_BLOCK],
      },
    }) ||
    !!editor.api.marks()?.[KEYS.code]
  );
}

/** Record the literal trigger before the conversion, so undo restores complete syntax. */
export function workspaceInputRule(
  rule: AnyInputRule<any>,
  structural = false
): AnyInputRule<any> {
  return {
    ...rule,
    enabled: (context) =>
      !blocked(context.editor, structural) &&
      (rule.enabled?.(context as never) ?? true),
    apply: (context: any, match: any) => {
      const { editor } = context;
      const before = context.committedSelection
        ? {
            anchor: context.getBlockStartRange().focus,
            focus: context.getBlockStartRange().focus,
          }
        : structuredClone(editor.selection);
      if (context.cause === 'insertText' && !context.committedSelection)
        context.insertText(context.text, context.options);
      editor.tf.withNewBatch(() =>
        editor.tf.withoutNormalizing(() => {
          if (context.cause === 'insertText') {
            editor.tf.delete({
              at: { anchor: before.anchor, focus: editor.selection.focus },
            });
            editor.tf.select(before);
          }
          rule.apply(context, match);
        })
      );
      return true;
    },
  } as AnyInputRule<any>;
}

export function workspaceBlockRules(key: string): AnyInputRule<any>[] {
  if (key === KEYS.hr) {
    const enterRules = workspaceBlockRules('workspaceHrEnter');
    return [
      workspaceInputRule(
        createBlockStartInputRule({
          trigger: ' ',
          match: '---',
          enabled: ({ editor }) => {
            const entry = editor.api.block();
            return (
              !!entry &&
              entry[1].length === 1 &&
              entry[0].type === KEYS.p &&
              !entry[0].listStyleType &&
              NodeApi.string(entry[0]) === '---'
            );
          },
          apply: ({ editor }) => {
            const entry = editor.api.block()!;
            editor.tf.removeNodes({ at: entry[1] });
            editor.tf.insertNodes(
              [
                { type: KEYS.hr, children: [{ text: '' }] },
                { type: KEYS.p, children: [{ text: '' }] },
              ],
              { at: entry[1] }
            );
            editor.tf.select(editor.api.start(PathApi.next(entry[1]))!);
          },
        }),
        true
      ),
      ...enterRules,
    ];
  }
  const rules: AnyInputRule<any>[] = HEADING_KEY.test(key)
    ? [HeadingRules.markdown()]
    : key === KEYS.blockquote
      ? [BlockquoteRules.markdown()]
      : key === KEYS.codeBlock || key === 'workspaceHrEnter'
        ? [
            {
              target: 'insertBreak',
              resolve: (context) => {
                const entry = context.getBlockEntry();
                if (
                  !entry ||
                  entry[0].type !== KEYS.p ||
                  entry[0].listStyleType ||
                  !context.isCollapsed ||
                  !context.editor.api.isEnd(
                    context.editor.selection!.focus,
                    entry[1]
                  )
                )
                  return;
                const source = context.getBlockStartText() ?? '';
                const match =
                  key === KEYS.codeBlock
                    ? CODE_FENCE.exec(source)
                    : THEMATIC_BREAK.exec(source);
                if (match)
                  return { path: entry[1], lang: match[1] || undefined };
              },
              apply: ({ editor }, match) => {
                editor.tf.removeNodes({ at: match.path });
                editor.tf.insertNodes(
                  key === KEYS.codeBlock
                    ? {
                        type: KEYS.codeBlock,
                        lang: match.lang,
                        children: [
                          { type: KEYS.codeLine, children: [{ text: '' }] },
                        ],
                      }
                    : { type: KEYS.hr, children: [{ text: '' }] },
                  { at: match.path }
                );
                if (key === 'workspaceHrEnter') {
                  const next = [...match.path];
                  next[next.length - 1]++;
                  editor.tf.insertNodes(
                    { type: KEYS.p, children: [{ text: '' }] },
                    { at: next }
                  );
                  editor.tf.select(editor.api.start(next)!);
                } else editor.tf.select(editor.api.start(match.path)!);
                return true;
              },
            },
          ]
        : key === KEYS.list
          ? [
              BulletedListRules.markdown({ variant: '-' }),
              BulletedListRules.markdown({ variant: '*' }),
              createBlockStartInputRule({
                trigger: ' ',
                match: '+',
                apply: (context, match) => {
                  const rule = BulletedListRules.markdown();
                  if (rule.target === 'insertText')
                    return rule.apply(context, match);
                },
              }),
              OrderedListRules.markdown({ variant: '.' }),
              OrderedListRules.markdown({ variant: ')' }),
              createBlockStartInputRule({
                trigger: ' ',
                match: UNCHECKED_TASK,
                apply: (context, match) => {
                  const rule = TaskListRules.markdown({ checked: false });
                  if (rule.target === 'insertText')
                    return rule.apply(context, match);
                },
              }),
              createBlockStartInputRule({
                trigger: ' ',
                match: CHECKED_TASK,
                apply: (context, match) => {
                  const rule = TaskListRules.markdown({ checked: true });
                  if (rule.target === 'insertText')
                    return rule.apply(context, match);
                },
              }),
            ]
          : [];
  return rules.map((rule) => workspaceInputRule(rule, true));
}

const inlineMarks: Record<string, string> = {
  strong: KEYS.bold,
  emphasis: KEYS.italic,
  delete: KEYS.strikethrough,
};

/** Parse only the text before the caret; CommonMark supplies escape and Unicode boundaries. */
export const workspaceInlineRule = workspaceInputRule({
  target: 'insertText',
  trigger: ['*', '_', '~', '`', ')'],
  priority: 200,
  resolve: (context) => {
    const { editor } = context;
    if (!context.isCollapsed || context.options?.at) return;
    const source = (context.getBlockStartText() ?? '') + context.text;
    const ast = markdownToAstProcessor(editor, source);
    if (ast.children.length !== 1 || ast.children[0].type !== 'paragraph')
      return;
    const node: any = ast.children[0].children.at(-1);
    if (
      !node ||
      !(
        node.type in inlineMarks ||
        ['inlineCode', 'link', 'image'].includes(node.type)
      ) ||
      node.position?.end.offset !== source.length
    )
      return;
    const start: number = node.position.start.offset;
    if (node.type === 'link' && source[start] !== '[') return;
    // An open code delimiter protects its contents until the matching run is typed.
    if (node.type !== 'inlineCode') {
      let openTicks = 0;
      for (const token of source.slice(0, start).matchAll(/\\.|`+/g)) {
        if (!token[0].startsWith('`')) continue;
        if (!openTicks) openTicks = token[0].length;
        else if (openTicks === token[0].length) openTicks = 0;
      }
      if (openTicks) return;
    }

    // Do not consume a shorter delimiter while a longer opening delimiter is unfinished.
    if (
      start > 0 &&
      INLINE_DELIMITER.test(source[start]) &&
      source[start - 1] === source[start]
    )
      return;
    if (markdownIssue(editor, source.slice(start))) return;
    const entry = context.getBlockEntry()!;
    if (
      node.type === 'image' &&
      (start !== 0 ||
        entry[0].type !== KEYS.p ||
        entry[0].listStyleType ||
        blocked(editor, true) ||
        !editor.api.isEnd(
          (context as any).committedSelection?.focus ?? editor.selection!.focus,
          entry[1]
        ))
    )
      return;
    if (node.type === 'link' && editor.api.some({ match: { type: KEYS.link } }))
      return;
    // Slate counts boundaries between formatted leaves as offsets; Markdown does not.
    const point = (offset: number) => {
      let remaining = offset;
      for (const [leaf, relativePath] of NodeApi.texts(entry[0])) {
        if (remaining <= leaf.text.length)
          return { path: [...entry[1], ...relativePath], offset: remaining };
        remaining -= leaf.text.length;
      }
      return editor.selection!.anchor;
    };
    if (node.type === 'image') return { node, path: entry[1], source };
    const marks: string[] = [];
    let inner = node;
    while (inner.type in inlineMarks) {
      marks.push(inlineMarks[inner.type]);
      if (
        inner.children.length !== 1 ||
        !(inner.children[0].type in inlineMarks)
      )
        break;
      inner = inner.children[0];
    }
    const ticks =
      node.type === 'inlineCode'
        ? OPEN_TICKS.exec(source.slice(start))![0].length
        : 0;
    const contentStart = ticks
      ? start + ticks
      : inner.children[0]?.position.start.offset;
    const contentEnd = ticks
      ? source.length - ticks
      : inner.children.at(-1)?.position.end.offset;
    if (
      contentStart === undefined ||
      contentEnd === undefined ||
      contentStart === contentEnd
    )
      return;
    return {
      node,
      marks,
      beforeStartMatchPoint: point(start),
      afterStartMatchPoint: point(contentStart),
      beforeEndMatchPoint: point(contentEnd),
    };
  },
  apply: (context, match) => {
    const { editor } = context;
    if (match.node.type === 'image') {
      const image = deserializeDocument(editor, match.source)[0];
      editor.tf.removeNodes({ at: match.path });
      editor.tf.insertNodes(image, { at: match.path });
      const next = PathApi.next(match.path);
      editor.tf.insertNodes(
        { type: KEYS.p, children: [{ text: '' }] },
        { at: next }
      );
      editor.tf.select(editor.api.start(next)!);
    } else if (match.node.type === 'link' || match.node.type === 'inlineCode') {
      const range = editor.api.rangeRef({
        anchor: match.afterStartMatchPoint,
        focus: match.beforeEndMatchPoint,
      });
      if (match.beforeEndMatchPoint !== editor.selection!.anchor)
        editor.tf.delete({
          at: {
            anchor: match.beforeEndMatchPoint,
            focus: editor.selection!.anchor,
          },
        });
      editor.tf.delete({
        at: {
          anchor: match.beforeStartMatchPoint,
          focus: match.afterStartMatchPoint,
        },
      });
      editor.tf.select(range.unref()!);
      if (match.node.type === 'inlineCode') {
        editor.tf.insertNodes(
          { text: match.node.value, code: true },
          { select: true }
        );
        editor.tf.collapse({ edge: 'end' });
        editor.tf.removeMark(KEYS.code);
      } else {
        editor.tf.wrapNodes(
          {
            type: KEYS.link,
            url: match.node.url,
            title: match.node.title,
            children: [],
          },
          { split: true }
        );
        editor.tf.collapse({ edge: 'end' });
        const link = editor.api.above({ match: { type: KEYS.link } })!;
        const next = PathApi.next(link[1]);
        if (!editor.api.node(next))
          editor.tf.insertNodes({ text: '' }, { at: next });
        editor.tf.select(editor.api.start(next)!);
      }
    } else
      createMarkInputRule({ start: '', trigger: '', marks: match.marks }).apply(
        context,
        match
      );
    return true;
  },
});
