export interface LocalMigration {
  version: number;
  name: string;
  sql: string;
}

export const OPEN_TABS_LOCAL_MIGRATIONS: LocalMigration[] = [
  {
    version: 20260223170001,
    name: 'open_tabs_local_model',
    sql: `
      CREATE TABLE IF NOT EXISTS pos_tables_local (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        event_id TEXT,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_pos_tables_local_tenant_event_active_sort
      ON pos_tables_local(tenant_id, event_id, is_active, sort_order);

      CREATE INDEX IF NOT EXISTS idx_pos_tables_local_tenant_id
      ON pos_tables_local(tenant_id);

      CREATE TABLE IF NOT EXISTS tabs_local (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        kiosk_id TEXT NOT NULL,
        folio_number INTEGER NOT NULL CHECK(folio_number >= 0),
        folio_text TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('OPEN', 'PAID', 'CANCELED')),
        is_tab INTEGER NOT NULL DEFAULT 1 CHECK(is_tab IN (0, 1)),
        pos_table_id TEXT,
        opened_at TEXT,
        closed_at TEXT,
        total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents >= 0),
        tab_version_local INTEGER NOT NULL DEFAULT 0 CHECK(tab_version_local >= 0),
        last_synced_version INTEGER NOT NULL DEFAULT 0 CHECK(last_synced_version >= 0),
        last_mutation_id TEXT,
        kitchen_last_printed_version INTEGER NOT NULL DEFAULT 0 CHECK(kitchen_last_printed_version >= 0),
        kitchen_last_print_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (pos_table_id) REFERENCES pos_tables_local(id) ON DELETE SET NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_tabs_local_kiosk_folio
      ON tabs_local(kiosk_id, folio_number);

      CREATE INDEX IF NOT EXISTS idx_tabs_local_tenant_status
      ON tabs_local(tenant_id, status, is_tab);

      CREATE INDEX IF NOT EXISTS idx_tabs_local_tenant_table
      ON tabs_local(tenant_id, pos_table_id);

      CREATE TABLE IF NOT EXISTS tab_lines_local (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        tab_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        qty INTEGER NOT NULL CHECK(qty > 0),
        unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
        notes TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (tab_id) REFERENCES tabs_local(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tab_lines_local_tenant_tab
      ON tab_lines_local(tenant_id, tab_id);

      CREATE INDEX IF NOT EXISTS idx_tab_lines_local_tenant_product
      ON tab_lines_local(tenant_id, product_id);

      CREATE INDEX IF NOT EXISTS idx_tab_lines_local_tenant_tab_active
      ON tab_lines_local(tenant_id, tab_id, deleted_at);

      CREATE TABLE IF NOT EXISTS outbox_mutations (
        id TEXT PRIMARY KEY,
        mutation_id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        tab_id TEXT NOT NULL,
        mutation_type TEXT NOT NULL CHECK(
          mutation_type IN (
            'OPEN_TAB',
            'ADD_ITEM',
            'UPDATE_ITEM_QTY',
            'REMOVE_ITEM',
            'KITCHEN_PRINT',
            'CLOSE_TAB_PAID',
            'CANCEL_TAB'
          )
        ),
        base_tab_version INTEGER,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'SENT', 'ACKED', 'FAILED', 'CONFLICT')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT,
        acked_at TEXT,
        FOREIGN KEY (tab_id) REFERENCES tabs_local(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_mutations_status_created
      ON outbox_mutations(status, created_at);

      CREATE INDEX IF NOT EXISTS idx_outbox_mutations_tenant_tab
      ON outbox_mutations(tenant_id, tab_id);
    `,
  },
  {
    version: 20260224191000,
    name: 'open_tabs_uuid_tab_ids_and_payload_repair',
    sql: `
      PRAGMA defer_foreign_keys = ON;

      UPDATE tabs_local
      SET id = substr(id, 5)
      WHERE id LIKE 'tab_%';

      UPDATE tab_lines_local
      SET tab_id = substr(tab_id, 5)
      WHERE tab_id LIKE 'tab_%';

      UPDATE outbox_mutations
      SET
        tab_id = CASE
          WHEN tab_id LIKE 'tab_%' THEN substr(tab_id, 5)
          ELSE tab_id
        END,
        payload_json = replace(
          replace(payload_json, '"order_id":"tab_', '"order_id":"'),
          '"tab_id":"tab_',
          '"tab_id":"'
        ),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE tab_id LIKE 'tab_%'
         OR payload_json LIKE '%"order_id":"tab_%'
         OR payload_json LIKE '%"tab_id":"tab_%';
    `,
  },
  {
    version: 20260224213000,
    name: 'open_tabs_tab_lines_product_name',
    sql: `
      ALTER TABLE tab_lines_local
      ADD COLUMN product_name TEXT;
    `,
  },
  {
    version: 20260224222000,
    name: 'outbox_mutations_unified_sales_and_tabs',
    sql: `
      CREATE TABLE IF NOT EXISTS outbox_mutations_next (
        id TEXT PRIMARY KEY,
        mutation_id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        tab_id TEXT NOT NULL,
        mutation_type TEXT NOT NULL CHECK(
          mutation_type IN (
            'OPEN_TAB',
            'ADD_ITEM',
            'UPDATE_ITEM_QTY',
            'REMOVE_ITEM',
            'KITCHEN_PRINT',
            'CLOSE_TAB_PAID',
            'CANCEL_TAB',
            'SALE_CREATE',
            'SALE_REPRINT',
            'SALE_CANCEL'
          )
        ),
        base_tab_version INTEGER,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'SENT', 'ACKED', 'FAILED', 'CONFLICT')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT,
        acked_at TEXT
      );

      INSERT INTO outbox_mutations_next (
        id, mutation_id, tenant_id, tab_id, mutation_type, base_tab_version, payload_json,
        status, attempts, last_error, created_at, updated_at, sent_at, acked_at
      )
      SELECT
        id, mutation_id, tenant_id, tab_id, mutation_type, base_tab_version, payload_json,
        status, attempts, last_error, created_at, updated_at, sent_at, acked_at
      FROM outbox_mutations;

      DROP TABLE outbox_mutations;
      ALTER TABLE outbox_mutations_next RENAME TO outbox_mutations;

      CREATE INDEX IF NOT EXISTS idx_outbox_mutations_status_created
      ON outbox_mutations(status, created_at);

      CREATE INDEX IF NOT EXISTS idx_outbox_mutations_tenant_tab
      ON outbox_mutations(tenant_id, tab_id);
    `,
  },
  {
    version: 20260224230000,
    name: 'tabs_history_print_and_kitchen_round_actions',
    sql: `
      ALTER TABLE tabs_local
      ADD COLUMN final_print_status TEXT NOT NULL DEFAULT 'OPEN' CHECK(final_print_status IN ('OPEN', 'SENT', 'FAILED', 'UNKNOWN'));

      ALTER TABLE tabs_local
      ADD COLUMN final_print_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(final_print_attempt_count >= 0);

      ALTER TABLE tabs_local
      ADD COLUMN final_print_at TEXT;

      ALTER TABLE tabs_local
      ADD COLUMN final_print_error TEXT;

      CREATE TABLE IF NOT EXISTS kitchen_round_actions_local (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        tab_id TEXT NOT NULL,
        round_mutation_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('CANCELED')),
        reason TEXT,
        print_job_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_kitchen_round_actions_unique
      ON kitchen_round_actions_local(tenant_id, tab_id, round_mutation_id, action);

      CREATE INDEX IF NOT EXISTS idx_kitchen_round_actions_tab
      ON kitchen_round_actions_local(tenant_id, tab_id, created_at DESC);
    `,
  },
];
