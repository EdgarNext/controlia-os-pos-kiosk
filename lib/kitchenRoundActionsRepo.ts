import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyOpenTabsLocalMigrations } from './local-db/migrator';

export interface KitchenRoundCancellation {
  id: string;
  tenantId: string;
  tabId: string;
  roundMutationId: string;
  reason: string | null;
  printJobId: string | null;
  createdAt: string;
}

export class KitchenRoundActionsRepo {
  private db: Database.Database;

  constructor(userDataPath: string) {
    applyOpenTabsLocalMigrations(userDataPath);
    this.db = new Database(path.join(userDataPath, 'pos-kiosk.sqlite3'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  getCancellation(tenantId: string, tabId: string, roundMutationId: string): KitchenRoundCancellation | null {
    const row = this.db
      .prepare(`
        SELECT *
        FROM kitchen_round_actions_local
        WHERE tenant_id = ? AND tab_id = ? AND round_mutation_id = ? AND action = 'CANCELED'
        LIMIT 1
      `)
      .get(tenantId, tabId, roundMutationId) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  }

  listCancellationsByTab(tenantId: string, tabId: string): KitchenRoundCancellation[] {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM kitchen_round_actions_local
        WHERE tenant_id = ? AND tab_id = ? AND action = 'CANCELED'
        ORDER BY created_at DESC
      `)
      .all(tenantId, tabId) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  }

  recordCancellation(input: {
    tenantId: string;
    tabId: string;
    roundMutationId: string;
    reason?: string | null;
    printJobId?: string | null;
  }): KitchenRoundCancellation {
    const existing = this.getCancellation(input.tenantId, input.tabId, input.roundMutationId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      tenant_id: input.tenantId,
      tab_id: input.tabId,
      round_mutation_id: input.roundMutationId,
      action: 'CANCELED',
      reason: input.reason ?? null,
      print_job_id: input.printJobId ?? null,
      created_at: now,
    };

    this.db.prepare(`
      INSERT INTO kitchen_round_actions_local (
        id, tenant_id, tab_id, round_mutation_id, action, reason, print_job_id, created_at
      ) VALUES (
        @id, @tenant_id, @tab_id, @round_mutation_id, @action, @reason, @print_job_id, @created_at
      )
    `).run(row);

    return mapRow(row);
  }
}

function mapRow(row: Record<string, unknown>): KitchenRoundCancellation {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    tabId: String(row.tab_id),
    roundMutationId: String(row.round_mutation_id),
    reason: row.reason ? String(row.reason) : null,
    printJobId: row.print_job_id ? String(row.print_job_id) : null,
    createdAt: String(row.created_at),
  };
}
