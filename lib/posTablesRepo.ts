import Database from 'better-sqlite3';
import path from 'node:path';
import { applyOpenTabsLocalMigrations } from './local-db/migrator';

export interface PosTableLocal {
  id: string;
  tenantId: string;
  eventId: string | null;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  deletedAt: string | null;
}

export interface UpsertPosTableInput {
  id: string;
  tenantId: string;
  eventId?: string | null;
  name: string;
  isActive?: boolean;
  sortOrder?: number;
  createdBy?: string | null;
  deletedAt?: string | null;
}

export class PosTablesRepo {
  private db: Database.Database;

  constructor(userDataPath: string) {
    applyOpenTabsLocalMigrations(userDataPath);
    this.db = new Database(path.join(userDataPath, 'pos-kiosk.sqlite3'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  upsert(table: UpsertPosTableInput): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO pos_tables_local (
        id, tenant_id, event_id, name, is_active, sort_order, created_at, updated_at, created_by, deleted_at
      ) VALUES (
        @id, @tenant_id, @event_id, @name, @is_active, @sort_order, @created_at, @updated_at, @created_by, @deleted_at
      )
      ON CONFLICT(id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        event_id = excluded.event_id,
        name = excluded.name,
        is_active = excluded.is_active,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at,
        created_by = excluded.created_by,
        deleted_at = excluded.deleted_at
    `).run({
      id: table.id,
      tenant_id: table.tenantId,
      event_id: table.eventId ?? null,
      name: table.name,
      is_active: table.isActive === false ? 0 : 1,
      sort_order: Number.isInteger(table.sortOrder) ? table.sortOrder : 0,
      created_at: now,
      updated_at: now,
      created_by: table.createdBy ?? null,
      deleted_at: table.deletedAt ?? null,
    });
  }

  upsertMany(tables: UpsertPosTableInput[]): void {
    const tx = this.db.transaction((rows: UpsertPosTableInput[]) => {
      rows.forEach((row) => this.upsert(row));
    });
    tx(tables);
  }

  listActive(tenantId: string, eventId?: string | null): PosTableLocal[] {
    const hasEventFilter = typeof eventId === 'string' && eventId.trim().length > 0;
    const stmt = hasEventFilter
      ? this.db.prepare(`
          SELECT *
          FROM pos_tables_local
          WHERE tenant_id = ?
            AND deleted_at IS NULL
            AND is_active = 1
            AND (event_id = ? OR event_id IS NULL)
          ORDER BY sort_order ASC, name ASC
        `)
      : this.db.prepare(`
          SELECT *
          FROM pos_tables_local
          WHERE tenant_id = ?
            AND deleted_at IS NULL
            AND is_active = 1
          ORDER BY sort_order ASC, name ASC
        `);

    const rows = (hasEventFilter
      ? stmt.all(tenantId, eventId)
      : stmt.all(tenantId)) as Array<Record<string, unknown>>;
    return rows.map(mapPosTableRow);
  }

  listAll(tenantId: string, eventId?: string | null): PosTableLocal[] {
    const hasEventFilter = typeof eventId === 'string' && eventId.trim().length > 0;
    const stmt = hasEventFilter
      ? this.db.prepare(`
          SELECT *
          FROM pos_tables_local
          WHERE tenant_id = ?
            AND deleted_at IS NULL
            AND (event_id = ? OR event_id IS NULL)
          ORDER BY sort_order ASC, name ASC
        `)
      : this.db.prepare(`
          SELECT *
          FROM pos_tables_local
          WHERE tenant_id = ?
            AND deleted_at IS NULL
          ORDER BY sort_order ASC, name ASC
        `);

    const rows = (hasEventFilter
      ? stmt.all(tenantId, eventId)
      : stmt.all(tenantId)) as Array<Record<string, unknown>>;
    return rows.map(mapPosTableRow);
  }

  getById(id: string): PosTableLocal | null {
    const row = this.db
      .prepare('SELECT * FROM pos_tables_local WHERE id = ? LIMIT 1')
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapPosTableRow(row) : null;
  }

  softDelete(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE pos_tables_local
      SET
        is_active = 0,
        deleted_at = COALESCE(deleted_at, @deleted_at),
        updated_at = @updated_at
      WHERE id = @id
    `).run({
      id,
      deleted_at: now,
      updated_at: now,
    });
  }

  updateName(id: string, name: string): void {
    this.db.prepare(`
      UPDATE pos_tables_local
      SET
        name = @name,
        updated_at = @updated_at
      WHERE id = @id
        AND deleted_at IS NULL
    `).run({
      id,
      name,
      updated_at: new Date().toISOString(),
    });
  }

  setActive(id: string, isActive: boolean): void {
    this.db.prepare(`
      UPDATE pos_tables_local
      SET
        is_active = @is_active,
        updated_at = @updated_at
      WHERE id = @id
        AND deleted_at IS NULL
    `).run({
      id,
      is_active: isActive ? 1 : 0,
      updated_at: new Date().toISOString(),
    });
  }

  updateSortOrder(id: string, sortOrder: number): void {
    this.db.prepare(`
      UPDATE pos_tables_local
      SET
        sort_order = @sort_order,
        updated_at = @updated_at
      WHERE id = @id
        AND deleted_at IS NULL
    `).run({
      id,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    });
  }
}

function mapPosTableRow(row: Record<string, unknown>): PosTableLocal {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    eventId: row.event_id ? String(row.event_id) : null,
    name: String(row.name),
    isActive: Number(row.is_active) === 1,
    sortOrder: Number(row.sort_order) || 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    createdBy: row.created_by ? String(row.created_by) : null,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}
