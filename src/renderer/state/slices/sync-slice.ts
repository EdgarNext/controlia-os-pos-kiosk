export function createSyncSlice() {
  return {
    syncPendingLegacy: 0,
    syncPendingTabs: 0,
    syncPendingTotal: 0,
    syncLastAt: null as string | null,
    syncLastError: '',
    manualSync: {
      inFlight: false,
      lastError: '',
      lastResultAt: null as string | null,
    },
    autoSync: {
      phase: 'idle' as 'idle' | 'syncing' | 'retrying' | 'error' | 'ok',
      pendingTotal: 0,
      lastOkAt: null as string | null,
      lastErrorShort: '',
    },
    sync: {
      version: 0,
    },
  };
}
