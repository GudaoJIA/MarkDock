import { type ProjectSettings, resourceTarget } from './resource-policy';

const FRONTMATTER_START = /^---\r?\n/;
const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/;
const UNSAFE_PROTOCOL = /^(?:javascript|data|file|vbscript):/i;
const HTTP_URL = /^https?:\/\//i;
const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|\/)/i;
const URL_SUFFIX = /[?#]/;

import {
  getMergedOptionsDeserialize,
  markdownToAstProcessor,
  mdastToSlate,
} from '@platejs/markdown';
import type { SlateEditor, Value } from 'platejs';

export type MarkdownEnvelope = {
  prefix: string;
  body: string;
  newline: '\n' | '\r\n';
  reason?: string;
};

export function splitMarkdown(raw: string): MarkdownEnvelope {
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const text = raw.slice(bom.length);
  if (FRONTMATTER_START.test(text)) {
    const match = text.match(FRONTMATTER_BLOCK);
    if (!match)
      return {
        prefix: bom,
        body: text,
        newline,
        reason: 'YAML 文档头没有结束标记。',
      };
    return {
      prefix: bom + match[0],
      body: text.slice(match[0].length),
      newline,
    };
  }
  return { prefix: bom, body: text, newline };
}

export function joinMarkdown(envelope: MarkdownEnvelope, body: string) {
  return envelope.prefix + body.replace(/\r?\n/g, envelope.newline);
}

const supported = new Set([
  'root',
  'paragraph',
  'text',
  'heading',
  'blockquote',
  'list',
  'listItem',
  'strong',
  'emphasis',
  'delete',
  'inlineCode',
  'code',
  'thematicBreak',
  'break',
  'link',
  'image',
  'table',
  'tableRow',
  'tableCell',
  'definition',
  'linkReference',
  'imageReference',
]);

export function deserializeDocument(editor: SlateEditor, body: string) {
  const ast = markdownToAstProcessor(editor, body);
  const definitions = new Map<string, any>();
  const collect = (node: any) => {
    if (node.type === 'definition')
      definitions.set(node.identifier.toLowerCase(), node);
    node.children?.forEach(collect);
  };
  collect(ast);
  const expand = (original: any): any => {
    let node = original;
    if (node.type === 'definition') return null;
    if (['imageReference', 'linkReference'].includes(node.type)) {
      const definition = definitions.get(node.identifier.toLowerCase());
      if (definition)
        node = {
          ...node,
          type: node.type === 'imageReference' ? 'image' : 'link',
          url: definition.url,
          title: definition.title,
        };
    }
    if (node.children)
      node.children = node.children.map(expand).filter(Boolean);
    return node;
  };
  return mdastToSlate(
    expand(ast),
    getMergedOptionsDeserialize(editor)
  ) as Value;
}

export function markdownIssue(
  editor: SlateEditor,
  body: string
): string | undefined {
  try {
    const tree = markdownToAstProcessor(editor, body);
    let issue: string | undefined;
    const walk = (node: any) => {
      if (!supported.has(node.type)) issue = '包含 HTML、脚注或其他扩展语法。';
      if (node.type === 'code' && node.meta) issue = '代码块包含额外属性。';
      if (node.url && UNSAFE_PROTOCOL.test(node.url))
        issue = '文档包含不支持的链接协议。';
      node.children?.forEach(walk);
    };
    walk(tree);
    return issue;
  } catch {
    return '无法安全解析此 Markdown。';
  }
}

/** Compare syntax meaning, ignoring only formatting and reference-link spelling. */
export function markdownMeaning(editor: SlateEditor, body: string) {
  const ast = markdownToAstProcessor(editor, body.replace(/\r\n/g, '\n'));
  const definitions = new Map<string, any>();
  const usedDefinitions = new Set<string>();
  const collect = (node: any) => {
    if (node.type === 'definition')
      definitions.set(node.identifier.toLowerCase(), node);
    if (['imageReference', 'linkReference'].includes(node.type))
      usedDefinitions.add(node.identifier.toLowerCase());
    node.children?.forEach(collect);
  };
  collect(ast);
  const canonical = (original: any): any => {
    if (original.type === 'definition') {
      return usedDefinitions.has(original.identifier.toLowerCase())
        ? null
        : {
            type: 'definition',
            identifier: original.identifier,
            url: original.url,
            title: original.title ?? null,
          };
    }
    let node = original;
    if (['imageReference', 'linkReference'].includes(node.type)) {
      const definition = definitions.get(node.identifier.toLowerCase());
      if (definition)
        node = {
          ...node,
          type: node.type === 'imageReference' ? 'image' : 'link',
          url: definition.url,
          title: definition.title,
        };
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(node).sort()) {
      if (
        [
          'position',
          'spread',
          'data',
          'identifier',
          'label',
          'referenceType',
        ].includes(key) ||
        node[key] == null
      )
        continue;
      result[key] =
        key === 'children'
          ? node.children.map(canonical).filter(Boolean)
          : node[key];
    }
    return result;
  };
  return JSON.stringify(canonical(ast));
}

/** Resolve only the display URL; the original node URL remains untouched on disk. */
export function imageSource(
  workspaceId: string,
  documentPath: string,
  url: string,
  settings?: ProjectSettings
) {
  if (settings) {
    if (HTTP_URL.test(url)) return url;
    const target = resourceTarget(documentPath, url, settings);
    return target
      ? `/api/workspace?${new URLSearchParams({ operation: 'asset', id: workspaceId, path: target })}`
      : '';
  }
  if (HTTP_URL.test(url)) return url;
  if (ABSOLUTE_URL.test(url)) return '';
  const parts = documentPath.split('/').slice(0, -1);
  let relative: string;
  try {
    relative = decodeURIComponent(url.split(URL_SUFFIX)[0]);
  } catch {
    return '';
  }
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (!parts.length) return '';
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return `/api/workspace?${new URLSearchParams({ operation: 'asset', id: workspaceId, path: parts.join('/') })}`;
}
