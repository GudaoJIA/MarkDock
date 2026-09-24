import { isAttachmentPath } from './resource-paths';
import {
  type ProjectSettings,
  policyAttachment,
  resourceTarget,
} from './resource-policy';
export const ATTACHMENT_DIRECTORY = '附件';
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const PREFIX = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}--/i;
const ABSOLUTE = /^(?:[a-z][a-z\d+.-]*:|\/)/i;
const SUFFIX = /[?#]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in filesystem paths.
const INVALID_PATH = /[\\\u0000-\u001f\u007f]/;

export const attachmentName = (name: string) => name.replace(PREFIX, '');

/** Decode the Markdown URL exactly once; API query encoding is a separate layer. */
export function attachmentTarget(
  id: string,
  documentPath: string,
  url: string,
  settings?: ProjectSettings
) {
  if (settings) {
    const target = resourceTarget(documentPath, url, settings);
    if (
      !target ||
      (!isAttachmentPath(target) &&
        !policyAttachment(documentPath, target, settings))
    )
      return;
    return {
      path: target,
      name: attachmentName(target.split('/').at(-1)!),
      href: `/api/workspace/attachment?${new URLSearchParams({ id, path: target })}`,
    };
  }
  if (!url || ABSOLUTE.test(url)) return;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.split(SUFFIX)[0]);
  } catch {
    return;
  }
  if (ABSOLUTE.test(decoded) || INVALID_PATH.test(decoded)) return;
  const parts = documentPath.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length) return;
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  if (
    parts.some((part) => part.startsWith('.')) ||
    !isAttachmentPath(parts.join('/'))
  )
    return;
  const path = parts.join('/');
  return {
    path,
    name: attachmentName(parts.at(-1)!),
    href: `/api/workspace/attachment?${new URLSearchParams({ id, path })}`,
  };
}
