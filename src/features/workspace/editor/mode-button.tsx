'use client';

import { CodeXml, FilePenLine } from 'lucide-react';
import { ToolbarButton } from '@/components/ui/toolbar';
import { useT } from '@/features/workspace/ui/interface-provider';
import type { EditingMode } from '../state/editable-document';

export function ModeButton({
  mode,
  onToggle,
}: {
  mode: EditingMode;
  onToggle: () => void;
}) {
  const t = useT();
  const label =
    mode === 'rich'
      ? t('当前：可视化；切换到源码')
      : t('当前：源码；切换到可视化');
  const Icon = mode === 'rich' ? CodeXml : FilePenLine;
  return (
    <ToolbarButton
      aria-label={t(label)}
      data-editing-mode={mode}
      onClick={onToggle}
      onMouseDown={(e) => e.preventDefault()}
      tooltip={t(label)}
    >
      <Icon />
    </ToolbarButton>
  );
}
