import {
  NodeApi,
  type PathRef,
  PointApi,
  RangeApi,
  type TRange,
} from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { editorMatches } from '../editor/editor-search';
import { RAW_BLOCK } from '../shared/raw';

const HEADING = /^h([1-6])$/;
const HAN = /(\p{Script=Han})/gu;
const MULTILINE = /[\r\n]/;
const WORDS = /\p{Script=Han}|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
export function countWords(text: string) {
  // Isolate Han characters before matching other words, including adjacent Latin text.
  return [...text.replace(HAN, ' $1 ').matchAll(WORDS)].length;
}
export function documentText(editor: PlateEditor, at?: TRange) {
  const text = (node: any): string => {
    if (node.text !== undefined) return node.text;
    if (editor.api.isVoid(node)) return '';
    return (
      node.children
        ?.map(text)
        .join(
          editor.api.isInline(node) ||
            node.children.every(
              (n: any) => n.text !== undefined || editor.api.isInline(n)
            )
            ? ''
            : '\n'
        ) ?? ''
    );
  };
  return (at ? editor.api.fragment(at) : editor.children).map(text).join('\n');
}
export function replaceMatches(
  editor: PlateEditor,
  query: string,
  replacement: string,
  all: boolean,
  index = 0
) {
  if (!query || MULTILINE.test(query + replacement)) return 0;
  const matches = editorMatches(editor, query, Number.POSITIVE_INFINITY);
  const selected = all ? matches : matches.slice(index, index + 1);
  editor.tf.withNewBatch(() =>
    editor.tf.withoutNormalizing(() => {
      for (const { range } of [...selected].reverse()) {
        const { text: _, ...marks } = NodeApi.get(
          editor,
          range.anchor.path
        ) as any;
        if (replacement)
          editor.tf.insertNodes({ ...marks, text: replacement }, { at: range });
        else editor.tf.delete({ at: range });
      }
    })
  );
  return selected.length;
}

type WritingEntry = {
  id: string;
  index: number;
  node: PlateEditor['children'][number];
  text: string;
  level: number;
};

