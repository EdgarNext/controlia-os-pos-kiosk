import type { AppState } from '../state/app-state';

type SyncStatusView = {
  syncValue: string;
};

let lastKey = '';
let lastValue: SyncStatusView = { syncValue: 'Al dia' };

export function getSyncStatusView(state: AppState): SyncStatusView {
  const key = `${state.sync.version}|${state.autoSync.phase}|${state.autoSync.pendingTotal}`;
  if (key === lastKey) return lastValue;

  const syncValue =
    state.autoSync.phase === 'syncing'
      ? 'Sync...'
      : state.autoSync.phase === 'retrying' && state.autoSync.pendingTotal > 0
        ? `Pend: ${state.autoSync.pendingTotal} · reintento`
        : state.autoSync.pendingTotal > 0
          ? `Pend: ${state.autoSync.pendingTotal}`
          : 'Al dia';

  lastKey = key;
  lastValue = { syncValue };
  return lastValue;
}
