import { OutboxRepo, type OutboxMutationRecord } from '../../outboxRepo';
import { TabsRepo } from '../../tabsRepo';

interface SyncV2Ack {
  mutation_id: string;
  status: 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'ERROR';
  order_id?: string;
  tab_version?: number;
  message?: string;
}

interface SyncV2Response {
  ok: boolean;
  server_time: string;
  acks: SyncV2Ack[];
  conflicts: Array<{
    mutation_id: string;
    order_id?: string;
    reason: string;
  }>;
}

export interface RuntimeSyncConfig {
  tenantSlug: string | null;
  deviceId: string | null;
  deviceSecret: string | null;
}

export interface SyncV2EngineInput {
  userDataPath: string;
  getRuntimeConfig: () => RuntimeSyncConfig;
}

export interface SyncV2EngineResult {
  ok: boolean;
  processed: number;
  acked: number;
  failed: number;
  conflicts: number;
  pending: number;
  forceRefresh: boolean;
  error?: string;
}

export class SyncV2Engine {
  private readonly outboxRepo: OutboxRepo;

  private readonly tabsRepo: TabsRepo;

  private readonly getRuntimeConfig: () => RuntimeSyncConfig;

  constructor(input: SyncV2EngineInput) {
    this.outboxRepo = new OutboxRepo(input.userDataPath);
    this.tabsRepo = new TabsRepo(input.userDataPath);
    this.getRuntimeConfig = input.getRuntimeConfig;
  }

  countPending(): number {
    return this.outboxRepo
      .listPending(5000)
      .filter((row) => row.status === 'PENDING' || row.status === 'FAILED')
      .length;
  }

  async syncPending(limit = 100): Promise<SyncV2EngineResult> {
    const runtime = this.getRuntimeConfig();
    const tenantSlug = String(runtime.tenantSlug || '').trim();
    const deviceId = String(runtime.deviceId || '').trim();
    const deviceSecret = String(runtime.deviceSecret || '').trim();

    if (!tenantSlug || !deviceId || !deviceSecret) {
      return {
        ok: false,
        processed: 0,
        acked: 0,
        failed: 0,
        conflicts: 0,
        pending: this.outboxRepo.listPending(1000).length,
        forceRefresh: false,
        error: 'Configura tenantSlug, deviceId y deviceSecret en Ajustes.',
      };
    }

    const candidates = this.outboxRepo
      .listPending(limit)
      .filter((row) => row.status === 'PENDING' || row.status === 'FAILED');

    if (!candidates.length) {
      return {
        ok: true,
        processed: 0,
        acked: 0,
        failed: 0,
        conflicts: 0,
        pending: 0,
        forceRefresh: false,
      };
    }

    const mutations: Array<Record<string, unknown>> = [];
    const byMutationId = new Map<string, OutboxMutationRecord>();

    for (const row of candidates) {
      try {
        const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
        if (!payload || typeof payload !== 'object') {
          throw new Error('Invalid mutation payload.');
        }
        mutations.push(payload);
        byMutationId.set(row.mutationId, row);
      } catch (error) {
        this.outboxRepo.markFailed(
          row.mutationId,
          error instanceof Error ? error.message : 'Invalid payload.',
        );
      }
    }

    if (!mutations.length) {
      return {
        ok: false,
        processed: candidates.length,
        acked: 0,
        failed: candidates.length,
        conflicts: 0,
        pending: this.outboxRepo.listPending(1000).length,
        forceRefresh: false,
        error: 'No hubo mutaciones validas para enviar.',
      };
    }

    const baseUrl = String(
      process.env.POS_SYNC_API_BASE_URL || process.env.HUB_API_BASE_URL || 'http://localhost:3000',
    ).replace(/\/$/, '');
    const endpoint = `${baseUrl}/api/tenant/${encodeURIComponent(tenantSlug)}/pos/sync/orders`;

    let payload: SyncV2Response | null = null;
    let responseStatus = 0;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId,
            deviceSecret,
            mutations,
          }),
        });

        responseStatus = response.status;
        payload = (await response.json()) as SyncV2Response;

        if (response.status >= 500 && response.status < 600 && attempt < 3) {
          await sleep(backoffMs(attempt));
          continue;
        }

        if (!response.ok && response.status !== 409) {
          const message =
            (payload as { error?: unknown } | null)?.error && typeof (payload as { error?: unknown }).error === 'string'
              ? String((payload as { error?: string }).error)
              : `Sync v2 failed with status ${response.status}`;
          if (response.status >= 400 && response.status < 500) {
            candidates.forEach((row) => this.outboxRepo.markConflict(row.mutationId, message));
            return {
              ok: false,
              processed: candidates.length,
              acked: 0,
              failed: 0,
              conflicts: candidates.length,
              pending: this.outboxRepo.listPending(1000).length,
              forceRefresh: response.status === 409,
              error: message,
            };
          }
          throw new Error(message);
        }
        break;
      } catch (error) {
        if (attempt < 3) {
          await sleep(backoffMs(attempt));
          continue;
        }

        const message = error instanceof Error ? error.message : 'Sync v2 failed.';
        candidates.forEach((row) => this.outboxRepo.markFailed(row.mutationId, message));
        return {
          ok: false,
          processed: candidates.length,
          acked: 0,
          failed: candidates.length,
          conflicts: 0,
          pending: this.outboxRepo.listPending(1000).length,
          forceRefresh: false,
          error: message,
        };
      }
    }

    if (!payload) {
      const message = 'Sync v2 failed without response payload.';
      candidates.forEach((row) => this.outboxRepo.markFailed(row.mutationId, message));
      return {
        ok: false,
        processed: candidates.length,
        acked: 0,
        failed: candidates.length,
        conflicts: 0,
        pending: this.outboxRepo.listPending(1000).length,
        forceRefresh: false,
        error: message,
      };
    }

    let acked = 0;
    let failed = 0;
    let conflicts = 0;
    const seen = new Set<string>();

    for (const ack of payload.acks || []) {
      const mutationId = String(ack.mutation_id || '').trim();
      if (!mutationId || !byMutationId.has(mutationId)) continue;
      seen.add(mutationId);

      if (ack.status === 'APPLIED' || ack.status === 'DUPLICATE') {
        this.outboxRepo.markAcked(mutationId);
        acked += 1;

        if (ack.order_id && Number.isInteger(ack.tab_version) && Number(ack.tab_version) >= 0) {
          this.tabsRepo.markSyncedVersion(ack.order_id, Number(ack.tab_version));
        }
        continue;
      }

      if (ack.status === 'CONFLICT') {
        this.outboxRepo.markConflict(mutationId, ack.message || 'Conflict.');
        conflicts += 1;
        continue;
      }

      this.outboxRepo.markConflict(mutationId, ack.message || 'Mutation failed on server.');
      conflicts += 1;
    }

    byMutationId.forEach((_row, mutationId) => {
      if (seen.has(mutationId)) return;
      this.outboxRepo.markFailed(mutationId, 'Mutation not acknowledged by server.');
      failed += 1;
    });

    const forceRefresh = responseStatus === 409 || conflicts > 0 || (payload.conflicts || []).length > 0;

    return {
      ok: failed === 0 && conflicts === 0,
      processed: mutations.length,
      acked,
      failed,
      conflicts,
      pending: this.outboxRepo.listPending(1000).length,
      forceRefresh,
      error: forceRefresh
        ? 'Se detecto conflicto de version. Refresca la tab antes de continuar.'
        : undefined,
    };
  }
}

function backoffMs(attempt: number): number {
  if (attempt <= 1) return 300;
  if (attempt === 2) return 900;
  return 1800;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
