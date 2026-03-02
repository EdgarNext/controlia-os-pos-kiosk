export type CleanupFn = () => void;

const cleanupStack: CleanupFn[] = [];

export function registerCleanup(fn: CleanupFn): CleanupFn {
  cleanupStack.push(fn);
  return fn;
}

export function disposeAll(): void {
  while (cleanupStack.length > 0) {
    const fn = cleanupStack.pop();
    if (!fn) continue;
    try {
      fn();
    } catch {
      // Cleanup must be best-effort and never block next callbacks.
    }
  }
}

export function createDisposer(): { register: (fn: CleanupFn) => CleanupFn; dispose: () => void } {
  const local: CleanupFn[] = [];

  return {
    register(fn: CleanupFn): CleanupFn {
      local.push(fn);
      return fn;
    },
    dispose(): void {
      while (local.length > 0) {
        const fn = local.pop();
        if (!fn) continue;
        try {
          fn();
        } catch {
          // Same contract as global cleanup stack.
        }
      }
    },
  };
}
