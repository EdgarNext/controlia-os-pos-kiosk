import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyOpenTabsLocalMigrations } from './local-db/migrator';

export type OutboxMutationType =
  | 'OPEN_TAB'
  | 'ADD_ITEM'
  | 'UPDATE_ITEM_QTY'
  | 'REMOVE_ITEM'
  | 'KITCHEN_PRINT'
  | 'CLOSE_TAB_PAID'
  | 'CANCEL_TAB'
  | 'SALE_CREATE'
  | 'SALE_REPRINT'
  | 'SALE_CANCEL';

export type OutboxStatus = 'PENDING' | 'SENT' | 'ACKED' | 'FAILED' | 'CONFLICT';

export interface OutboxMutationRecord {
  id: string;
  mutationId: string;
  tenantId: string;
  tabId: string;
  mutationType: OutboxMutationType;
  baseTabVersion: number | null;
  payloadJson: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  ackedAt: string | null;
}

export interface EnqueueOutboxMutationInput {
  mutationId?: string;
  tenantId: string;
  tabId: string;
  mutationType: OutboxMutationType;
  baseTabVersion?: number | null;
  payload: Record<string, unknown>;
}

export class OutboxRepo {
  private db: Database.Database;

  constructor(userDataPath: string) {
    applyOpenTabsLocalMigrations(userDataPath);
    this.db = new Database(path.join(userDataPath, 'pos-kiosk.sqlite3'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  enqueue(input: EnqueueOutboxMutationInput): { id: string; mutationId: string } {
    const now = new Date().toISOString();
    const id = randomUUID();
    const mutationId = (input.mutationId || '').trim() || randomUUID();
    this.db.prepare(`
      INSERT INTO outbox_mutations (
        id, mutation_id, tenant_id, tab_id, mutation_type, base_tab_version, payload_json,
        status, attempts, last_error, created_at, updated_at, sent_at, acked_at
      ) VALUES (
        @id, @mutation_id, @tenant_id, @tab_id, @mutation_type, @base_tab_version, @payload_json,
        'PENDING', 0, NULL, @created_at, @updated_at, NULL, NULL
      )
    `).run({
      id,
      mutation_id: mutationId,
      tenant_id: input.tenantId,
      tab_id: input.tabId,
      mutation_type: input.mutationType,
      base_tab_version: Number.isFinite(input.baseTabVersion) ? Number(input.baseTabVersion) : null,
      payload_json: JSON.stringify(input.payload || {}),
      created_at: now,
      updated_at: now,
    });
    return { id, mutationId };
  }

  listPending(limit = 100): OutboxMutationRecord[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 500)) : 100;
    const rows = this.db.prepare(`
      SELECT *
      FROM outbox_mutations
      WHERE status IN ('PENDING', 'FAILED', 'CONFLICT')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(safeLimit) as Array<Record<string, unknown>>;
    return rows.map(mapOutboxRow);
  }

  listByTabAndType(tenantId: string, tabId: string, mutationType: OutboxMutationType, limit = 50): OutboxMutationRecord[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 50;
    const rows = this.db
      .prepare(`
        SELECT *
        FROM outbox_mutations
        WHERE tenant_id = ?
          AND tab_id = ?
          AND mutation_type = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(tenantId, tabId, mutationType, safeLimit) as Array<Record<string, unknown>>;
    return rows.map(mapOutboxRow);
  }

  getByMutationId(mutationId: string): OutboxMutationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM outbox_mutations WHERE mutation_id = ? LIMIT 1')
      .get(mutationId) as Record<string, unknown> | undefined;
    return row ? mapOutboxRow(row) : null;
  }

  markSent(mutationId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE outbox_mutations
      SET
        status = 'SENT',
        attempts = attempts + 1,
        sent_at = @sent_at,
        updated_at = @updated_at,
        last_error = NULL
      WHERE mutation_id = @mutation_id
    `).run({
      mutation_id: mutationId,
      sent_at: now,
      updated_at: now,
    });
  }

  markAcked(mutationId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE outbox_mutations
      SET
        status = 'ACKED',
        acked_at = @acked_at,
        updated_at = @updated_at,
        last_error = NULL
      WHERE mutation_id = @mutation_id
    `).run({
      mutation_id: mutationId,
      acked_at: now,
      updated_at: now,
    });
  }

  markFailed(mutationId: string, errorMessage: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE outbox_mutations
      SET
        status = 'FAILED',
        attempts = attempts + 1,
        last_error = @last_error,
        updated_at = @updated_at
      WHERE mutation_id = @mutation_id
    `).run({
      mutation_id: mutationId,
      last_error: errorMessage,
      updated_at: now,
    });
  }

  markConflict(mutationId: string, reason: string): void {
    this.db.prepare(`
      UPDATE outbox_mutations
      SET
        status = 'CONFLICT',
        last_error = @last_error,
        updated_at = @updated_at
      WHERE mutation_id = @mutation_id
    `).run({
      mutation_id: mutationId,
      last_error: reason,
      updated_at: new Date().toISOString(),
    });
  }
}

function mapOutboxRow(row: Record<string, unknown>): OutboxMutationRecord {
  return {
    id: String(row.id),
    mutationId: String(row.mutation_id),
    tenantId: String(row.tenant_id),
    tabId: String(row.tab_id),
    mutationType: String(row.mutation_type) as OutboxMutationType,
    baseTabVersion: row.base_tab_version == null ? null : Number(row.base_tab_version),
    payloadJson: String(row.payload_json),
    status: String(row.status) as OutboxStatus,
    attempts: Number(row.attempts) || 0,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    sentAt: row.sent_at ? String(row.sent_at) : null,
    ackedAt: row.acked_at ? String(row.acked_at) : null,
  };
}
