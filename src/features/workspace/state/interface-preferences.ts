import {
  defaultInterfacePreferences,
  type InterfacePreferences,
  interfaceStorageKey,
  parseInterfacePreferences,
} from '../shared/interface-preferences';

/** Browser preferences are separate from workspace sessions and service settings. */
export function createInterfacePreferenceStore(
  storage: () => Pick<Storage, 'getItem' | 'setItem'>
) {
  const initial = JSON.stringify(defaultInterfacePreferences);
  let memory = initial;
  let memoryOnly = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const snapshot = () => {
    if (memoryOnly) return memory;
    try {
      return storage().getItem(interfaceStorageKey) ?? initial;
    } catch {
      return memory;
    }
  };
  return {
    snapshot,
    serverSnapshot: () => initial,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload: () => {
      memoryOnly = false;
      memory = initial;
      notify();
    },
    update: (patch: Partial<InterfacePreferences>) => {
      memory = JSON.stringify({
        ...parseInterfacePreferences(snapshot()),
        ...patch,
      });
      try {
        storage().setItem(interfaceStorageKey, memory);
        memoryOnly = false;
      } catch {
        memoryOnly = true;
      }
      notify();
      return !memoryOnly;
    },
  };
}
