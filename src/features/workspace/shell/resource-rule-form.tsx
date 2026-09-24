'use client';

import { CheckIcon, FileTextIcon, FolderIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useT } from '@/features/workspace/ui/interface-provider';
import {
  defaultRule,
  type ResourceRule,
  uploadDirectory,
} from '../shared/resource-policy';
import { SettingsHelp } from './settings-help';

const modes = ['assets', 'sibling', 'fixed'] as const;
const titles = {
  assets: '跟随文档 · 带后缀目录',
  sibling: '跟随文档 · 同名目录',
  fixed: '固定目录',
};
type ExampleNode = { name: string; file?: boolean; children: ExampleNode[] };
function exampleTree(document: string, paths: string[]): ExampleNode[] {
  const root: ExampleNode[] = [];
  for (const path of [document, ...paths]) {
    let nodes = root;
    for (const name of path.split('/').filter(Boolean)) {
      let node = nodes.find((item) => item.name === name);
      if (!node) {
        node = { name, children: [] };
        nodes.push(node);
      }
      if (path === document && name === document.split('/').at(-1))
        node.file = true;
      nodes = node.children;
    }
  }
  return root;
}
function DirectoryExample({ nodes }: { nodes: ExampleNode[] }) {
  return (
    <ul className="ws-resource-example">
      {nodes.map((node) => (
        <li key={node.name}>
          <span className="flex min-w-0 items-start gap-1.5">
            {node.file ? (
              <FileTextIcon
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0"
              />
            ) : (
              <FolderIcon
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0"
              />
            )}
            <span className="break-all">
              {node.name}
              {node.file ? '' : '/'}
            </span>
          </span>
          {node.children.length > 0 && (
            <DirectoryExample nodes={node.children} />
          )}
        </li>
      ))}
    </ul>
  );
}
export function ResourceRuleForm({
  rule,
  disabled = false,
  onChange,
}: {
  rule: ResourceRule;
  disabled?: boolean;
  onChange: (rule: ResourceRule) => void;
}) {
  const t = useT();
  const name = useId();
  const [drafts, setDrafts] = useState<
    Record<ResourceRule['mode'], ResourceRule>
  >(() => ({
    assets: { ...defaultRule },
    sibling: { ...defaultRule, mode: 'sibling' },
    fixed: {
      mode: 'fixed',
      images: 'public/images',
      attachments: 'public/files',
      reference: 'site',
      publicRoot: 'public',
    },
    [rule.mode]: rule,
  }));
  const document = `${t('文档')}/${t('文章.md')}`;
  return (
    <fieldset className="space-y-4" disabled={disabled}>
      <legend className="mb-3 text-sm">
        <span className="flex items-center gap-2">
          <span className="font-medium">{t('资源存放方式')}</span>
          <SettingsHelp label={t('资源存放说明')}>
            <p>{t('以上仅为目录示例，不会创建文件或文件夹。')}</p>
            <p>
              {t(
                '跟随文档的资源随文档移动、重命名或移入垃圾箱；固定目录的资源不随行。'
              )}
            </p>
            <p>
              {t(
                '旧规则继续用于解析历史资源，切换设置不会整理旧文件。站点根映射冲突时不会保存。'
              )}
            </p>
          </SettingsHelp>
        </span>
      </legend>
      <div className="grid gap-3 md:grid-cols-3">
        {modes.map((mode) => {
          const selected = mode === rule.mode;
          const example = selected ? rule : drafts[mode];
          return (
            <label
              className="ws-resource-card relative flex min-w-0 cursor-pointer flex-col rounded-lg border border-stone-200 p-4"
              data-selected={selected}
              key={mode}
            >
              <input
                aria-label={t(titles[mode])}
                checked={selected}
                className="peer sr-only"
                name={name}
                onChange={() => {
                  setDrafts((previous) => ({ ...previous, [rule.mode]: rule }));
                  onChange(drafts[mode]);
                }}
                type="radio"
                value={mode}
              />
              <span className="pointer-events-none absolute inset-0 rounded-lg peer-focus-visible:outline-2 peer-focus-visible:outline-stone-500 peer-focus-visible:outline-offset-2" />
              <span className="mb-4 flex items-start justify-between gap-2 font-medium text-sm">
                {t(titles[mode])}
                <CheckIcon
                  aria-hidden="true"
                  className={`size-4 shrink-0 ${selected ? '' : 'invisible'}`}
                />
              </span>
              <span className="mb-2 text-stone-500 text-xs">{t('示例')}</span>
              <div
                aria-hidden="true"
                className="min-w-0 text-stone-600 text-xs leading-6"
              >
                <span className="flex items-center gap-1.5">
                  <FolderIcon className="size-3.5 shrink-0" />
                  {t('工作区根目录')}/
                </span>
                <DirectoryExample
                  nodes={exampleTree(
                    document,
                    ['images', 'attachments'].map((kind) =>
                      uploadDirectory(
                        document,
                        kind as 'images' | 'attachments',
                        example
                      )
                    )
                  )}
                />
              </div>
            </label>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['images', 'attachments'] as const).map((kind) => (
          <label className="grid gap-1 text-sm" key={kind}>
            {kind === 'images' ? t('图片目录') : t('附件目录')}
            <input
              className="ws-input"
              onChange={(e) => onChange({ ...rule, [kind]: e.target.value })}
              placeholder={
                rule.mode === 'fixed'
                  ? t('工作区根内相对目录')
                  : t('留空表示专属目录本身')
              }
              value={rule[kind]}
            />
          </label>
        ))}
      </div>
      <p className="text-stone-500 text-xs">
        {rule.mode === 'fixed'
          ? t('相对于工作区根目录')
          : t('相对于文档专属目录')}
      </p>
      {rule.mode === 'fixed' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid content-start gap-1 text-sm">
            {t('正文引用方式')}
            <select
              aria-label={t('正文引用方式')}
              className="ws-input"
              onChange={(e) =>
                onChange({
                  ...rule,
                  reference: e.target.value as 'relative' | 'site',
                })
              }
              value={rule.reference}
            >
              <option value="relative">{t('相对文档路径')}</option>
              <option value="site">{t('站点根路径')}</option>
            </select>
          </label>
          {rule.reference === 'site' && (
            <label className="grid gap-1 text-sm">
              {t('站点根对应的磁盘目录')}
              <input
                className="ws-input"
                onChange={(e) =>
                  onChange({ ...rule, publicRoot: e.target.value })
                }
                placeholder={t('例如 public 或 source')}
                value={rule.publicRoot}
              />
            </label>
          )}
        </div>
      )}
    </fieldset>
  );
}
