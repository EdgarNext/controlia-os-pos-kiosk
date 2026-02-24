import Database from 'better-sqlite3';
import path from 'node:path';
import { applyOpenTabsLocalMigrations } from './local-db/migrator';

export interface TabLineLocal {
  id: string;
  tenantId: string;
  tabId: string;
  productId: string;
  productName: string | null;
  qty: number;
  unitPriceCents: number;
  notes: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertTabLineInput {
  id: string;
  tenantId: string;
  tabId: string;
  productId: string;
  productName?: string | null;
  qty: number;
  unitPriceCents: number;
  notes?: string | null;
}

export class TabLinesRepo {
  private db: Database.Database;

  constructor(userDataPath: string) {
    applyOpenTabsLocalMigrations(userDataPath);
    this.db = new Database(path.join(userDataPath, 'pos-kiosk.sqlite3'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  upsert(line: UpsertTabLineInput): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO tab_lines_local (
        id, tenant_id, tab_id, product_id, product_name, qty, unit_price_cents, notes, deleted_at, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @tab_id, @product_id, @product_name, @qty, @unit_price_cents, @notes, NULL, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        tab_id = excluded.tab_id,
        product_id = excluded.product_id,
        product_name = COALESCE(excluded.product_name, tab_lines_local.product_name),
        qty = excluded.qty,
        unit_price_cents = excluded.unit_price_cents,
        notes = excluded.notes,
        deleted_at = NULL,
        updated_at = excluded.updated_at
    `).run({
      id: line.id,
      tenant_id: line.tenantId,
      tab_id: line.tabId,
      product_id: line.productId,
      product_name: line.productName ?? null,
      qty: line.qty,
      unit_price_cents: line.unitPriceCents,
      notes: line.notes ?? null,
      created_at: now,
      updated_at: now,
    });
  }

  listByTab(tenantId: string, tabId: string, includeDeleted = false): TabLineLocal[] {
    const stmt = includeDeleted
      ? this.db.prepare(`
          SELECT *
          FROM tab_lines_local
          WHERE tenant_id = ? AND tab_id = ?
          ORDER BY created_at ASC
        `)
      : this.db.prepare(`
          SELECT *
          FROM tab_lines_local
          WHERE tenant_id = ? AND tab_id = ? AND deleted_at IS NULL
          ORDER BY created_at ASC
        `);

    const rows = stmt.all(tenantId, tabId) as Array<Record<string, unknown>>;
    return rows.map(mapLineRow);
  }

  getById(lineId: string): TabLineLocal | null {
    const row = this.db
      .prepare('SELECT * FROM tab_lines_local WHERE id = ? LIMIT 1')
      .get(lineId) as Record<string, unknown> | undefined;
    return row ? mapLineRow(row) : null;
  }

  updateQty(lineId: string, qty: number, notes?: string | null): void {
    this.db.prepare(`
      UPDATE tab_lines_local
      SET
        qty = @qty,
        notes = COALESCE(@notes, notes),
        updated_at = @updated_at
      WHERE id = @id AND deleted_at IS NULL
    `).run({
      id: lineId,
      qty,
      notes: notes ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  softDelete(lineId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE tab_lines_local
      SET
        deleted_at = COALESCE(deleted_at, @deleted_at),
        updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: lineId,
      deleted_at: now,
      updated_at: now,
    });
  }

  hardDeleteByTab(tabId: string): void {
    this.db.prepare('DELETE FROM tab_lines_local WHERE tab_id = ?').run(tabId);
  }
}

function mapLineRow(row: Record<string, unknown>): TabLineLocal {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    tabId: String(row.tab_id),
    productId: String(row.product_id),
    productName: row.product_name ? String(row.product_name) : null,
    qty: Number(row.qty) || 0,
    unitPriceCents: Number(row.unit_price_cents) || 0,
    notes: row.notes ? String(row.notes) : null,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
