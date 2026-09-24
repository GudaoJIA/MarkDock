import {
  defaultHistoryLimits,
  type HistoryLimits,
  validHistoryLimits,
} from './history-settings';
import {
  defaultShortcuts,
  parseShortcuts,
  type ShortcutMap,
} from './shortcuts';
export type InterfaceLocale = 'zh-CN' | 'en';
export type Appearance = 'light' | 'dark' | 'system';
export type InterfacePreferences = {
  locale: InterfaceLocale;
  appearance: Appearance;
  showResourceDirectories: boolean;
  showWords: boolean;
  showReadingTime: boolean;
  showWritingGoal: boolean;
  history: HistoryLimits;
  shortcuts: { mac: ShortcutMap; other: ShortcutMap };
};
export const interfaceStorageKey = 'noteai.interface.v1';
export const defaultInterfacePreferences: InterfacePreferences = {
  locale: 'en',
  appearance: 'system',
  showResourceDirectories: false,
  showWords: true,
  showReadingTime: true,
  showWritingGoal: true,
  history: defaultHistoryLimits,
  shortcuts: { mac: defaultShortcuts('mac'), other: defaultShortcuts('other') },
};
export function parseInterfacePreferences(
  value: string | null
): InterfacePreferences {
  try {
    const parsed = JSON.parse(value ?? '{}');
    return {
      showResourceDirectories: parsed?.showResourceDirectories === true,
      showWords: parsed?.showWords !== false,
      showReadingTime: parsed?.showReadingTime !== false,
      showWritingGoal: parsed?.showWritingGoal !== false,
      history: validHistoryLimits(parsed?.history)
        ? parsed.history
        : defaultHistoryLimits,
      shortcuts: {
        mac: parseShortcuts(parsed?.shortcuts?.mac, 'mac'),
        other: parseShortcuts(parsed?.shortcuts?.other, 'other'),
      },
      locale: parsed?.locale === 'zh-CN' ? 'zh-CN' : 'en',
      appearance: ['light', 'dark', 'system'].includes(parsed?.appearance)
        ? parsed.appearance
        : 'system',
    };
  } catch {
    return defaultInterfacePreferences;
  }
}
export function resolveAppearance(appearance: Appearance, systemDark: boolean) {
  return appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
}
