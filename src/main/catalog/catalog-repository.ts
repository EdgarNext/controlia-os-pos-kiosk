import Database from 'better-sqlite3';
import path from 'node:path';
import type {
  AssignBarcodeInput,
  AssignBarcodeResult,
  CatalogCategory,
  CatalogItem,
  CatalogSnapshot,
  PosUserLocal,
} from '../../shared/catalog';

interface CategoryRow {
  id: string;
  name: string;
  sort_order: number;
  image_path: string | null;
}

interface ItemRow {
  id: string;
  name: string;
  type: string;
  price_cents: number;
  category_id: string;
  image_path: string | null;
  barcode: string | null;
}

interface PosUserRow {
  id: string;
  name: string;
  pin_hash: string;
  role: string;
  is_active: number;
  updated_at: string;
}

export class CatalogRepository {
  private db: Database.Database;

  constructor(userDataPath: string) {
    const dbPath = path.join(userDataPath, 'pos-kiosk.sqlite3');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_categories_local (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        image_path TEXT
      );

      CREATE TABLE IF NOT EXISTS catalog_items_local (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        price_cents INTEGER NOT NULL,
        category_id TEXT NOT NULL,
        image_path TEXT,
        FOREIGN KEY(category_id) REFERENCES catalog_categories_local(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_catalog_items_local_category
      ON catalog_items_local(category_id);

      CREATE TABLE IF NOT EXISTS catalog_item_labels_local (
        catalog_item_id TEXT PRIMARY KEY,
        barcode TEXT NOT NULL UNIQUE,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_catalog_item_labels_barcode
      ON catalog_item_labels_local(barcode);

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pos_users_local (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pos_users_local_active
      ON pos_users_local(is_active, role, name);
    `);

    this.ensureColumn('catalog_categories_local', 'image_path', 'TEXT');
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    if (columns.some((row) => row.name === columnName)) return;
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  replaceCatalog(categories: CatalogCategory[], items: CatalogItem[], users: PosUserLocal[], syncedAt: string): void {
    const insertCategory = this.db.prepare(`
      INSERT INTO catalog_categories_local (id, name, sort_order, image_path)
      VALUES (@id, @name, @sort_order, @image_path)
    `);

    const insertItem = this.db.prepare(`
      INSERT INTO catalog_items_local (id, name, type, price_cents, category_id, image_path)
      VALUES (@id, @name, @type, @price_cents, @category_id, @image_path)
    `);

    const upsertSyncState = this.db.prepare(`
      INSERT INTO sync_state (key, value, updated_at)
      VALUES ('catalog_last_sync_at', @value, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    const insertPosUser = this.db.prepare(`
      INSERT INTO pos_users_local (id, name, pin_hash, role, is_active, updated_at)
      VALUES (@id, @name, @pin_hash, @role, @is_active, @updated_at)
    `);

    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM catalog_items_local').run();
      this.db.prepare('DELETE FROM catalog_categories_local').run();
      this.db.prepare('DELETE FROM pos_users_local').run();

      categories.forEach((category) => {
        insertCategory.run({
          id: category.id,
          name: category.name,
          sort_order: category.sortOrder,
          image_path: category.imagePath,
        });
      });

      items.forEach((item) => {
        insertItem.run({
          id: item.id,
          name: item.name,
          type: item.type,
          price_cents: item.priceCents,
          category_id: item.categoryId,
          image_path: item.imagePath,
        });
      });

      users.forEach((user) => {
        insertPosUser.run({
          id: user.id,
          name: user.name,
          pin_hash: user.pinHash,
          role: user.role,
          is_active: user.isActive ? 1 : 0,
          updated_at: user.updatedAt,
        });
      });

      this.db.prepare(`
        DELETE FROM catalog_item_labels_local
        WHERE catalog_item_id NOT IN (SELECT id FROM catalog_items_local)
      `).run();

      upsertSyncState.run({ value: syncedAt, updated_at: new Date().toISOString() });
    });

    transaction();
  }

  getCatalogSnapshot(): CatalogSnapshot {
    const categoriesRows = this.db
      .prepare(
        `
      SELECT id, name, sort_order
      ,image_path
      FROM catalog_categories_local
      ORDER BY sort_order ASC, name ASC
    `,
      )
      .all() as CategoryRow[];

    const itemsRows = this.db
      .prepare(
        `
      SELECT id, name, type, price_cents, category_id, image_path
      ,(
        SELECT barcode
        FROM catalog_item_labels_local labels
        WHERE labels.catalog_item_id = catalog_items_local.id
        LIMIT 1
      ) AS barcode
      FROM catalog_items_local
      ORDER BY name ASC
    `,
      )
      .all() as ItemRow[];

    const syncRow = this.db
      .prepare(
        `
      SELECT value
      FROM sync_state
      WHERE key = 'catalog_last_sync_at'
      LIMIT 1
    `,
      )
      .get() as { value: string } | undefined;

    const usersRows = this.db
      .prepare(
        `
      SELECT id, name, pin_hash, role, is_active, updated_at
      FROM pos_users_local
      WHERE is_active = 1
      ORDER BY name ASC
    `,
      )
      .all() as PosUserRow[];

    return {
      categories: categoriesRows.map((row) => ({
        id: row.id,
        name: row.name,
        sortOrder: row.sort_order,
        imagePath: row.image_path,
      })),
      items: itemsRows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        priceCents: row.price_cents,
        categoryId: row.category_id,
        imagePath: row.image_path,
        barcode: row.barcode || null,
      })),
      users: usersRows.map((row) => ({
        id: row.id,
        name: row.name,
        pinHash: row.pin_hash,
        role: row.role,
        isActive: row.is_active === 1,
        updatedAt: row.updated_at,
      })),
      lastSyncedAt: syncRow?.value || null,
    };
  }

