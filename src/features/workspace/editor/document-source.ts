import { MarkdownPlugin, markdownToAstProcessor } from '@platejs/markdown';
import { KEYS, NodeApi, type Value } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import {
  deserializeDocument,
  markdownIssue,
  markdownMeaning,
  splitMarkdown,
} from '../shared/markdown';
import { RAW_BLOCK } from '../shared/raw';

const TEMPLATE = /\{[{%<]|\{%|\b(?:import|export)\s|<\/?[A-Z]|\{[^\n]*\}/;
const CROSS_TEMPLATE =
  /\{%\s*(?:if|for|block|macro|capture|raw)\b|\{\{[<%]\s*\/?\w/;
const NEWLINES = /\r\n|\r|\n/g;
const END_NEWLINES = /[\r\n]+$/;
const START_NEWLINES = /^[\r\n]+/;
const hasTemplate = (node: any, pattern: RegExp): boolean => {
  if (node.type === 'code' || node.type === 'inlineCode') return false;
  return (
    (typeof node.value === 'string' && pattern.test(node.value)) ||
    (typeof node.url === 'string' && pattern.test(node.url)) ||
    !!node.children?.some((child: any) => hasTemplate(child, pattern))
  );
};

type Segment = {
  id: string;
  raw: string;
  gap: string;
  signature: string;
  shape: string;
  list: boolean;
  start: number;
};
const plain = (node: any): any => {
  if (node.type === KEYS.slashInput) return { text: `/${node.query ?? ''}` };
  const { id: _id, sourceId: _sourceId, ...rest } = node;
  return rest.children ? { ...rest, children: rest.children.map(plain) } : rest;
};
const signature = (nodes: Value) => JSON.stringify(nodes.map(plain));
const shape = (nodes: Value) =>
  JSON.stringify(nodes.map((n) => [n.type, n.listStyleType, n.indent]));
const rawNode = (text: string) => ({ type: RAW_BLOCK, children: [{ text }] });

/** Source slices are immutable; unchanged Slate groups reuse their exact bytes. */
export class DocumentSource {
  private readonly segments = new Map<string, Segment>();
  private original = '';
  private initial = '';
  private prefix = '';
  private newline = '\n';
  private readonly editor: PlateEditor;
  constructor(editor: PlateEditor) {
    this.editor = editor;
  }

  private markdown(nodes: Value) {
    return this.editor.getApi(MarkdownPlugin).markdown.serialize({
      value: nodes.map(plain),
      preserveEmptyParagraphs: false,
    });
  }

  load(raw: string) {
    this.original = raw;
    this.segments.clear();
    this.prefix = '';
    const envelope = splitMarkdown(raw);
    this.newline = envelope.newline;
    const endings = new Set(raw.match(NEWLINES));
    let nodes: Value = [];
    const add = (
      start: number,
      end: number,
      next: number,
      forceRaw = false
    ) => {
      const text = raw.slice(start, end);
      let value: Value = [rawNode(text)];
      if (!forceRaw && !markdownIssue(this.editor, text)) {
        try {
          const parsed = deserializeDocument(this.editor, text);
          if (
            parsed.length &&
            markdownMeaning(this.editor, text) ===
              markdownMeaning(this.editor, this.markdown(parsed))
          )
            value = parsed;
        } catch {
          /* A source block remains editable when conversion is unavailable. */
        }
      }
      const id = crypto.randomUUID();
      value = value.map((node) => ({ ...node, sourceId: id }));
      this.segments.set(id, {
        id,
        raw: text,
        gap: raw.slice(end, next),
        signature: signature(value),
        shape: shape(value),
        list: !!value[0]?.listStyleType,
        start,
      });
      nodes.push(...value);
    };
    try {
      const ast = markdownToAstProcessor(this.editor, envelope.body);
      if (
        envelope.reason ||
        endings.size > 1 ||
        endings.has('\r') ||
        hasTemplate(ast, CROSS_TEMPLATE)
      ) {
        add(0, raw.length, raw.length, true);
      } else {
        const offset = envelope.prefix.length;
        const children = ast.children ?? [];
        this.prefix = envelope.prefix;
        if (children.length) {
          const first = children[0].position?.start.offset;
          if (first == null) throw new Error('Missing source range');
          this.prefix += envelope.body.slice(0, first);
          // References depend on definitions elsewhere. Preserve their enclosing blocks.
          const hasReferences = (n: any): boolean =>
            [
              'definition',
              'linkReference',
              'imageReference',
              'footnoteDefinition',
              'footnoteReference',
            ].includes(n.type) || !!n.children?.some(hasReferences);
          for (let index = 0; index < children.length; index++) {
            const node = children[index];
            const start = node.position?.start.offset;
            const end = node.position?.end.offset;
            const next =
              children[index + 1]?.position?.start.offset ??
              envelope.body.length;
            if (start == null || end == null || next < end)
              throw new Error('Invalid source range');
            add(
              offset + start,
              offset + end,
              offset + next,
              hasReferences(node) || hasTemplate(node, TEMPLATE)
            );
          }
        } else this.prefix += envelope.body;
      }
    } catch {
      this.prefix = '';
      this.segments.clear();
      nodes = [];
      add(0, raw.length, raw.length, true);
    }
    this.editor.tf.withoutSaving(() =>
      this.editor.tf.setValue(
        nodes.length ? nodes : [{ type: KEYS.p, children: [{ text: '' }] }]
      )
    );
    this.initial = signature(this.editor.children);
  }

  serialize() {
    const nodes = [...this.editor.children];
    if (signature(nodes) === this.initial) return this.original;
    while (
      nodes.length &&
      nodes.at(-1)?.type === KEYS.p &&
      !NodeApi.string(plain(nodes.at(-1)!)) &&
      !nodes.at(-1)?.sourceId
    )
      nodes.pop();
    let result = this.prefix;
    for (let i = 0; i < nodes.length; ) {
      const node = nodes[i];
      const id = String(node.sourceId ?? '');
      const group = [node];
      let next = i + 1;
      while (
        next < nodes.length &&
        (nodes[next].sourceId === node.sourceId ||
          (node.listStyleType &&
            nodes[next].listStyleType &&
            (!this.segments.get(String(node.sourceId))?.list ||
              !this.segments.get(String(nodes[next].sourceId))?.list))) &&
        nodes[next].type !== RAW_BLOCK &&
        node.type !== RAW_BLOCK
      )
        group.push(nodes[next++]);
      const segment = this.segments.get(id);
      const unchanged = segment && signature(group) === segment.signature;
      const body = unchanged
        ? segment.raw
        : node.type === RAW_BLOCK
          ? NodeApi.string(node)
          : this.markdown(group)
              .replace(END_NEWLINES, '')
              .replace(NEWLINES, this.newline);
      // Changed structure boundaries require separation, while existing gaps stay exact.
      if (
        result &&
        body &&
        !result.endsWith('\n') &&
        !body.startsWith('\n') &&
        i > 0
      )
        result += this.newline + this.newline;
      result += body;
      const lastSegment = this.segments.get(
        String(group.at(-1)?.sourceId ?? '')
      );
      if (lastSegment) result += lastSegment.gap;
      else
        result +=
          next < nodes.length ? this.newline + this.newline : this.newline;
      if (
        next < nodes.length &&
        node.type !== RAW_BLOCK &&
        nodes[next].type !== RAW_BLOCK &&
        (!segment ||
          shape(group) !== segment.shape ||
          !this.segments.has(String(nodes[next].sourceId)))
      ) {
        const trailing = result.match(END_NEWLINES)?.[0] ?? '';
        const leading =
          this.segments
            .get(String(nodes[next].sourceId))
            ?.raw.match(START_NEWLINES)?.[0] ?? '';
        if ((trailing + leading).replace(/\r/g, '').length < 2)
          result += this.newline;
      }
      i = next;
    }
    return result;
  }

  offset(index: number) {
    return (
      this.segments.get(String(this.editor.children[index]?.sourceId))?.start ??
      0
    );
  }
  index(offset: number) {
    let index = 0;
    for (let i = 0; i < this.editor.children.length; i++)
      if (this.offset(i) <= offset && this.editor.children[i].sourceId)
        index = i;
    return index;
  }
}
