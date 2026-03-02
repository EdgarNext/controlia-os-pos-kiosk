import { registerCleanup } from './lifecycle';

type TimerLabelMap = Map<number, string>;

const trackedIntervals: TimerLabelMap = new Map();
const trackedTimeouts: TimerLabelMap = new Map();
let cleanupHooked = false;

function ensureCleanupHook(): void {
  if (cleanupHooked) return;
  cleanupHooked = true;
  registerCleanup(() => {
    clearAllTrackedTimers();
    cleanupHooked = false;
  });
}

export function setIntervalTracked(fn: () => void, ms: number, label = 'interval'): number {
  ensureCleanupHook();
  const id = window.setInterval(fn, ms);
  trackedIntervals.set(id, label);
  return id;
}

export function clearTrackedInterval(id: number | null): void {
  if (id == null) return;
  if (trackedIntervals.has(id)) trackedIntervals.delete(id);
  window.clearInterval(id);
}

export function setTimeoutTracked(fn: () => void, ms: number, label = 'timeout'): number {
  ensureCleanupHook();
  const id = window.setTimeout(() => {
    trackedTimeouts.delete(id);
    fn();
  }, ms);
  trackedTimeouts.set(id, label);
  return id;
}

export function clearTrackedTimeout(id: number | null): void {
  if (id == null) return;
  if (trackedTimeouts.has(id)) trackedTimeouts.delete(id);
  window.clearTimeout(id);
}

export function clearAllTrackedTimers(): void {
  trackedIntervals.forEach((_label, id) => {
    window.clearInterval(id);
  });
  trackedIntervals.clear();

  trackedTimeouts.forEach((_label, id) => {
    window.clearTimeout(id);
  });
  trackedTimeouts.clear();
}
