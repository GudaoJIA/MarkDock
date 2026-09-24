const MARKDOWN = /\.md$/i;
export const resourceDirectory = (document: string) =>
  document.replace(MARKDOWN, '.assets');
export const isResourceDirectory = (name: string) =>
  name.endsWith('.assets') || name === 'assets' || name === '附件';
export const encodeResourcePath = (value: string) =>
  value.split('/').map(encodeURIComponent).join('/');
export function isAttachmentPath(relative: string) {
  const parts = relative.split('/');
  return (
    parts.slice(0, -1).includes('附件') ||
    parts.some(
      (part, index) =>
        part.endsWith('.assets') &&
        parts[index + 1] === 'file' &&
        index + 2 < parts.length
    )
  );
}
