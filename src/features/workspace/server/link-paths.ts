import path from 'node:path';
import { parse, postprocess, preprocess } from 'micromark';
import { gfm } from 'micromark-extension-gfm';
import { decodeString } from 'micromark-util-decode-string';
import { splitMarkdown } from '../shared/markdown';
import { WorkspaceError } from '../shared/types';

const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/|#|\?)/i;
const ABSOLUTE = /^(?:[a-z][a-z\d+.-]*:|\/)/i;
const UNSAFE_LINK =
  /(?:<(?:img|a|source|video|audio)\b[^>]*(?:src|href)|!?\[\[)/i;
const SUFFIX = /[?#]/;
const PARENS = /[()]/g;
export function localTarget(document: string, url: string) {
  if (!url || EXTERNAL.test(url)) return;
  const at = url.search(SUFFIX);
  const pathname = at < 0 ? url : url.slice(0, at);
  const suffix = at < 0 ? '' : url.slice(at);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new WorkspaceError('链接编码无效，无法安全调整路径。');
  }
  if (
    ABSOLUTE.test(decoded) ||
    decoded.includes('\\') ||
    decoded.includes('\0')
  )
    throw new WorkspaceError('本地链接路径无效。');
  const target = path.posix.normalize(
    path.posix.join(path.posix.dirname(document), decoded)
  );
  if (target === '..' || target.startsWith('../'))
    throw new WorkspaceError('本地链接超出工作区，无法安全移动。');
  return { path: target, suffix };
}
export function relativeLink(document: string, target: string, suffix = '') {
  return (
    path.posix
      .relative(path.posix.dirname(document), target)
      .split('/')
      .map((part) =>
        encodeURIComponent(part).replace(
          PARENS,
          (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
        )
      )
      .join('/') + suffix
  );
}
export function linkSpans(raw: string) {
  const envelope = splitMarkdown(raw);
  if (envelope.reason) throw new WorkspaceError(envelope.reason);
  const events = postprocess(
    parse({ extensions: [gfm()] })
      .document()
      .write(preprocess()(envelope.body, undefined, true))
  );
  return events
    .filter(
      ([kind, t]) =>
        kind === 'enter' &&
        ['resourceDestinationString', 'definitionDestinationString'].includes(
          t.type
        )
    )
    .map(([, token]) => ({
      start: envelope.prefix.length + token.start.offset!,
      end: envelope.prefix.length + token.end.offset!,
      url: decodeString(
        envelope.body.slice(token.start.offset, token.end.offset)
      ),
    }));
}
export function rewriteLinks(
  raw: string,
  rewrite: (url: string) => string | undefined
) {
  let result = raw;
  for (const span of linkSpans(raw).reverse()) {
    const next = rewrite(span.url);
    if (next !== undefined && next !== span.url)
      result = result.slice(0, span.start) + next + result.slice(span.end);
  }
  return result;
}

export function hasUnsupportedLinks(raw: string) {
  const envelope = splitMarkdown(raw);
  if (envelope.reason) throw new WorkspaceError(envelope.reason);
  let body = envelope.body;
  const events = postprocess(
    parse({ extensions: [gfm()] })
      .document()
      .write(preprocess()(body, undefined, true))
  );
  const code = events.filter(
    ([kind, t]) =>
      kind === 'enter' &&
      ['codeText', 'codeFenced', 'codeIndented'].includes(t.type)
  );
  for (const [, token] of code.reverse())
    body =
      body.slice(0, token.start.offset) +
      ' '.repeat(token.end.offset! - token.start.offset!) +
      body.slice(token.end.offset);
  return UNSAFE_LINK.test(body);
}
