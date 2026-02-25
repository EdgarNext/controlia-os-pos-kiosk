import type { RuntimeSyncConfig } from '../../../lib/services/sales-pos';
import type { OutboxSyncResult, OutboxSyncStatus } from '../../shared/orders';
import type { OutboxStatusSnapshot, SyncRequestMode, SyncWorkerRunResult } from './types';
import { SyncWorkerClient } from './sync-worker-client';

const BATCH_SIZE_DEFAULT = 30;
const MAX_RUN_MS = 250;
const MAX_BATCHES_PER_TICK = 3;
const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 120000;

interface SyncCoordinatorInput {
  userDataPath: string;
  getRuntimeConfig: () => RuntimeSyncConfig;
  onStatus: (snapshot: OutboxStatusSnapshot) => void;
}

export class SyncCoordinator {
  private readonly userDataPath: string;
  private readonly getRuntimeConfig: () => RuntimeSyncConfig;
  private readonly onStatus: (snapshot: OutboxStatusSnapshot) => void;
  private readonly workerClient = new SyncWorkerClient();

  private currentPromise: Promise<OutboxSyncResult> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private autoAttempt = 0;
  private debugEvents: Array<{ ts: string; event: string; data?: Record<string, unknown> }> = [];

  private status: OutboxStatusSnapshot = {
    phase: 'idle',
    pendingLegacy: 0,
    pendingTabs: 0,
    pendingTotal: 0,
    autoInFlight: false,
    manualInFlight: false,
    lastOkAt: null,
    lastErrorShort: '',
    updatedAt: new Date().toISOString(),
  };

  constructor(input: SyncCoordinatorInput) {
    this.userDataPath = input.userDataPath;
    this.getRuntimeConfig = input.getRuntimeConfig;
    this.onStatus = input.onStatus;
  }

  start(): void {
    this.pushStatus();
    this.requestSync('auto').catch(() => {
      // background kickoff best effort
    });
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getStatus(): OutboxSyncStatus & Partial<OutboxStatusSnapshot> {
    return {
      pendingLegacy: this.status.pendingLegacy,
      pendingTabs: this.status.pendingTabs,
      pendingTotal: this.status.pendingTotal,
      phase: this.status.phase,
      lastOkAt: this.status.lastOkAt,
      lastErrorShort: this.status.lastErrorShort,
      autoInFlight: this.status.autoInFlight,
      manualInFlight: this.status.manualInFlight,
    };
  }

  getDebugState(): { events: Array<{ ts: string; event: string; data?: Record<string, unknown> }>; status: OutboxStatusSnapshot } {
    return {
      events: [...this.debugEvents],
      status: { ...this.status },
    };
  }

  notifyPendingWork(source: SyncRequestMode = 'sale'): void {
    this.appendDebug('notify-pending', { source });
    void this.requestSync(source);
  }

  async requestSync(mode: SyncRequestMode): Promise<OutboxSyncResult> {
    if (this.currentPromise) {
      this.appendDebug('coalesced', { mode });
      if (mode === 'manual') {
        this.status.manualInFlight = true;
        this.pushStatus();
      }
      return this.currentPromise;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (mode === 'manual') this.status.manualInFlight = true;
    else this.status.autoInFlight = true;
    this.status.phase = 'syncing';
    this.pushStatus();

    this.currentPromise = this.runOnce(mode);
    try {
      return await this.currentPromise;
    } finally {
      this.currentPromise = null;
      this.status.autoInFlight = false;
      this.status.manualInFlight = false;
      this.pushStatus();
    }
  }

  private async runOnce(mode: SyncRequestMode): Promise<OutboxSyncResult> {
    const runResult = await this.workerClient.run({
      userDataPath: this.userDataPath,
      runtimeConfig: this.getRuntimeConfig(),
      batchSize: BATCH_SIZE_DEFAULT,
      maxRunMs: MAX_RUN_MS,
      maxBatchesPerTick: MAX_BATCHES_PER_TICK,
    });

    this.status.pendingTabs = runResult.pending;
    this.status.pendingTotal = runResult.pending;

    const ok = runResult.ok;
    if (ok) {
      this.autoAttempt = 0;
      this.status.lastOkAt = new Date().toISOString();
      this.status.lastErrorShort = '';
      this.status.phase = runResult.pending > 0 ? 'retrying' : 'idle';
      this.appendDebug('sync-ok', {
        mode,
        tickMs: runResult.tickMs,
        processed: runResult.processed,
        acked: runResult.acked,
        failed: runResult.failed,
        conflicts: runResult.conflicts,
        pending: runResult.pending,
      });
      if (runResult.pending > 0 && mode !== 'manual') {
        this.scheduleNext(2000);
      }
    } else {
      this.autoAttempt += 1;
      this.status.lastErrorShort = runResult.lastErrorShort || 'sync failed';
      this.status.phase = mode === 'manual' ? 'error' : 'retrying';
      this.appendDebug('sync-failed', {
        mode,
        tickMs: runResult.tickMs,
        error: this.status.lastErrorShort,
        pending: runResult.pending,
      });
      if (mode !== 'manual' && runResult.pending > 0) {
        this.scheduleNext(this.computeBackoffWithJitterMs());
      }
    }

    this.pushStatus();

    return this.toOutboxSyncResult(runResult);
  }

  private toOutboxSyncResult(result: SyncWorkerRunResult): OutboxSyncResult {
    return {
      ok: result.ok,
      processed: result.processed,
      sent: result.acked,
      failed: result.failed + result.conflicts,
      pending: result.pending,
      processedLegacy: 0,
      sentLegacy: 0,
      failedLegacy: 0,
      pendingLegacy: 0,
      processedTabs: result.processed,
      sentTabs: result.acked,
      failedTabs: result.failed,
      conflictsTabs: result.conflicts,
      pendingTabs: result.pending,
      lastSyncedAt: this.status.lastOkAt || new Date().toISOString(),
      error: result.lastErrorShort,
    };
  }

  private scheduleNext(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.requestSync('auto');
    }, delayMs);
    this.appendDebug('schedule-next', { delayMs });
  }

  private computeBackoffWithJitterMs(): number {
    const base = Math.min(2 ** this.autoAttempt * BASE_BACKOFF_MS, MAX_BACKOFF_MS);
    const jitterFactor = 0.7 + Math.random() * 0.6;
    return Math.floor(base * jitterFactor);
  }

  private pushStatus(): void {
    this.status.updatedAt = new Date().toISOString();
    this.onStatus({ ...this.status });
  }

  private appendDebug(event: string, data?: Record<string, unknown>): void {
    this.debugEvents.push({
      ts: new Date().toISOString(),
      event,
      data,
    });
    if (this.debugEvents.length > 100) {
      this.debugEvents = this.debugEvents.slice(-100);
    }
  }
}
