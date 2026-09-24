import type { TRange } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import type {
  EditableDocument,
  EditingMode,
  SourceSelection,
} from '../state/editable-document';
import {
  accountBytes,
  type HistoryAccount,
  HistoryBudget,
} from '../state/history-budget';
import type { DocumentSource } from './document-source';
import { rawOffset, sourceOffset } from './source-text';

type Entry = {
  before: string;
  after: string;
  beforeSelection?: SourceSelection;
  afterSelection?: SourceSelection;
  group: unknown;
  time: number;
  order: number;
};

export class DocumentModel implements EditableDocument {
  mode: EditingMode = 'rich';
  sourceSelection?: SourceSelection;
  sourceScroll = 0;
  richSelection?: unknown;
  richScroll = 0;
  private draft: string;
  private richText: string;
  sourceVisited = false;
  private readonly undos: Entry[] = [];
  private readonly redos: Entry[] = [];
  private notify = () => {};
  private restoring = false;
  private compositionGroup?: object;
  private boundary = true;
  private lastSelection?: SourceSelection;
  historyNotice = '';
  private readonly budget: HistoryBudget;
  private readonly account: HistoryAccount;
  private readonly release: () => void;
  private readonly groupIds = new WeakMap<object, object>();
  get historyStats() {
    return {
      undo: this.undos.length,
      redo: this.redos.length,
      bytes: accountBytes(this.account),
    };
  }
  dispose() {
    this.release();
    this.undos.length = 0;
    this.redos.length = 0;
    this.editor.history.undos = [];
    this.editor.history.redos = [];
  }
  private readonly editor: PlateEditor;
  private readonly source: DocumentSource;
  constructor(
    editor: PlateEditor,
    source: DocumentSource,
    raw: string,
    budget = new HistoryBudget()
  ) {
    this.editor = editor;
    this.source = source;
    this.budget = budget;
    this.account = {
      undos: this.undos,
      redos: this.redos,
      composing: false,
      trimmed: (oversized) => {
        this.breakHistory();
        this.editor.history.undos = [];
        this.editor.history.redos = [];
        if (oversized)
          this.historyNotice =
            '本次编辑超出历史预算，较早的操作已无法撤销。正文和保存不受影响。';
      },
    };
    this.release = budget.register(this.account);
    this.draft = raw;
    this.richText = raw;
  }
  get canUndo() {
    return this.undos.length > 0;
  }
  get canRedo() {
    return this.redos.length > 0;
  }
  text = () => (this.mode === 'rich' ? this.source.serialize() : this.draft);
  connect(changed: () => void) {
    this.notify = changed;
    this.editor.tf.undo = () => this.undo();
    this.editor.tf.redo = () => this.redo();
  }
  breakHistory() {
    this.boundary = true;
  }
  composition(active: boolean) {
    if (active) {
      this.account.composing = true;
      this.breakHistory();
      this.compositionGroup = {};
    } else {
      this.capture();
      this.compositionGroup = undefined;
      this.account.composing = false;
      this.budget.enforce();
      this.breakHistory();
    }
  }
  private commit(text: string, group?: unknown) {
    if (this.restoring || text === this.draft) return;
    const key = this.compositionGroup ?? group;
    const previous = this.undos.at(-1);
    const now = Date.now();
    if (
      !this.boundary &&
      key &&
      previous?.group === key &&
      (this.compositionGroup || now - previous.time < 750)
    ) {
      previous.after = text;
      previous.afterSelection = this.sourceSelection;
      previous.time = now;
    } else
      this.undos.push({
        before: this.draft,
        after: text,
        beforeSelection: this.lastSelection,
        afterSelection: this.sourceSelection,
        group: key,
        time: now,
        order: this.budget.nextOrder(),
      });
    this.draft = text;
    this.lastSelection = this.sourceSelection;
    this.redos.length = 0;
    this.boundary = false;
    this.budget.enforce();
  }
  capture() {
    if (this.mode === 'rich') {
      const batch = this.editor.history.undos.at(-1);
      let group: object | undefined;
      if (batch) {
        group = this.groupIds.get(batch);
        if (!group) {
          group = {};
          this.groupIds.set(batch, group);
        }
      }
      this.commit(this.source.serialize(), group);
      // Slate only needs the most recent operation to determine input grouping.
      // Undo itself belongs to this model, so do not retain large operation trees.
      const last = this.editor.history.undos.at(-1);
      if (last) {
        last.operations = last.operations.slice(-1);
        this.editor.history.undos = [last];
      }
      this.editor.history.redos = [];
    }
  }
  editSource(text: string, group?: unknown) {
    this.commit(text, group);
    this.notify();
  }
  switchMode(mode: EditingMode) {
    if (mode === this.mode) return;
    this.capture();
    this.breakHistory();
    if (mode === 'source') {
      this.richText = this.draft;
      this.richSelection = this.editor.selection
        ? structuredClone(this.editor.selection)
        : undefined;
      if (!this.sourceSelection) {
        const offset = sourceOffset(
          this.draft,
          this.source.offset(this.editor.selection?.anchor.path[0] ?? 0)
        );
        this.sourceSelection = { anchor: offset, head: offset };
      }
    } else {
      this.restoring = true;
      this.source.load(this.draft);
      const at =
        this.richText === this.draft && this.richSelection
          ? (this.richSelection as TRange)
          : this.editor.api.start([
              this.source.index(
                rawOffset(this.draft, this.sourceSelection?.head ?? 0)
              ),
            ]);
      if (at) this.editor.tf.select(at);
      this.richSelection = this.editor.selection;
      this.restoring = false;
    }
    this.editor.history.undos = [];
    this.editor.history.redos = [];
    this.mode = mode;
  }
  private restore(text: string, selection?: SourceSelection) {
    this.restoring = true;
    this.draft = text;
    this.sourceSelection = selection;
    if (this.mode === 'rich') {
      this.source.load(text);
      const at = this.editor.api.start([
        this.source.index(rawOffset(text, selection?.head ?? 0)),
      ]);
      if (at) this.editor.tf.select(at);
      this.editor.history.undos = [];
      this.editor.history.redos = [];
    }
    this.restoring = false;
    this.breakHistory();
    this.budget.enforce();
    this.notify();
  }
  undo() {
    this.capture();
    const entry = this.undos.pop();
    if (entry) {
      this.redos.push(entry);
      this.restore(entry.before, entry.beforeSelection);
    }
  }
  redo() {
    this.capture();
    const entry = this.redos.pop();
    if (entry) {
      this.undos.push(entry);
      this.restore(entry.after, entry.afterSelection);
    }
  }
}
