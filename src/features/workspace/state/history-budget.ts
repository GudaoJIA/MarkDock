import {
  defaultHistoryLimits,
  type HistoryLimits,
  MiB,
  validHistoryLimits,
} from '../shared/history-settings';
export type HistoryEntry = { before: string; after: string; order: number };
export type HistoryAccount = {
  undos: HistoryEntry[];
  redos: HistoryEntry[];
  composing: boolean;
  trimmed: (oversized: boolean) => void;
};
export const historyBytes = (entry: HistoryEntry) =>
  (entry.before.length + entry.after.length) * 2;
export const accountBytes = (account: HistoryAccount) =>
  [...account.undos, ...account.redos].reduce(
    (sum, entry) => sum + historyBytes(entry),
    0
  );
export class HistoryBudget {
  limits: HistoryLimits = { ...defaultHistoryLimits };
  private readonly accounts = new Set<HistoryAccount>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private sequence = 0;
  nextOrder() {
    return ++this.sequence;
  }
  snapshot = () => this.revision;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    this.revision++;
    for (const fn of this.listeners) fn();
  }
  register(account: HistoryAccount) {
    this.accounts.add(account);
    this.emit();
    return () => {
      this.accounts.delete(account);
      this.emit();
    };
  }
  get bytes() {
    return [...this.accounts].reduce(
      (sum, account) => sum + accountBytes(account),
      0
    );
  }
  configure(limits: HistoryLimits) {
    if (!validHistoryLimits(limits)) throw new Error('历史预算配置无效。');
    this.limits = { ...limits };
    this.enforce();
  }
  private oldest(account: HistoryAccount) {
    // Only the outer boundaries can be removed without breaking the chain.
    return !account.redos.length ||
      (account.undos[0] && account.undos[0].order < account.redos[0].order)
      ? account.undos
      : account.redos;
  }
  enforce() {
    for (const account of this.accounts) {
      if (account.composing) continue;
      const max = this.limits.documentMiB * MiB;
      // Trimming only outer boundaries also handles oversized older entries safely.
      let changed = false;
      let oversized = false;
      while (
        account.undos.length + account.redos.length > this.limits.batches ||
        accountBytes(account) > max
      ) {
        const stack = this.oldest(account);
        const entry = stack.shift();
        if (!entry) break;
        oversized ||= historyBytes(entry) > max;
        changed = true;
      }
      if (changed) account.trimmed(oversized);
    }
    while (this.bytes > this.limits.pageMiB * MiB) {
      const available = [...this.accounts].filter(
        (a) => !a.composing && (a.undos.length || a.redos.length)
      );
      available.sort(
        (a, b) => this.oldest(a)[0].order - this.oldest(b)[0].order
      );
      const account = available[0];
      if (!account) break;
      this.oldest(account).shift();
      account.trimmed(false);
    }
    this.emit();
  }
}
