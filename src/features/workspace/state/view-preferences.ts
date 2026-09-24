import type { PathChange } from '../shared/types';
import type { EditingMode } from './editable-document';

const KEY = 'noteai.editor-modes.v1';
type Modes = Record<string, Record<string, EditingMode>>;
let memory: Modes = {};
let memoryOnly = false;
function read(): Modes {
  if (memoryOnly) return memory;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (parsed && typeof parsed === 'object') memory = parsed;
  } catch {
    /* Preferences also work in memory when storage is unavailable. */
  }
  return memory;
}
function write(value: Modes) {
  memory = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    memoryOnly = true;
  }
}
export function readEditingMode(root: string, path: string): EditingMode {
  return read()[root]?.[path] === 'source' ? 'source' : 'rich';
}
export function saveEditingMode(root: string, path: string, mode: EditingMode) {
  const modes = read();
  write({ ...modes, [root]: { ...modes[root], [path]: mode } });
}
export function remapEditingModes(root: string, mappings: PathChange[]) {
  const modes = read();
  const next: Record<string, EditingMode> = {};
  const ordered = [...mappings].sort((a, b) => b.from.length - a.from.length);
  for (const [path, mode] of Object.entries(modes[root] ?? {})) {
    const match = ordered.find(
      (m) => path === m.from || path.startsWith(`${m.from}/`)
    );
    next[match ? match.to + path.slice(match.from.length) : path] = mode;
  }
  write({ ...modes, [root]: next });
}
