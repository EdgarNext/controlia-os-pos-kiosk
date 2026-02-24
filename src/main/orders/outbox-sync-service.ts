import type { OutboxSyncResult } from '../../shared/orders';
import { OrdersRepository } from './orders-repository';

interface OrderUpsertPayload {
  order: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}

interface PendingOutboxRow {
  id: string;
  event_type: string;
  payload_json: string;
  status: 'PENDING' | 'FAILED' | 'SENT';
  attempts: number;
}

interface OrdersSyncResponse {
  ok: boolean;
  acceptedIds?: string[];
  rejected?: Array<{ outboxId: string; reason: string }>;
  error?: string;
}

export class OutboxSyncService {
  constructor(private readonly ordersRepository: OrdersRepository) {}

  async syncPending(limit = 25): Promise<OutboxSyncResult> {
    const runtime = this.ordersRepository.getRuntimeConfig();
    const tenantSlug = runtime.tenantSlug?.trim() || '';
    const deviceId = runtime.deviceId?.trim() || '';
    const deviceSecret = runtime.deviceSecret?.trim() || '';

    if (!tenantSlug || !deviceId || !deviceSecret) {
      return {
        ok: false,
        processed: 0,
        sent: 0,
        failed: 0,
        pending: this.ordersRepository.countPendingOutbox(),
        error: 'Configura tenantSlug, deviceId y deviceSecret en Ajustes.',
      };
    }

    const baseUrl = (process.env.POS_SYNC_API_BASE_URL || process.env.HUB_API_BASE_URL || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    const endpoint = `${baseUrl}/api/tenant/${encodeURIComponent(tenantSlug)}/pos/sync/orders`;

    const rows = this.ordersRepository.listPendingOutbox(limit) as PendingOutboxRow[];
    const batch: Array<{
      outboxId: string;
      order: Record<string, unknown>;
      items: Array<Record<string, unknown>>;
      events: Array<Record<string, unknown>>;
    }> = [];

    for (const row of rows) {
      if (row.event_type !== 'ORDER_UPSERT') {
        this.ordersRepository.markOutboxSent(row.id);
        continue;
      }

      try {
        const payload = JSON.parse(row.payload_json) as OrderUpsertPayload;
        if (!payload?.order) {
          throw new Error('Invalid outbox payload');
        }
        batch.push({
          outboxId: row.id,
          order: payload.order,
          items: Array.isArray(payload.items) ? payload.items : [],
          events: Array.isArray(payload.events) ? payload.events : [],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid payload';
        this.ordersRepository.markOutboxFailed(row.id, message);
      }
    }

    if (!batch.length) {
      return {
        ok: true,
        processed: rows.length,
        sent: 0,
        failed: 0,
        pending: this.ordersRepository.countPendingOutbox(),
      };
    }

    let acceptedIds: string[] = [];
    const rejectedMap = new Map<string, string>();

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          deviceSecret,
          batch,
        }),
      });

      const payload = (await response.json()) as OrdersSyncResponse;
      if (!response.ok && response.status !== 207) {
        throw new Error(payload?.error || `Orders sync failed with status ${response.status}`);
      }

      acceptedIds = Array.isArray(payload.acceptedIds) ? payload.acceptedIds : [];
      (payload.rejected || []).forEach((entry) => {
        if (entry?.outboxId) {
          rejectedMap.set(entry.outboxId, entry.reason || 'Rejected by server');
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Orders sync failed';
      batch.forEach((entry) => {
        this.ordersRepository.markOutboxFailed(entry.outboxId, message);
      });
      return {
        ok: false,
        processed: batch.length,
        sent: 0,
        failed: batch.length,
        pending: this.ordersRepository.countPendingOutbox(),
        error: message,
      };
    }

    let sent = 0;
    let failed = 0;
    const byOutboxId = new Map(batch.map((entry) => [entry.outboxId, entry]));

    acceptedIds.forEach((outboxId) => {
      const entry = byOutboxId.get(outboxId);
      if (!entry) return;
      this.ordersRepository.markOutboxSent(outboxId);
      const orderId = typeof entry.order?.id === 'string' ? entry.order.id : null;
      if (orderId) {
        this.ordersRepository.markOrderSynced(orderId);
      }
      sent += 1;
    });

    rejectedMap.forEach((reason, outboxId) => {
      this.ordersRepository.markOutboxFailed(outboxId, reason);
      failed += 1;
    });

    batch.forEach((entry) => {
      if (!acceptedIds.includes(entry.outboxId) && !rejectedMap.has(entry.outboxId)) {
        this.ordersRepository.markOutboxFailed(entry.outboxId, 'Outbox entry not acknowledged by server.');
        failed += 1;
      }
    });

    return {
      ok: failed === 0,
      processed: batch.length,
      sent,
      failed,
      pending: this.ordersRepository.countPendingOutbox(),
    };
  }
}
