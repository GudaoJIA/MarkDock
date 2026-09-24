import { renameSynced, syncHandle } from './durable-fs';

const MARKDOWN_EXTENSION = /\.md$/i;
const UPLOADED_NAME = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}--/i;

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { z } from 'zod';
import {
  defaultSettings,
  mergeSettings,
  ownedDirectory,
  type ProjectSettings,
  resourceRuleSchema,
  rules,
  type SettingsInput,
  type SettingsSnapshot,
  settingsInputSchema,
} from '../shared/resource-policy';
import { WorkspaceError } from '../shared/types';
import { exists, safePath } from './file-transaction';

const CONFIG = '.markdock.json';
const schema = settingsInputSchema
  .extend({
    version: z.literal(2),
    compatibility: z.array(resourceRuleSchema).max(100),
  })
  .strip();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export async function readSettings(root: string): Promise<SettingsSnapshot> {
  let settings: ProjectSettings = {
    ...structuredClone(defaultSettings),
  };
  let revision = 'absent';
  if (await exists(root, CONFIG)) {
    const file = await safePath(root, CONFIG);
    if ((await fs.stat(file)).size > 128 * 1024)
      throw new WorkspaceError('工作区配置过大。', 413);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const { version: _version, ...configuration } = schema.parse(
        JSON.parse(raw)
      );
      settings = configuration;
      revision = hash(raw);
    } catch {
      throw new WorkspaceError(
        '工作区 .markdock.json 无效，请检查配置，文件不会被覆盖。',
        409
      );
    }
  }
  mergeSettings(settings, {
    resources: settings.resources,
  });
  return { settings, revision };
}
export async function validateSettings(
  root: string,
  input: SettingsInput,
  current: ProjectSettings
) {
  const parsed = settingsInputSchema.parse(input);
  const { version: _version, ...next } = schema.parse({
    ...mergeSettings(current, parsed),
    version: 2,
  });
  for (const rule of rules(next))
    if (rule.mode === 'fixed')
      for (const d of [rule.images, rule.attachments, rule.publicRoot].filter(
        Boolean
      )) {
        await safePath(root, d, true);
        if (await exists(root, d)) await assertResourceDirectory(root, d);
      }
  return next;
}
export async function saveSettings(
  root: string,
  input: SettingsInput,
  revision: string
) {
  const current = await readSettings(root);
  if (current.revision !== revision)
    throw new WorkspaceError('工作区配置已在外部修改，请重新打开设置。', 409);
  const settings = await validateSettings(root, input, current.settings);
  const temporary = `.markdock-${randomUUID()}.tmp`;
  const filename = await safePath(root, temporary, true);
  const raw = `${JSON.stringify(schema.parse({ ...settings, version: 2 }), null, 2)}\n`;
  try {
    const handle = await fs.open(filename, 'wx', 0o600);
    try {
      await handle.writeFile(raw);
      await syncHandle(handle);
    } finally {
      await handle.close();
    }
    if ((await readSettings(root)).revision !== revision)
      throw new WorkspaceError('配置发生外部变化，请重试。', 409);
    await renameSynced(filename, await safePath(root, CONFIG, true));
    return await readSettings(root);
  } finally {
    await fs.unlink(filename).catch(() => undefined);
  }
}
export async function assertResourceDirectory(root: string, directory: string) {
  const target = await safePath(root, directory);
  if (!(await fs.stat(target)).isDirectory())
    throw new WorkspaceError('资源位置被文件占用。', 409);
  for (const entry of await fs.readdir(target, { withFileTypes: true })) {
    if (
      entry.isSymbolicLink() ||
      entry.name.startsWith('.') ||
      (!entry.isFile() && !entry.isDirectory())
    )
      throw new WorkspaceError(
        `资源目录包含隐藏、符号链接或非常规文件：${directory}`,
        409
      );
    if (
      !directory.split('/').some((p) => p.endsWith('.assets')) &&
      entry.isFile() &&
      MARKDOWN_EXTENSION.test(entry.name) &&
      !UPLOADED_NAME.test(entry.name)
    )
      throw new WorkspaceError(
        `目录包含 Markdown 文档，不能作为专属或固定资源目录：${directory}`,
        409
      );
    if (entry.isDirectory())
      await assertResourceDirectory(root, `${directory}/${entry.name}`);
  }
}
export async function ownedResources(
  root: string,
  document: string,
  settings: ProjectSettings
) {
  const result: string[] = [];
  for (const directory of new Set(
    rules(settings)
      .map((r) => ownedDirectory(document, r.mode))
      .filter((v): v is string => !!v)
  )) {
    if (!(await exists(root, directory))) continue;
    for (const rule of rules(settings))
      if (
        rule.mode === 'fixed' &&
        [rule.images, rule.attachments].some(
          (d) =>
            d === directory ||
            d.startsWith(`${directory}/`) ||
            directory.startsWith(`${d}/`)
        )
      )
        throw new WorkspaceError(
          '专属目录与共享目录归属冲突，请检查设置。',
          409
        );
    await assertResourceDirectory(root, directory);
    result.push(directory);
  }
  return result;
}
