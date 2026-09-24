import { NodeApi, type TRange } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { textMatches } from '../shared/search';

export type EditorMatch = { range: TRange; snippet: string };
export type SearchTarget = {
  path: string;
  query: string;
  index: number;
  nonce: number;
  replace?: boolean;
};
export function editorMatches(
  editor: PlateEditor,
  query: string,
  limit = 1000
): EditorMatch[] {
  const results: EditorMatch[] = [];
  const visit = (node: any, path: number[]) => {
    if (results.length >= limit || !node.children || editor.api.isVoid(node))
      return;
    if (
      node.children.some(
        (child: any) => child.children && editor.api.isBlock(child)
      )
    ) {
      node.children.forEach((child: any, index: number) => {
        visit(child, [...path, index]);
      });
      return;
    }
    let text = '';
    const leaves = [...NodeApi.texts(node)].map(([leaf, relative]) => {
      const start = text.length;
      text += leaf.text;
      return { path: [...path, ...relative], start, end: text.length };
    });
    for (const match of textMatches(text, query, limit - results.length)) {
      const anchor = leaves.find(
        (leaf) => leaf.start <= match.start && leaf.end > match.start
      );
      const focus = leaves.find(
        (leaf) => leaf.start < match.end && leaf.end >= match.end
      );
      if (anchor && focus)
        results.push({
          range: {
            anchor: { path: anchor.path, offset: match.start - anchor.start },
            focus: { path: focus.path, offset: match.end - focus.start },
          },
          snippet: text.slice(Math.max(0, match.start - 30), match.end + 65),
        });
    }
  };
  editor.children.forEach((node, index) => {
    visit(node, [index]);
  });
  return results;
}
