const LINE_ENDINGS = /\r\n|\r/g;
export const sourceText = (raw: string) => raw.replace(LINE_ENDINGS, '\n');
export const sourceOffset = (raw: string, offset: number) =>
  sourceText(raw.slice(0, offset)).length;
export function rawOffset(raw: string, offset: number) {
  let index = 0;
  for (let count = 0; count < offset && index < raw.length; count++, index++)
    if (raw[index] === '\r' && raw[index + 1] === '\n') index++;
  return index;
}

/** Apply CodeMirror's LF-based offsets to the original bytes without normalizing untouched lines. */
export function applySourceChanges(
  raw: string,
  changes: { from: number; to: number; insert: string }[]
) {
  const offsets: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    offsets.push(i);
    if (raw[i] === '\r' && raw[i + 1] === '\n') i++;
  }
  offsets.push(raw.length);
  const newline = raw.includes('\r\n')
    ? '\r\n'
    : raw.includes('\r') && !raw.includes('\n')
      ? '\r'
      : '\n';
  let result = raw;
  for (const change of [...changes].reverse())
    result =
      result.slice(0, offsets[change.from]) +
      change.insert.replace(/\n/g, newline) +
      result.slice(offsets[change.to]);
  return result;
}