  listActivePosUsers(): Array<{ id: string; name: string; role: string; pinHash: string }> {
    const rows = this.db
      .prepare(
        `
      SELECT id, name, role, pin_hash
      FROM pos_users_local
      WHERE is_active = 1
      ORDER BY name ASC
    `,
      )
      .all() as Array<{ id: string; name: string; role: string; pin_hash: string }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      pinHash: row.pin_hash,
    }));
  }

  assignBarcode(input: AssignBarcodeInput): AssignBarcodeResult {
    const itemId = String(input.itemId || '').trim();
    const barcode = String(input.barcode || '').replace(/[\r\n\t]+/g, '').trim();

    if (!itemId) {
      return { ok: false, itemId: '', error: 'Producto invalido.' };
    }

    if (!barcode) {
      return { ok: false, itemId, error: 'Codigo de barras vacio.' };
    }

    const itemExists = this.db
      .prepare(`SELECT id FROM catalog_items_local WHERE id = ? LIMIT 1`)
      .get(itemId) as { id: string } | undefined;

    if (!itemExists) {
      return { ok: false, itemId, error: 'El producto ya no existe en catalogo local.' };
    }

    const alreadyUsed = this.db
      .prepare(
        `
        SELECT catalog_item_id
        FROM catalog_item_labels_local
        WHERE barcode = ?
        LIMIT 1
      `,
      )
      .get(barcode) as { catalog_item_id: string } | undefined;

    if (alreadyUsed && alreadyUsed.catalog_item_id !== itemId) {
      return {
        ok: false,
        itemId,
        error: 'Este codigo ya esta asignado a otro producto.',
      };
    }

    this.db
      .prepare(
        `
        INSERT INTO catalog_item_labels_local (catalog_item_id, barcode, updated_at)
        VALUES (@catalog_item_id, @barcode, @updated_at)
        ON CONFLICT(catalog_item_id) DO UPDATE SET
          barcode = excluded.barcode,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        catalog_item_id: itemId,
        barcode,
        updated_at: new Date().toISOString(),
      });

    return { ok: true, itemId, barcode };
  }
}
