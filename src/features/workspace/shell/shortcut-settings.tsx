'use client';
import { RotateCcwIcon, UnlinkIcon } from 'lucide-react';
import { useState } from 'react';
import {
  defaultShortcuts,
  keyboardShortcut,
  shortcutCommands,
  shortcutError,
  shortcutKey,
  shortcutLabel,
} from '../shared/shortcuts';
import { useInterface, useT } from '../ui/interface-provider';
export function ShortcutSettings({
  recording,
  setRecording,
}: {
  recording: string | null;
  setRecording: (value: string | null) => void;
}) {
  const preferences = useInterface();
  const t = useT();
  const platform = preferences.platform;
  const [map, setMap] = useState(preferences.shortcuts[platform]);
  const [error, setError] = useState('');
  return (
    <section className="space-y-4">
      <h2 className="font-medium">{t('快捷键')}</h2>
      <p className="text-stone-500 text-xs">
        {t(
          '格式快捷键仅用于可视化。点击组合键后录入，Esc 取消录入；应用后生效。系统可能拦截部分组合。'
        )}
      </p>
      {error && (
        <p className="text-amber-700 text-sm" role="alert">
          {t(error)}
        </p>
      )}
      {(['inline', 'block', 'insert'] as const).map((group) => (
        <section className="space-y-2" key={group}>
          <h3 className="border-stone-200 border-b pb-2 text-sm">
            {t(
              { inline: '行内格式', block: '段落格式', insert: '插入内容' }[
                group
              ]
            )}
          </h3>
          {shortcutCommands
            .filter((c) => c.group === group)
            .map((command) => (
              <div
                className="flex flex-wrap items-center gap-2 text-sm"
                key={command.id}
              >
                <span className="min-w-24 flex-1">{t(command.label)}</span>
                <button
                  aria-label={t('录入快捷键：{0}', [t(command.label)])}
                  className="ws-button min-w-32 font-mono"
                  onBlur={() => setRecording(null)}
                  onClick={() => {
                    setRecording(command.id);
                    setError('');
                  }}
                  onKeyDown={(event) => {
                    if (recording !== command.id) return;
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setRecording(null);
                      return;
                    }
                    if (event.key === 'Tab') {
                      setRecording(null);
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    if (
                      event.nativeEvent.isComposing ||
                      event.getModifierState('AltGraph') ||
                      ['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)
                    )
                      return;
                    const next = {
                      ...map,
                      [command.id]: keyboardShortcut(event.nativeEvent),
                    };
                    const occupied = shortcutCommands.find(
                      (c) =>
                        c.id !== command.id &&
                        map[c.id] &&
                        shortcutKey(map[c.id]!) ===
                          shortcutKey(next[command.id]!)
                    );
                    const issue = occupied
                      ? t('该组合已被“{0}”使用，请先取消该操作的绑定。', [
                          t(occupied.label),
                        ])
                      : shortcutError(next, platform);
                    if (issue) {
                      setError(issue);
                      return;
                    }
                    setMap(next);
                    setRecording(null);
                    setError('');
                  }}
                  type="button"
                >
                  {recording === command.id
                    ? t('请按组合键…')
                    : shortcutLabel(map[command.id], platform)}
                </button>
                <button
                  aria-label={t('取消绑定：{0}', [t(command.label)])}
                  className="ws-button"
                  onClick={() => {
                    setMap({ ...map, [command.id]: null });
                    setError('');
                  }}
                  title={t('取消绑定：{0}', [t(command.label)])}
                  type="button"
                >
                  <UnlinkIcon className="size-4" />
                </button>
                <button
                  aria-label={t('恢复默认：{0}', [t(command.label)])}
                  className="ws-button"
                  onClick={() => {
                    const next = {
                      ...map,
                      [command.id]: defaultShortcuts(platform)[command.id],
                    };
                    const issue = shortcutError(next, platform);
                    if (issue) setError(issue);
                    else {
                      setMap(next);
                      setError('');
                    }
                  }}
                  title={t('恢复默认：{0}', [t(command.label)])}
                  type="button"
                >
                  <RotateCcwIcon className="size-4" />
                </button>
              </div>
            ))}
        </section>
      ))}
      <div className="flex justify-end gap-2">
        <button
          className="ws-button"
          onClick={() => {
            setMap(defaultShortcuts(platform));
            setError('');
          }}
          type="button"
        >
          {t('全部恢复默认')}
        </button>
        <button
          className="ws-button ws-button-primary"
          onClick={() => {
            const issue = shortcutError(map, platform);
            if (issue) {
              setError(issue);
              return;
            }
            preferences.update({
              shortcuts: { ...preferences.shortcuts, [platform]: map },
            });
            setError('');
          }}
          type="button"
        >
          {t('应用')}
        </button>
      </div>
    </section>
  );
}
