// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject unsafe path characters.
const INVALID_DIRECTORY = /[\\:\u0000-\u001f\u007f]/;
const MARKDOWN_EXTENSION = /\.md$/i;
const PARENS = /[()]/g;
const EXTERNAL_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i;
const URL_SUFFIX = /[?#]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject unsafe path characters.
const INVALID_URL = /[\\\u0000-\u001f\u007f]/;
const PROTOCOL = /^[a-z][a-z\d+.-]*:/i;

import { z } from 'zod';
import { WorkspaceError } from './types';

// Paths are project-relative, never host paths. Empty means the selected base.
export const policyPath = z
  .string()
  .max(1024)
  .refine(
    (s) =>
      !s ||
      s
        .split('/')
        .every(
          (p) =>
            !!p &&
            !p.startsWith('.') &&
            p !== 'node_modules' &&
            !INVALID_DIRECTORY.test(p)
        ),
    '请输入项目内的相对目录，不包含隐藏目录或路径穿越。'
  );
export const resourceRuleSchema = z
  .object({
    mode: z.enum(['fixed', 'assets', 'sibling']),
    images: policyPath,
    attachments: policyPath,
    reference: z.enum(['relative', 'site']),
    publicRoot: policyPath,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.mode !== 'fixed' && v.reference !== 'relative')
      ctx.addIssue({ code: 'custom', message: '跟随文档使用相对引用。' });
    if (v.mode === 'fixed' && (!v.images || !v.attachments))
      ctx.addIssue({ code: 'custom', message: '固定资源目录不能为空。' });
    if (
      v.reference === 'site' &&
      (!v.publicRoot ||
        ![v.images, v.attachments].every(
          (p) => p === v.publicRoot || p.startsWith(`${v.publicRoot}/`)
        ))
    )
      ctx.addIssue({
        code: 'custom',
        message: '固定目录必须位于静态目录中，静态目录不能为空。',
      });
  });
export type ResourceRule = z.infer<typeof resourceRuleSchema>;
export const defaultRule: ResourceRule = {
  mode: 'assets',
  images: 'images',
  attachments: 'file',
  reference: 'relative',
  publicRoot: '',
};
export const settingsInputSchema = z
  .object({
    resources: resourceRuleSchema,
  })
  .strict();
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type ProjectSettings = SettingsInput & {
  compatibility: ResourceRule[];
};
export type SettingsSnapshot = {
  settings: ProjectSettings;
  revision: string;
};
export const defaultSettings: ProjectSettings = {
  resources: defaultRule,
  compatibility: [],
};
export const rules = (settings: ProjectSettings) => [
  defaultRule,
  ...settings.compatibility,
  settings.resources,
];
export const joinResource = (...parts: string[]) =>
  parts.filter(Boolean).join('/');
export const ownedDirectory = (document: string, mode: ResourceRule['mode']) =>
  mode === 'fixed'
    ? undefined
    : document.replace(MARKDOWN_EXTENSION, mode === 'assets' ? '.assets' : '');
export function uploadDirectory(
  document: string,
  kind: 'images' | 'attachments',
  rule: ResourceRule
) {
  return joinResource(ownedDirectory(document, rule.mode) ?? '', rule[kind]);
}
export function resourceUrl(
  document: string,
  target: string,
  rule: ResourceRule
) {
  if (rule.reference === 'site')
    return (
      '/' +
      target
        .slice(rule.publicRoot.length + 1)
        .split('/')
        .map(encodeURIComponent)
        .join('/')
    );
  const base = document.split('/').slice(0, -1),
    parts = target.split('/');
  while (base.length && parts.length && base[0] === parts[0]) {
    base.shift();
    parts.shift();
  }
  return [...base.map(() => '..'), ...parts]
    .map((p) =>
      encodeURIComponent(p).replace(
        PARENS,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join('/');
}
export function resourceTarget(
  document: string,
  url: string,
  settings: ProjectSettings = defaultSettings
): string | undefined {
  if (!url || EXTERNAL_URL.test(url)) return;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.split(URL_SUFFIX)[0]);
  } catch {
    return;
  }
  if (
    INVALID_URL.test(decoded) ||
    PROTOCOL.test(decoded) ||
    decoded.startsWith('//')
  )
    return;
  let parts: string[];
  if (decoded.startsWith('/')) {
    const roots = [
      ...new Set(
        rules(settings)
          .filter((r) => r.reference === 'site')
          .map((r) => r.publicRoot)
      ),
    ];
    if (roots.length !== 1) return;
    if (decoded.split('/').some((p) => p === '..')) return;
    parts = roots[0].split('/');
  } else parts = document.split('/').slice(0, -1);
  for (const p of decoded.split('/')) {
    if (p === '..') {
      if (!parts.length) return;
      parts.pop();
    } else if (p && p !== '.') {
      if (p.startsWith('.')) return;
      parts.push(p);
    }
  }
  return parts.join('/');
}
export function policyAttachment(
  document: string,
  target: string,
  settings: ProjectSettings
) {
  return rules(settings).some((r) => {
    const d = uploadDirectory(document, 'attachments', r);
    return target.startsWith(`${d}/`);
  });
}
export function mergeSettings(
  current: ProjectSettings,
  input: SettingsInput
): ProjectSettings {
  const all = rules(current);
  const compatibility = all.filter(
    (r, i) =>
      all.findIndex((x) => JSON.stringify(x) === JSON.stringify(r)) === i &&
      JSON.stringify(r) !== JSON.stringify(input.resources)
  );
  const next: ProjectSettings = { ...input, compatibility };
  if (
    new Set(
      rules(next)
        .filter((r) => r.reference === 'site')
        .map((r) => r.publicRoot)
    ).size > 1
  )
    throw new WorkspaceError(
      '站点根地址已映射到其他目录；变更会使旧链接产生歧义。',
      409
    );
  return next;
}
