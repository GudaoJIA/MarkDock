'use client';
import { shortcutLabel } from '../shared/shortcuts';
import { useInterface } from './interface-provider';
export function useShortcutHint() {
  const { shortcuts, platform } = useInterface();
  return (id: string) => shortcutLabel(shortcuts[platform][id], platform);
}
