import Database from 'better-sqlite3';
import path from 'node:path';
import { applyOpenTabsLocalMigrations } from './local-db/migrator';

export type TabStatus = 'OPEN' | 'PAID' | 'CANCELED';

export interface TabLocal {
  id: string;
  tenantId: string;
  kioskId: string;
  folioNumber: number;
  folioText: string;
  status: TabStatus;
  isTab: boolean;
  posTableId: string | null;
  openedAt: string | null;
  closedAt: string | null;
  totalCents: number;
  tabVersionLocal: number;
  lastSyncedVersion: number;
  lastMutationId: string | null;
  kitchenLastPrintedVersion: number;
  kitchenLastPrintAt: string | null;
  finalPrintStatus: 'OPEN' | 'SENT' | 'FAILED' | 'UNKNOWN';
  finalPrintAttemptCount: number;
  finalPrintAt: string | null;
  finalPrintError: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateOpenTabInput {
  id: string;
  tenantId: string;
  kioskId: string;
  folioNumber: number;
  folioText: string;
  posTableId?: string | null;
  openedAt?: string | null;
  totalCents?: number;
  lastMutationId?: string | null;
}

export class TabsRepo {
  private db: Database.Database;

  constructor(userDataPath: string) {
    applyOpenTabsLocalMigrations(userDataPath);
    this.db = new Database(path.join(userDataPath, 'pos-kiosk.sqlite3'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  createOpenTab(input: CreateOpenTabInput): void {
    const now = new Date().toISOString();
    const openedAt = input.openedAt ?? now;
    this.db.prepare(`
      INSERT INTO tabs_local (
        id, tenant_id, kiosk_id, folio_number, folio_text, status, is_tab, pos_table_id,
        opened_at, closed_at, total_cents, tab_version_local, last_synced_version,
        last_mutation_id, kitchen_last_printed_version, kitchen_last_print_at,
        final_print_status, final_print_attempt_count, final_print_at, final_print_error,
        created_at, updated_at, deleted_at
      ) VALUES (
        @id, @tenant_id, @kiosk_id, @folio_number, @folio_text, 'OPEN', 1, @pos_table_id,
        @opened_at, NULL, @total_cents, 0, 0,
        @last_mutation_id, 0, NULL,
        'OPEN', 0, NULL, NULL,
        @created_at, @updated_at, NULL
      )
      ON CONFLICT(id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        kiosk_id = excluded.kiosk_id,
        folio_number = excluded.folio_number,
        folio_text = excluded.folio_text,
        status = 'OPEN',
        is_tab = 1,
        pos_table_id = excluded.pos_table_id,
        opened_at = excluded.opened_at,
        total_cents = excluded.total_cents,
        last_mutation_id = excluded.last_mutation_id,
        final_print_status = COALESCE(tabs_local.final_print_status, 'OPEN'),
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `).run({
      id: input.id,
      tenant_id: input.tenantId,
      kiosk_id: input.kioskId,
      folio_number: input.folioNumber,
      folio_text: input.folioText,
      pos_table_id: input.posTableId ?? null,
      opened_at: openedAt,
      total_cents: Number.isFinite(input.totalCents) ? Number(input.totalCents) : 0,
      last_mutation_id: input.lastMutationId ?? null,
      created_at: now,
      updated_at: now,
    });
  }

  getById(tabId: string): TabLocal | null {
    const row = this.db
      .prepare('SELECT * FROM tabs_local WHERE id = ? LIMIT 1')
      .get(tabId) as Record<string, unknown> | undefined;
    return row ? mapTabRow(row) : null;
  }

  listOpenByTenant(tenantId: string): TabLocal[] {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM tabs_local
        WHERE tenant_id = ?
          AND status = 'OPEN'
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
      `)
      .all(tenantId) as Array<Record<string, unknown>>;
    return rows.map(mapTabRow);
  }

  updateStatus(tabId: string, status: TabStatus, closedAt?: string | null): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE tabs_local
      SET
        status = @status,
        closed_at = CASE
          WHEN @status IN ('PAID', 'CANCELED') THEN COALESCE(@closed_at, @now)
          ELSE closed_at
        END,
        updated_at = @now
      WHERE id = @id
    `).run({
      id: tabId,
      status,
      closed_at: closedAt ?? null,
      now,
    });
  }

  bumpTabVersion(tabId: string, mutationId?: string | null): number {
    const current = this.getById(tabId);
    if (!current) throw new Error(`Tab not found: ${tabId}`);
    const next = current.tabVersionLocal + 1;
    this.db.prepare(`
      UPDATE tabs_local
      SET
        tab_version_local = @tab_version_local,
        last_mutation_id = COALESCE(@last_mutation_id, last_mutation_id),
        updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: tabId,
      tab_version_local: next,
      last_mutation_id: mutationId ?? null,
      updated_at: new Date().toISOString(),
    });
    return next;
  }

  markSyncedVersion(tabId: string, syncedVersion: number): void {
    this.db.prepare(`
      UPDATE tabs_local
      SET
        last_synced_version = @last_synced_version,
        updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: tabId,
      last_synced_version: syncedVersion,
      updated_at: new Date().toISOString(),
    });
  }

  updateTotalsAndKitchenState(input: {
    tabId: string;
    totalCents?: number;
    kitchenLastPrintedVersion?: number;
    kitchenLastPrintAt?: string | null;
    mutationId?: string | null;
  }): void {
    this.db.prepare(`
      UPDATE tabs_local
      SET
        total_cents = COALESCE(@total_cents, total_cents),
        kitchen_last_printed_version = COALESCE(@kitchen_last_printed_version, kitchen_last_printed_version),
        kitchen_last_print_at = COALESCE(@kitchen_last_print_at, kitchen_last_print_at),
        last_mutation_id = COALESCE(@last_mutation_id, last_mutation_id),
        updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: input.tabId,
      total_cents: Number.isFinite(input.totalCents) ? Number(input.totalCents) : null,
      kitchen_last_printed_version: Number.isFinite(input.kitchenLastPrintedVersion)
        ? Number(input.kitchenLastPrintedVersion)
        : null,
      kitchen_last_print_at: input.kitchenLastPrintAt ?? null,
      last_mutation_id: input.mutationId ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  updateFinalPrintState(input: {
    tabId: string;
    finalPrintStatus: 'OPEN' | 'SENT' | 'FAILED' | 'UNKNOWN';
    finalPrintAt?: string | null;
    finalPrintError?: string | null;
  }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE tabs_local
      SET
        final_print_status = @final_print_status,
        final_print_attempt_count = COALESCE(final_print_attempt_count, 0) + 1,
        final_print_at = COALESCE(@final_print_at, final_print_at),
        final_print_error = @final_print_error,
        updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: input.tabId,
      final_print_status: input.finalPrintStatus,
      final_print_at: input.finalPrintAt ?? null,
      final_print_error: input.finalPrintError ?? null,
      updated_at: now,
    });
  }
}

function mapTabRow(row: Record<string, unknown>): TabLocal {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    kioskId: String(row.kiosk_id),
    folioNumber: Number(row.folio_number) || 0,
    folioText: String(row.folio_text),
    status: String(row.status) as TabStatus,
    isTab: Number(row.is_tab) === 1,
    posTableId: row.pos_table_id ? String(row.pos_table_id) : null,
    openedAt: row.opened_at ? String(row.opened_at) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    totalCents: Number(row.total_cents) || 0,
    tabVersionLocal: Number(row.tab_version_local) || 0,
    lastSyncedVersion: Number(row.last_synced_version) || 0,
    lastMutationId: row.last_mutation_id ? String(row.last_mutation_id) : null,
    kitchenLastPrintedVersion: Number(row.kitchen_last_printed_version) || 0,
    kitchenLastPrintAt: row.kitchen_last_print_at ? String(row.kitchen_last_print_at) : null,
    finalPrintStatus: (row.final_print_status ? String(row.final_print_status) : 'OPEN') as
      | 'OPEN'
      | 'SENT'
      | 'FAILED'
      | 'UNKNOWN',
    finalPrintAttemptCount: Number(row.final_print_attempt_count) || 0,
    finalPrintAt: row.final_print_at ? String(row.final_print_at) : null,
    finalPrintError: row.final_print_error ? String(row.final_print_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}
