export type EditingMode = 'rich' | 'source';
export type SourceSelection = { anchor: number; head: number };
export type EditableDocument = {
  breakHistory(): void;
  dispose?(): void;
  historyStats?: { undo: number; redo: number; bytes: number };
  historyNotice?: string;
  canRedo: boolean;
  canUndo: boolean;
  capture(): void;
  composition(active: boolean): void;
  connect(changed: () => void): void;
  editSource(text: string, group?: unknown): void;
  mode: EditingMode;
  redo(): void;
  richScroll: number;
  richSelection?: unknown;
  sourceScroll: number;
  sourceVisited?: boolean;
  sourceSelection?: SourceSelection;
  switchMode(mode: EditingMode): void;
  text(): string;
  undo(): void;
};

/** Retained sessions may predate a hot update, so do not require a new instance method. */
export function visitSource(document: Pick<EditableDocument, 'sourceVisited'>) {
  const first = document.sourceVisited !== true;
  document.sourceVisited = true;
  return first;
}
