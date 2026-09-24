'use client';
import { useSyncExternalStore } from 'react';
import type { PathChange } from '@/features/workspace/shared/types';

const KEY = 'noteai.writing.v1';
const EVENT = 'noteai-writing-preferences';
type Preferences = {
  outline?: boolean;
  goals?: Record<string, Record<string, number>>;
};
let fallback = '{}';
let memoryOnly = false;
const read = () => {
  if (memoryOnly) return fallback;
  try {
    return localStorage.getItem(KEY) || fallback;
  } catch {
    return fallback;
  }
};
const subscribe = (fn: () => void) => {
  window.addEventListener('storage', fn);
  window.addEventListener(EVENT, fn);
  return () => {
    window.removeEventListener('storage', fn);
    window.removeEventListener(EVENT, fn);
  };
};
function parse(value: string): Preferences {
  try {
    const p = JSON.parse(value);
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}
export function useWritingPreferences() {
  return parse(useSyncExternalStore(subscribe, read, () => '{}'));
}
function update(change: (p: Preferences) => Preferences) {
  fallback = JSON.stringify(change(parse(read())));
  let saved = true;
  try {
    localStorage.setItem(KEY, fallback);
    memoryOnly = false;
  } catch {
    saved = false;
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(EVENT));
  return saved;
}
export const setOutline = (outline: boolean) =>
  update((p) => ({ ...p, outline }));
export function setWritingGoal(root: string, path: string, goal?: number) {
  return update((p) => {
    const goals = { ...p.goals, [root]: { ...p.goals?.[root] } };
    if (goal) goals[root][path] = goal;
    else delete goals[root][path];
    return { ...p, goals };
  });
}
export function remapWritingGoals(root: string, mappings: PathChange[]) {
  update((p) => {
    const before = p.goals?.[root];
    if (!before) return p;
    const goals: Record<string, number> = {};
    for (const [path, value] of Object.entries(before)) {
      const match = [...mappings]
        .sort((a, b) => b.from.length - a.from.length)
        .find((m) => path === m.from || path.startsWith(`${m.from}/`));
      goals[match ? match.to + path.slice(match.from.length) : path] = value;
    }
    return { ...p, goals: { ...p.goals, [root]: goals } };
  });
}
