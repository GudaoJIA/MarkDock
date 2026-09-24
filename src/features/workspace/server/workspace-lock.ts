import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';

/** Roots are absolute, normalized and symlink-checked by FileService.open. */
export function overlappingRoots(a: string, b: string) {
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === '' ||
      (!path.isAbsolute(relative) &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`))
    );
  };
  return contains(a, b) || contains(b, a);
}

type Operations = {
  changing: Set<string>;
  recoveryBlocked: Set<string>;
  context: AsyncLocalStorage<string>;
  pending: Set<{ root: string; done: Promise<void> }>;
};
// Share state across route bundles and development reloads, not OS processes.
const state = globalThis as typeof globalThis & {
  markdockWorkspaceOperations?: Operations;
};
export const workspaceOperations: Operations =
  state.markdockWorkspaceOperations ?? {
    changing: new Set<string>(),
    recoveryBlocked: new Set<string>(),
    context: new AsyncLocalStorage<string>(),
    pending: new Set(),
  };
state.markdockWorkspaceOperations = workspaceOperations;
const { pending } = workspaceOperations;

export async function withWorkspaceLock<T>(
  root: string,
  action: () => Promise<T>,
  onWait?: () => void
): Promise<T> {
  const predecessors = [...pending].filter((entry) =>
    overlappingRoots(root, entry.root)
  );
  let release!: () => void;
  const entry = {
    root,
    done: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  pending.add(entry);
  try {
    if (predecessors.length) onWait?.();
    await Promise.all(predecessors.map((previous) => previous.done));
    return await action();
  } finally {
    pending.delete(entry);
    release();
  }
}
