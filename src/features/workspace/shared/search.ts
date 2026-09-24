import { MarkdownPlugin, markdownToAstProcessor } from '@platejs/markdown';
import { createSlateEditor } from 'platejs';
import remarkGfm from 'remark-gfm';
import { splitMarkdown } from './markdown';

export type SearchResult = {
  path: string;
  kind: 'name' | 'content';
  snippet: string;
  matchIndex: number;
};
export type SearchResponse = {
  results: SearchResult[];
  truncated: boolean;
  skipped: { path: string; reason: string }[];
};
export type TextMatch = { start: number; end: number };
const parser = createSlateEditor({
  plugins: [
    MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
  ],
});

/** Pure display text: formatting delimiters and link targets do not interrupt words. */
export function searchableMarkdown(content: string): string {
  const envelope = splitMarkdown(content);
  if (envelope.reason) return content;
  try {
    const ast = markdownToAstProcessor(parser, envelope.body);
    const text = (node: any): string => {
      if (node.type === 'definition')
        return envelope.body.slice(
          node.position.start.offset,
          node.position.end.offset
        );
      if (node.type === 'image') return node.alt ?? '';
      if (node.type === 'break') return '\n';
      if (typeof node.value === 'string') return node.value;
      const separator = [
        'paragraph',
        'heading',
        'strong',
        'emphasis',
        'delete',
        'link',
        'linkReference',
        'tableCell',
      ].includes(node.type)
        ? ''
        : '\n';
      return node.children?.map(text).join(separator) ?? '';
    };
    return text(ast);
  } catch {
    return content;
  }
}

export function textMatches(
  text: string,
  query: string,
  limit = 1000
): TextMatch[] {
  if (!query) return [];
  // A Unicode-insensitive regex preserves original offsets (lowercasing İ does not).
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'giu'
  );
  const matches: TextMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    matches.push({ start: match.index!, end: match.index! + match[0].length });
    if (matches.length >= limit) break;
  }
  return matches;
}

export function searchDocument(
  path: string,
  content: string,
  query: string,
  raw = false
): SearchResult | undefined {
  const text = raw ? content : searchableMarkdown(content);
  const matches = textMatches(text, query, 1);
  const nameMatch =
    textMatches(path.split('/').at(-1) ?? path, query, 1).length > 0;
  if (!nameMatch && !matches.length) return;
  const start = matches[0]?.start ?? 0;
  return {
    path,
    kind: nameMatch ? 'name' : 'content',
    matchIndex: 0,
    snippet: `${start > 35 ? '…' : ''}${text.slice(Math.max(0, start - 35), start + query.length + 70).replace(/\s+/g, ' ')}${text.length > start + query.length + 70 ? '…' : ''}`,
  };
}

export function rankResults(results: SearchResult[]) {
  return results.sort(
    (a, b) =>
      Number(b.kind === 'name') - Number(a.kind === 'name') ||
      a.path.localeCompare(b.path, 'zh-CN', { numeric: true })
  );
}

/** Unsaved sessions replace disk hits, even when the new local text no longer matches. */
export function mergeSearch(
  response: SearchResponse,
  local: { path: string; content: string; raw?: boolean }[],
  query: string
): SearchResponse {
  const replaced = new Set(local.map((doc) => doc.path));
  const results = response.results.filter((item) => !replaced.has(item.path));
  for (const doc of local) {
    const result = searchDocument(doc.path, doc.content, query, doc.raw);
    if (result) results.push(result);
  }
  return {
    results: rankResults(results).slice(0, 200),
    truncated: response.truncated || results.length > 200,
    skipped: response.skipped.filter((item) => !replaced.has(item.path)),
  };
}
