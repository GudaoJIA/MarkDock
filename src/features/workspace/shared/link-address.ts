// Address validation is local only: never probe a host or a document target.
// biome-ignore lint/suspicious/noControlCharactersInRegex: Controls must never enter executable URLs.
const controls = /[\u0000-\u001f\u007f]/;
const boundary = /[/?#]/;
const scheme = /^([a-z][a-z\d+.-]*):/i;
const fileExtension =
  /\.(?:md|mdx|markdown|txt|pdf|png|jpe?g|gif|webp|svg|avif|zip|json|ya?ml|toml|csv|docx?|xlsx?|pptx?|html?)$/i;
const bareHost =
  /^(?:localhost|(?:[\p{L}\d](?:[\p{L}\d-]*[\p{L}\d])?\.)+[\p{L}\d-]+)(?::\d+)?(?:[/?#]|$)/u;

/** Preserve stored relative references; normalize only explicitly submitted input. */
export function linkAddress(
  input: string,
  normalize = false
): string | undefined {
  if (controls.test(input) || input.includes('\\')) return;
  let value = input.trim();
  if (!value) return;
  const head = value.split(boundary)[0];
  if (normalize && bareHost.test(value) && !fileExtension.test(head))
    value = `https://${value}`;
  const protocol = scheme.exec(value)?.[1].toLowerCase();
  if (protocol && !['http', 'https', 'mailto', 'tel'].includes(protocol))
    return;
  if (protocol === 'http' || protocol === 'https' || value.startsWith('//')) {
    try {
      const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
      if (!parsed.hostname || parsed.username || parsed.password) return;
    } catch {
      return;
    }
  }
  if (
    (protocol === 'mailto' || protocol === 'tel') &&
    !value.slice(protocol.length + 1).trim()
  )
    return;
  return value;
}
