'use client';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  defaultInterfacePreferences,
  type InterfacePreferences,
  interfaceStorageKey,
  parseInterfacePreferences,
  resolveAppearance,
} from '../shared/interface-preferences';
import type { ShortcutPlatform } from '../shared/shortcuts';
import { translate } from '../shared/translate';
import { createInterfacePreferenceStore } from '../state/interface-preferences';

const noPlatformChanges = () => () => {};
const applePlatform = /Mac|iPhone|iPad/;
const browserPlatform = (): ShortcutPlatform =>
  applePlatform.test(navigator.platform) ? 'mac' : 'other';
const preferenceStore = createInterfacePreferenceStore(() => localStorage);
function subscribe(listener: () => void) {
  const unsubscribe = preferenceStore.subscribe(listener);
  const storage = (event: StorageEvent) => {
    if (event.key === interfaceStorageKey || event.key === null)
      preferenceStore.reload();
  };
  window.addEventListener('storage', storage);
  return () => {
    unsubscribe();
    window.removeEventListener('storage', storage);
  };
}
const systemSnapshot = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches;
function subscribeSystem(listener: () => void) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
const defaultT = (message: string, values?: readonly (string | number)[]) =>
  translate(defaultInterfacePreferences.locale, message, values);
const InterfaceContext = createContext({
  ...defaultInterfacePreferences,
  resolvedAppearance: 'light' as 'light' | 'dark',
  persistent: true,
  platform: 'other' as ShortcutPlatform,
  update: (_patch: Partial<InterfacePreferences>) => {},
  t: defaultT,
});
export function InterfaceProvider({ children }: { children: ReactNode }) {
  const platform = useSyncExternalStore(
    noPlatformChanges,
    browserPlatform,
    () => 'other' as ShortcutPlatform
  );
  const raw = useSyncExternalStore(
    subscribe,
    preferenceStore.snapshot,
    preferenceStore.serverSnapshot
  );
  const settings = useMemo(() => parseInterfacePreferences(raw), [raw]);
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    systemSnapshot,
    () => false
  );
  const resolvedAppearance = resolveAppearance(settings.appearance, systemDark);
  const [persistent, setPersistent] = useState(true);
  const update = useCallback((patch: Partial<InterfacePreferences>) => {
    setPersistent(preferenceStore.update(patch));
  }, []);
  const t = useCallback(
    (message: string, values?: readonly (string | number)[]) =>
      translate(settings.locale, message, values),
    [settings.locale]
  );
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedAppearance === 'dark');
    root.style.colorScheme = resolvedAppearance;
    root.lang = settings.locale;
    document.title =
      settings.locale === 'en'
        ? 'MarkDock · Markdown workspace'
        : 'MarkDock · 本地 Markdown 工作区';
  }, [resolvedAppearance, settings.locale]);
  const value = useMemo(
    () => ({
      ...settings,
      resolvedAppearance,
      persistent,
      update,
      t,
      platform,
    }),
    [settings, resolvedAppearance, persistent, update, t, platform]
  );
  return (
    <InterfaceContext.Provider value={value}>
      {children}
    </InterfaceContext.Provider>
  );
}
export const useInterface = () => useContext(InterfaceContext);
export const useT = () => useInterface().t;