export class WritingModel {
  readonly collapsed = new Set<string>();
  private readonly refs = new Map<string, PathRef>();
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  readonly editor: PlateEditor;
  private cachedChildren?: PlateEditor['children'];
  private cachedEntries: WritingEntry[] = [];
  private readonly cachedUnits = new Map<
    number,
    { start: number; end: number }
  >();
  private cachedHeadings?: (WritingEntry & { parent?: string })[];
  constructor(editor: PlateEditor) {
    this.editor = editor;
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
  entries() {
    if (this.cachedChildren === this.editor.children) return this.cachedEntries;
    this.cachedChildren = this.editor.children;
    this.cachedHeadings = undefined;
    this.cachedUnits.clear();
    const keys = new Map<number, string>();
    for (const [id, ref] of this.refs) {
      if (ref.current?.length === 1) keys.set(ref.current[0], id);
      else {
        ref.unref();
        this.refs.delete(id);
        this.collapsed.delete(id);
      }
    }
    this.cachedEntries = this.editor.children.map((node, index) => {
      let id = keys.get(index);
      if (!id) {
        id = crypto.randomUUID();
        this.refs.set(id, this.editor.api.pathRef([index]));
      }
      return {
        id,
        index,
        node,
        text: NodeApi.string(node),
        level: Number(HEADING.exec(node.type)?.[1] ?? 0),
      };
    });
    return this.cachedEntries;
  }
  headings() {
    const entries = this.entries();
    if (this.cachedHeadings) return this.cachedHeadings;
    const stack: { id: string; level: number }[] = [];
    this.cachedHeadings = entries
      .filter((e) => e.level)
      .map((e) => {
        while (stack.length && stack.at(-1)!.level >= e.level) stack.pop();
        const parent = stack.at(-1)?.id;
        stack.push(e);
        return { ...e, parent };
      });
    return this.cachedHeadings;
  }
  index(id: string) {
    return this.refs.get(id)?.current?.[0] ?? -1;
  }
  unit(index: number) {
    const entries = this.entries();
    const cached = this.cachedUnits.get(index);
    if (cached) return cached;
    const e = entries[index];
    let end = index + 1;
    if (e?.level)
      while (
        end < entries.length &&
        (!entries[end].level || entries[end].level > e.level)
      )
        end++;
    else if (e?.node.listStyleType)
      while (
        end < entries.length &&
        entries[end].node.listStyleType &&
        Number(entries[end].node.indent ?? 0) > Number(e.node.indent ?? 0)
      )
        end++;
    const unit = { start: index, end };
    this.cachedUnits.set(index, unit);
    return unit;
  }
  hidden(index: number) {
    if (!this.collapsed.size) return false;
    return this.headings().some(
      (h) =>
        this.collapsed.has(h.id) &&
        h.index < index &&
        this.unit(h.index).end > index
    );
  }
  reveal(index: number) {
    if (!this.collapsed.size) return false;
    let changed = false;
    for (const h of this.headings())
      if (h.index < index && this.unit(h.index).end > index)
        changed = this.collapsed.delete(h.id) || changed;
    if (changed) this.emit();
    return changed;
  }
  revealSelection(selection = this.editor.selection) {
    if (!selection) return;
    this.reveal(selection.anchor.path[0]);
    this.reveal(selection.focus.path[0]);
  }
  toggle(id: string) {
    const index = this.index(id);
    if (index < 0) return;
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else {
      const { end } = this.unit(index);
      const selection = this.editor.selection;
      if (
        selection &&
        [selection.anchor, selection.focus].some(
          (p) => p.path[0] > index && p.path[0] < end
        )
      )
        this.editor.tf.select(this.editor.api.end([index])!);
      this.collapsed.add(id);
    }
    this.emit();
  }
  guardDelete(backward: boolean) {
    const selection = this.editor.selection;
    if (!selection) return false;
    const start = Math.min(selection.anchor.path[0], selection.focus.path[0]);
    const end = Math.max(selection.anchor.path[0], selection.focus.path[0]);
    let changed = false;
    for (const h of this.headings()) {
      if (!this.collapsed.has(h.id)) continue;
      const finish = this.unit(h.index).end;
      if (
        (start <= h.index && end > h.index) ||
        (start > h.index && start < finish) ||
        (backward &&
          start === finish &&
          RangeApi.isCollapsed(selection) &&
          PointApi.equals(
            selection.anchor,
            this.editor.api.start([finish])!
          )) ||
        (!backward &&
          end === h.index &&
          RangeApi.isCollapsed(selection) &&
          PointApi.equals(selection.anchor, this.editor.api.end([h.index])!))
      ) {
        this.collapsed.delete(h.id);
        changed = true;
      }
    }
    if (changed) this.emit();
    return changed;
  }
  canMove(id: string, target: number) {
    const start = this.index(id);
    if (start < 0 || target < 0 || target > this.editor.children.length)
      return false;
    const unit = this.unit(start);
    if (
      this.editor.children
        .slice(start, unit.end)
        .some((node) => node.type === RAW_BLOCK)
    )
      return false;
    if (target >= start && target <= unit.end) return false;
    if (target < this.editor.children.length && this.hidden(target))
      return false;
    const headings = this.headings();
    const heading = headings.find((h) => h.id === id);
    if (heading)
      return headings
        .filter((h) => h.level === heading.level && h.parent === heading.parent)
        .some((h) => target === h.index || target === this.unit(h.index).end);
    return !this.entries().some(
      (e) =>
        e.node.listStyleType &&
        e.index < target &&
        this.unit(e.index).end > target
    );
  }
  adjacent(id: string, direction: -1 | 1) {
    const start = this.index(id);
    const heading = this.headings().find((h) => h.id === id);
    if (heading) {
      const siblings = this.headings().filter(
        (h) => h.level === heading.level && h.parent === heading.parent
      );
      const next = siblings[siblings.findIndex((h) => h.id === id) + direction];
      return next
        ? direction < 0
          ? next.index
          : this.unit(next.index).end
        : -1;
    }
    if (direction > 0) {
      const end = this.unit(start).end;
      return end < this.editor.children.length ? this.unit(end).end : -1;
    }
    for (let i = start - 1; i >= 0; i--) if (this.canMove(id, i)) return i;
    return -1;
  }
  move(id: string, target: number) {
    if (!this.canMove(id, target)) return false;
    const { start, end } = this.unit(this.index(id));
    this.editor.tf.withNewBatch(() =>
      this.editor.tf.withoutNormalizing(() => {
        for (let i = 0; i < end - start; i++)
          this.editor.tf.moveNodes({
            at: [target < start ? start + i : start],
            to: [target < start ? target + i : target - 1],
          });
      })
    );
    this.emit();
    return true;
  }
}
const models = new WeakMap<PlateEditor, WritingModel>();
export function writingModel(editor: PlateEditor) {
  let model = models.get(editor);
  if (!model) {
    model = new WritingModel(editor);
    models.set(editor, model);
  }
  return model;
}

// Plate wraps native InputEvents; prototype getters are only preserved on nativeEvent.
export function guardWritingInput(
  model: WritingModel,
  event: {
    nativeEvent?: unknown;
    inputType?: string;
    isComposing?: boolean;
    preventDefault: () => void;
  }
) {
  const input = (event.nativeEvent ?? event) as Partial<InputEvent>;
  if (
    !input.isComposing &&
    input.inputType?.startsWith('delete') &&
    model.guardDelete(input.inputType.endsWith('Backward'))
  ) {
    event.preventDefault();
    return true;
  }
}
