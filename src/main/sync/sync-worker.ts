import { parentPort } from 'node:worker_threads';
import Database from 'better-sqlite3';
import path from 'node:path';
import { SyncV2Engine } from '../../../lib/services/sales-pos';
import type { SyncWorkerRunInput, SyncWorkerRunResult } from './types';

const port = parentPort;
if (!port) {
  throw new Error('sync-worker requires parentPort');
}

port.on('message', async (input: SyncWorkerRunInput) => {
  const startedAt = Date.now();
  const db = new Database(path.join(input.userDataPath, 'pos-kiosk.sqlite3'));
  db.pragma('journal_mode = WAL');

  try {
    const engine = new SyncV2Engine({
      userDataPath: input.userDataPath,
      getRuntimeConfig: () => input.runtimeConfig,
    });

    let processed = 0;
    let acked = 0;
    let failed = 0;
    let conflicts = 0;
    let forceRefresh = false;
    let lastErrorShort = '';

    for (let i = 0; i < input.maxBatchesPerTick; i += 1) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= input.maxRunMs) break;

      const pendingBefore = countPendingTabs(db);
      if (pendingBefore <= 0) break;

      const result = await engine.syncPending(input.batchSize);
      processed += result.processed;
      acked += result.acked;
      failed += result.failed;
      conflicts += result.conflicts;
      forceRefresh = forceRefresh || result.forceRefresh;
      if (result.error) {
        lastErrorShort = shorten(result.error);
      }

      if (result.pending <= 0 || (!result.ok && result.processed <= 0)) {
        break;
      }
    }

    const finalPending = countPendingTabs(db);
    const output: SyncWorkerRunResult = {
      ok: failed === 0 && conflicts === 0,
      processed,
      acked,
      failed,
      conflicts,
      pending: finalPending,
      forceRefresh,
      tickMs: Date.now() - startedAt,
      lastErrorShort: lastErrorShort || undefined,
    };
    port.postMessage({ ok: true, result: output });
  } catch (error) {
    const output: SyncWorkerRunResult = {
      ok: false,
      processed: 0,
      acked: 0,
      failed: 1,
      conflicts: 0,
      pending: countPendingTabs(db),
      forceRefresh: false,
      tickMs: Date.now() - startedAt,
      lastErrorShort: shorten(error instanceof Error ? error.message : 'sync worker error'),
    };
    port.postMessage({ ok: true, result: output });
  } finally {
    db.close();
  }
});

function countPendingTabs(db: Database.Database): number {
  const row = db
    .prepare("SELECT COUNT(1) AS count FROM outbox_mutations WHERE status IN ('PENDING', 'FAILED')")
    .get() as { count: number } | undefined;
  return row?.count || 0;
}

function shorten(input: string): string {
  const value = String(input || '').trim();
  if (!value) return '';
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}
