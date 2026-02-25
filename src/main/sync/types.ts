import type { RuntimeSyncConfig } from '../../../lib/services/sales-pos';

export type SyncRequestMode = 'auto' | 'manual' | 'sale';

export interface SyncWorkerRunInput {
  userDataPath: string;
  runtimeConfig: RuntimeSyncConfig;
  batchSize: number;
  maxRunMs: number;
  maxBatchesPerTick: number;
}

export interface SyncWorkerRunResult {
  ok: boolean;
  processed: number;
  acked: number;
  failed: number;
  conflicts: number;
  pending: number;
  forceRefresh: boolean;
  tickMs: number;
  lastErrorShort?: string;
}

export interface OutboxStatusSnapshot {
  phase: 'idle' | 'syncing' | 'retrying' | 'error' | 'ok';
  pendingLegacy: number;
  pendingTabs: number;
  pendingTotal: number;
  autoInFlight: boolean;
  manualInFlight: boolean;
  lastOkAt: string | null;
  lastErrorShort: string;
  updatedAt: string;
}
