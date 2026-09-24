'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { NodeApi, type TCodeBlockElement } from 'platejs';
import { PlateElement, type PlateElementProps } from 'platejs/react';
import { useState } from 'react';
import { useT } from '@/features/workspace/ui/interface-provider';

export function WorkspaceCodeBlock(
  props: PlateElementProps<TCodeBlockElement>
) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const lang = props.element.lang || '';
  const languages = [
    '',
    'javascript',
    'typescript',
    'python',
    'json',
    'html',
    'css',
    'bash',
    'sql',
    'yaml',
    'markdown',
    'go',
    'rust',
    'java',
    'c',
    'cpp',
    'swift',
  ];
  if (!languages.includes(lang)) languages.push(lang);
  return (
    <PlateElement
      {...props}
      className="ws-code my-5 rounded-lg border border-stone-200 bg-stone-50"
    >
      <div
        className="flex items-center justify-between border-stone-200 border-b px-3 py-1.5 text-xs"
        contentEditable={false}
      >
        <select
          aria-label={t('代码语言')}
          className="bg-transparent py-1 outline-none"
          onChange={(event) => {
            const at = props.editor.api.findPath(props.element);
            if (at)
              props.editor.tf.setNodes(
                { lang: event.target.value || undefined },
                { at }
              );
          }}
          value={lang}
        >
          {languages.map((language) => (
            <option key={language} value={language}>
              {language || t('纯文本')}
            </option>
          ))}
        </select>
        <button
          aria-label={copied ? t('代码已复制') : t('复制代码')}
          className="ws-icon-button"
          onClick={() => {
            void navigator.clipboard
              .writeText(
                props.element.children
                  .map((line) => NodeApi.string(line))
                  .join('\n')
              )
              .then(() => {
                setCopied(true);
                setError('');
              })
              .catch(() => setError('复制失败，请选择代码后手动复制。'));
          }}
          type="button"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      {error && (
        <div
          className="px-3 text-amber-700 text-xs"
          contentEditable={false}
          role="alert"
        >
          {t(error)}
        </div>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-sm leading-6">
        <code>{props.children}</code>
      </pre>
    </PlateElement>
  );
}
