import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OrderHistoryRecord, RuntimeConfig, SaleLineInput } from '../../shared/orders';

type OutboxStatus = 'PENDING' | 'SENT' | 'FAILED';

interface OutboxRow {
  id: string;
  event_type: string;
  payload_json: string;
  status: OutboxStatus;
  attempts: number;
}

interface OrderRow {
  id: string;
  created_at: string;
  tenant_id: string | null;
  kiosk_id: string | null;
  kiosk_number: number | null;
  folio_number: number;
  folio_text: string;
  status: 'PAID' | 'CANCELED';
  total_cents: number;
  pago_recibido_cents: number;
  cambio_cents: number;
  metodo_pago: string;
  print_status: 'SENT' | 'FAILED';
  print_job_id: string | null;
  last_error: string | null;
  synced_at: string | null;
  print_attempt_count: number;
  last_print_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  tenant_id: string | null;
  catalog_item_id: string;
  name: string;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
}

interface OutboxEventInput {
  id: string;
  type: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface OrderReceiptData {
  id: string;
  tenantId: string | null;
  kioskId: string | null;
  folioText: string;
  createdAt: string;
  status: 'PAID' | 'CANCELED';
  totalCents: number;
  pagoRecibidoCents: number;
  cambioCents: number;
  metodoPago: string;
  lines: SaleLineInput[];
}

export class OrdersRepository {
  private db: Database.Database;

  constructor(userDataPath: string) {
    const dbPath = path.join(userDataPath, 'pos-kiosk.sqlite3');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders_local (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        tenant_id TEXT,
        kiosk_id TEXT,
        kiosk_number INTEGER,
        folio_number INTEGER NOT NULL,
        folio_text TEXT NOT NULL,
        status TEXT NOT NULL,
        total_cents INTEGER NOT NULL,
        pago_recibido_cents INTEGER NOT NULL,
        cambio_cents INTEGER NOT NULL,
        metodo_pago TEXT NOT NULL,
        print_status TEXT NOT NULL,
        print_job_id TEXT,
        last_error TEXT,
        synced_at TEXT,
        print_attempt_count INTEGER NOT NULL DEFAULT 0,
        last_print_at TEXT,
        canceled_at TEXT,
        cancel_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS order_items_local (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        tenant_id TEXT,
        catalog_item_id TEXT NOT NULL,
        name TEXT NOT NULL,
        qty INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        line_total_cents INTEGER NOT NULL,
        FOREIGN KEY(order_id) REFERENCES orders_local(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS order_events_local (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        tenant_id TEXT,
        type TEXT NOT NULL,
        meta_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(order_id) REFERENCES orders_local(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'SENT', 'FAILED')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_outbox_status
      ON sync_outbox(status, created_at);

      CREATE TABLE IF NOT EXISTS folio_counter_local (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_runtime_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.ensureColumn('orders_local', 'print_attempt_count', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('orders_local', 'last_print_at', 'TEXT');
    this.ensureColumn('orders_local', 'canceled_at', 'TEXT');
    this.ensureColumn('orders_local', 'cancel_reason', 'TEXT');
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    if (columns.some((row) => row.name === columnName)) return;
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  getRuntimeConfig(): RuntimeConfig {
    const rows = this.db
      .prepare(
        `SELECT key, value FROM app_runtime_config WHERE key IN ('tenant_id','kiosk_id','kiosk_number','tenant_slug','device_id','device_secret')`,
      )
      .all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((row) => [row.key, row.value]));
    const kioskNumberRaw = map.get('kiosk_number') || '';
    const kioskNumberParsed = Number.parseInt(kioskNumberRaw, 10);

    return {
      tenantId: map.get('tenant_id') || null,
      kioskId: map.get('kiosk_id') || null,
      kioskNumber: Number.isFinite(kioskNumberParsed) ? kioskNumberParsed : null,
      tenantSlug: map.get('tenant_slug') || null,
      deviceId: map.get('device_id') || null,
      deviceSecret: map.get('device_secret') || null,
    };
  }

  setRuntimeConfig(input: Partial<RuntimeConfig>): RuntimeConfig {
    const current = this.getRuntimeConfig();
    const next: RuntimeConfig = {
      tenantId:
        typeof input.tenantId === 'string' && input.tenantId.trim()
          ? input.tenantId.trim()
          : current.tenantId,
      kioskId:
        typeof input.kioskId === 'string' && input.kioskId.trim()
          ? input.kioskId.trim()
          : current.kioskId,
      kioskNumber: Number.isFinite(input.kioskNumber) ? Number(input.kioskNumber) : current.kioskNumber,
      tenantSlug:
        typeof input.tenantSlug === 'string' && input.tenantSlug.trim()
          ? input.tenantSlug.trim()
          : current.tenantSlug,
      deviceId: typeof input.deviceId === 'string' && input.deviceId.trim() ? input.deviceId.trim() : current.deviceId,
      deviceSecret:
        typeof input.deviceSecret === 'string' && input.deviceSecret.trim()
          ? input.deviceSecret.trim()
          : current.deviceSecret,
    };

    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO app_runtime_config(key, value, updated_at)
      VALUES (@key, @value, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    const tx = this.db.transaction(() => {
      if (next.tenantId) {
        upsert.run({ key: 'tenant_id', value: next.tenantId, updated_at: now });
      }
      if (next.kioskId) {
        upsert.run({ key: 'kiosk_id', value: next.kioskId, updated_at: now });
      }
      if (Number.isFinite(next.kioskNumber)) {
        upsert.run({ key: 'kiosk_number', value: String(next.kioskNumber), updated_at: now });
      }
      if (next.tenantSlug) {
        upsert.run({ key: 'tenant_slug', value: next.tenantSlug, updated_at: now });
      }
      if (next.deviceId) {
        upsert.run({ key: 'device_id', value: next.deviceId, updated_at: now });
      }
      if (next.deviceSecret) {
        upsert.run({ key: 'device_secret', value: next.deviceSecret, updated_at: now });
      }
    });

    tx();
    return next;
  }

  nextFolioForKiosk(kioskNumber: number): { folioNumber: number; folioText: string } {
    const safeKioskNumber = Number.isInteger(kioskNumber) && kioskNumber > 0 ? kioskNumber : 1;
    const folioNumber = this.nextFolioNumber();
    return {
      folioNumber,
      folioText: `K${safeKioskNumber}-${String(folioNumber).padStart(6, '0')}`,
    };
  }

  createOrderAndOutbox(input: {
    lines: SaleLineInput[];
    totalCents: number;
    pagoRecibidoCents: number;
    cambioCents: number;
    metodoPago: string;
    printStatus: 'SENT' | 'FAILED';
    printJobId: string | null;
    printError: string | null;
  }): { orderId: string; folioText: string; folioNumber: number } {
    const runtime = this.getRuntimeConfig();
    const orderId = randomUUID();
    const now = new Date().toISOString();

    const folioNumber = this.nextFolioNumber();
    const kioskNumber = runtime.kioskNumber || 1;
    const folioText = `K${kioskNumber}-${String(folioNumber).padStart(6, '0')}`;

    const insertOrder = this.db.prepare(`
      INSERT INTO orders_local (
        id, created_at, tenant_id, kiosk_id, kiosk_number, folio_number, folio_text,
        status, total_cents, pago_recibido_cents, cambio_cents, metodo_pago,
        print_status, print_job_id, last_error, synced_at,
        print_attempt_count, last_print_at, canceled_at, cancel_reason
      ) VALUES (
        @id, @created_at, @tenant_id, @kiosk_id, @kiosk_number, @folio_number, @folio_text,
        'PAID', @total_cents, @pago_recibido_cents, @cambio_cents, @metodo_pago,
        @print_status, @print_job_id, @last_error, NULL,
        1, @last_print_at, NULL, NULL
      )
    `);

    const insertItem = this.db.prepare(`
      INSERT INTO order_items_local (
        id, order_id, tenant_id, catalog_item_id, name, qty, unit_price_cents, line_total_cents
      ) VALUES (
        @id, @order_id, @tenant_id, @catalog_item_id, @name, @qty, @unit_price_cents, @line_total_cents
      )
    `);

    const tx = this.db.transaction(() => {
      insertOrder.run({
        id: orderId,
        created_at: now,
        tenant_id: runtime.tenantId,
        kiosk_id: runtime.kioskId,
        kiosk_number: runtime.kioskNumber,
        folio_number: folioNumber,
        folio_text: folioText,
        total_cents: input.totalCents,
        pago_recibido_cents: input.pagoRecibidoCents,
        cambio_cents: input.cambioCents,
        metodo_pago: input.metodoPago,
        print_status: input.printStatus,
        print_job_id: input.printJobId,
        last_error: input.printError,
        last_print_at: now,
      });

      const itemRows = input.lines.map((line) => ({
        id: randomUUID(),
        order_id: orderId,
        tenant_id: runtime.tenantId,
        catalog_item_id: line.catalogItemId,
        name: line.name,
        qty: line.qty,
        unit_price_cents: line.unitPriceCents,
        line_total_cents: line.unitPriceCents * line.qty,
      }));

      itemRows.forEach((row) => insertItem.run(row));

      const paymentEvent: OutboxEventInput = {
        id: randomUUID(),
        type: 'PAYMENT_CAPTURED',
        meta: {
          total_cents: input.totalCents,
          pago_recibido_cents: input.pagoRecibidoCents,
          cambio_cents: input.cambioCents,
          metodo_pago: input.metodoPago,
        },
        createdAt: now,
      };

      const printEvent: OutboxEventInput = {
        id: randomUUID(),
        type: input.printStatus === 'SENT' ? 'PRINTED' : 'PRINT_ERROR',
        meta:
          input.printStatus === 'SENT'
            ? { print_job_id: input.printJobId }
            : { error: input.printError || 'Print error', print_job_id: input.printJobId },
        createdAt: now,
      };

      this.insertOrderEvent(orderId, runtime.tenantId, paymentEvent);
      this.insertOrderEvent(orderId, runtime.tenantId, printEvent);
      this.enqueueSaleCreateMutation(orderId, now);
    });

    tx();
    return { orderId, folioText, folioNumber };
  }

  listTodayOrders(limit = 50): OrderHistoryRecord[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          created_at,
          folio_text,
          total_cents,
          status,
          print_status,
          canceled_at,
          cancel_reason,
          print_attempt_count,
          last_print_at,
          last_error
        FROM orders_local
        WHERE date(created_at, 'localtime') = date('now', 'localtime')
        ORDER BY created_at DESC
        LIMIT ?
      `,
      )
      .all(safeLimit) as Array<{
      id: string;
      created_at: string;
      folio_text: string;
      total_cents: number;
      status: 'PAID' | 'CANCELED';
      print_status: 'SENT' | 'FAILED';
      canceled_at: string | null;
      cancel_reason: string | null;
      print_attempt_count: number;
      last_print_at: string | null;
      last_error: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      folioText: row.folio_text,
      totalCents: row.total_cents,
      status: row.status,
      printStatus: row.print_status,
      source: 'sale',
      canceledAt: row.canceled_at,
      cancelReason: row.cancel_reason,
      printAttempts: row.print_attempt_count || 0,
      lastPrintAt: row.last_print_at,
      lastError: row.last_error,
    }));
  }

  listTodayClosedTabs(limit = 50): OrderHistoryRecord[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          COALESCE(closed_at, opened_at, updated_at, created_at) AS history_at,
          folio_text,
          total_cents,
          status,
          closed_at,
          NULL AS cancel_reason,
          COALESCE(final_print_status, 'OPEN') AS final_print_status,
          COALESCE(final_print_attempt_count, 0) AS final_print_attempt_count,
          final_print_at,
          final_print_error
        FROM tabs_local
        WHERE date(COALESCE(closed_at, opened_at, updated_at, created_at), 'localtime') = date('now', 'localtime')
        ORDER BY history_at DESC
        LIMIT ?
      `,
      )
      .all(safeLimit) as Array<{
      id: string;
      history_at: string;
      folio_text: string;
      total_cents: number;
      status: 'OPEN' | 'PAID' | 'CANCELED';
      closed_at: string | null;
      cancel_reason: string | null;
      final_print_status: 'OPEN' | 'SENT' | 'FAILED' | 'UNKNOWN';
      final_print_attempt_count: number;
      final_print_at: string | null;
      final_print_error: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.history_at,
      folioText: row.folio_text,
      totalCents: row.total_cents,
      status: row.status,
      printStatus: row.status === 'OPEN' ? 'OPEN' : row.final_print_status || 'UNKNOWN',
      source: 'tab',
      canceledAt: row.status === 'CANCELED' ? row.closed_at : null,
      cancelReason: row.cancel_reason,
      printAttempts: Number(row.final_print_attempt_count) || 0,
      lastPrintAt: row.final_print_at,
      lastError: row.final_print_error,
    }));
  }

  getOrderForReprint(orderId: string): OrderReceiptData | null {
    const order = this.getOrderRow(orderId);
    if (!order) return null;

    const lines = this.getOrderItems(orderId).map((line) => ({
      catalogItemId: line.catalog_item_id,
      name: line.name,
      qty: line.qty,
      unitPriceCents: line.unit_price_cents,
    }));

    return {
      id: order.id,
      tenantId: order.tenant_id,
      kioskId: order.kiosk_id,
      folioText: order.folio_text,
      createdAt: order.created_at,
      status: order.status,
      totalCents: order.total_cents,
      pagoRecibidoCents: order.pago_recibido_cents,
      cambioCents: order.cambio_cents,
      metodoPago: order.metodo_pago,
      lines,
    };
  }

  recordReprintAttemptAndOutbox(input: {
    orderId: string;
    printStatus: 'SENT' | 'FAILED';
    printJobId: string | null;
    printError: string | null;
  }): { ok: boolean; error?: string; jobId: string | null } {
    const orderId = String(input.orderId || '').trim();
    if (!orderId) return { ok: false, error: 'Order id invalido.', jobId: null };

    const existing = this.getOrderRow(orderId);
    if (!existing) return { ok: false, error: 'La orden no existe.', jobId: null };
    if (existing.status === 'CANCELED') {
      return { ok: false, error: 'No se puede reimprimir una orden cancelada.', jobId: null };
    }

    const now = new Date().toISOString();
    const event: OutboxEventInput = {
      id: randomUUID(),
      type: input.printStatus === 'SENT' ? 'REPRINTED' : 'REPRINT_ERROR',
      meta:
        input.printStatus === 'SENT'
          ? { print_job_id: input.printJobId }
          : { error: input.printError || 'Print error', print_job_id: input.printJobId },
      createdAt: now,
    };

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `
          UPDATE orders_local
          SET
            print_status = @print_status,
            print_job_id = @print_job_id,
            last_error = @last_error,
            print_attempt_count = COALESCE(print_attempt_count, 0) + 1,
            last_print_at = @last_print_at,
            synced_at = NULL
          WHERE id = @id
        `,
        )
        .run({
          id: orderId,
          print_status: input.printStatus,
          print_job_id: input.printJobId,
          last_error: input.printError,
          last_print_at: now,
        });

      this.insertOrderEvent(orderId, existing.tenant_id, event);
      this.enqueueSaleReprintMutation(orderId, now);
    });

    tx();
    return { ok: true, jobId: input.printJobId };
  }

  cancelOrderAndOutbox(orderIdRaw: string): { ok: boolean; canceledAt?: string; error?: string } {
    const orderId = String(orderIdRaw || '').trim();
    if (!orderId) return { ok: false, error: 'Order id invalido.' };

    const existing = this.getOrderRow(orderId);
    if (!existing) return { ok: false, error: 'La orden no existe.' };
    if (existing.status === 'CANCELED') {
      return { ok: false, error: 'La orden ya esta cancelada.' };
    }

    const canceledAt = new Date().toISOString();
    const event: OutboxEventInput = {
      id: randomUUID(),
      type: 'CANCELED',
      meta: {
        canceled_at: canceledAt,
        reason: 'canceled_by_cashier',
      },
      createdAt: canceledAt,
    };

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `
          UPDATE orders_local
          SET
            status = 'CANCELED',
            canceled_at = @canceled_at,
            cancel_reason = @cancel_reason,
            synced_at = NULL
          WHERE id = @id
        `,
        )
        .run({
          id: orderId,
          canceled_at: canceledAt,
          cancel_reason: 'canceled_by_cashier',
        });

      this.insertOrderEvent(orderId, existing.tenant_id, event);
      this.enqueueSaleCancelMutation(orderId, canceledAt);
    });

    tx();
    return { ok: true, canceledAt };
  }

  private getOrderRow(orderId: string): OrderRow | null {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          created_at,
          tenant_id,
          kiosk_id,
          kiosk_number,
          folio_number,
          folio_text,
          status,
          total_cents,
          pago_recibido_cents,
          cambio_cents,
          metodo_pago,
          print_status,
          print_job_id,
          last_error,
          synced_at,
          COALESCE(print_attempt_count, 0) AS print_attempt_count,
          last_print_at,
          canceled_at,
          cancel_reason
        FROM orders_local
        WHERE id = ?
        LIMIT 1
      `,
      )
      .get(orderId) as OrderRow | undefined;

    return row || null;
  }

  private getOrderItems(orderId: string): OrderItemRow[] {
    return this.db
      .prepare(
        `
        SELECT
          id,
          order_id,
          tenant_id,
          catalog_item_id,
          name,
          qty,
          unit_price_cents,
          line_total_cents
        FROM order_items_local
        WHERE order_id = ?
        ORDER BY name ASC
      `,
      )
      .all(orderId) as OrderItemRow[];
  }

  private insertOrderEvent(orderId: string, tenantId: string | null, event: OutboxEventInput): void {
    this.db
      .prepare(
        `
        INSERT INTO order_events_local (id, order_id, tenant_id, type, meta_json, created_at)
        VALUES (@id, @order_id, @tenant_id, @type, @meta_json, @created_at)
      `,
      )
      .run({
        id: event.id,
        order_id: orderId,
        tenant_id: tenantId,
        type: event.type,
        meta_json: JSON.stringify(event.meta || {}),
        created_at: event.createdAt,
      });
  }

  private enqueueOrderUpsert(orderId: string, events: OutboxEventInput[], now: string): void {
    const order = this.getOrderRow(orderId);
    if (!order) {
      throw new Error('Order not found while enqueueing outbox');
    }

    const items = this.getOrderItems(orderId);

    const payload = {
      order: {
        id: order.id,
        tenant_id: order.tenant_id,
        kiosk_id: order.kiosk_id,
        kiosk_number: order.kiosk_number,
        folio_number: order.folio_number,
        folio_text: order.folio_text,
        status: order.status,
        total_cents: order.total_cents,
        pago_recibido_cents: order.pago_recibido_cents,
        cambio_cents: order.cambio_cents,
        metodo_pago: order.metodo_pago,
        print_status: order.print_status,
        print_attempt_count: order.print_attempt_count,
        last_print_error: order.last_error,
        last_print_at: order.last_print_at,
        canceled_at: order.canceled_at,
        cancel_reason: order.cancel_reason,
      },
      items: items.map((row) => ({
        id: row.id,
        tenant_id: row.tenant_id,
        order_id: row.order_id,
        catalog_item_id: row.catalog_item_id,
        name: row.name,
        qty: row.qty,
        unit_price_cents: row.unit_price_cents,
        line_total_cents: row.line_total_cents,
        variants: null,
      })),
      events: events.map((event) => ({
        id: event.id,
        tenant_id: order.tenant_id,
        order_id: order.id,
        type: event.type,
        meta: event.meta,
        created_at: event.createdAt,
      })),
    };

    this.db
      .prepare(
        `
        INSERT INTO sync_outbox (
          id, aggregate_type, aggregate_id, event_type, payload_json, status, attempts,
          last_error, created_at, updated_at
        ) VALUES (
          @id, 'order', @aggregate_id, 'ORDER_UPSERT', @payload_json, 'PENDING', 0,
          NULL, @created_at, @updated_at
        )
      `,
      )
      .run({
        id: randomUUID(),
        aggregate_id: order.id,
        payload_json: JSON.stringify(payload),
        created_at: now,
        updated_at: now,
      });
  }

  private enqueueSaleCreateMutation(orderId: string, now: string): void {
    const order = this.getOrderRow(orderId);
    if (!order) throw new Error('Order not found while enqueueing sale create mutation.');
    const items = this.getOrderItems(orderId);

    const payload = {
      mutation_id: randomUUID(),
      type: 'SALE_CREATE',
      order_id: order.id,
      kiosk_id: order.kiosk_id,
      folio_number: order.folio_number,
      folio_text: order.folio_text,
      total_cents: order.total_cents,
      pago_recibido_cents: order.pago_recibido_cents,
      cambio_cents: order.cambio_cents,
      metodo_pago: order.metodo_pago,
      print_status: order.print_status,
      print_attempt_count: order.print_attempt_count,
      last_print_error: order.last_error,
      last_print_at: order.last_print_at,
      created_at: order.created_at,
      lines: items.map((row) => ({
        id: row.id,
        catalog_item_id: row.catalog_item_id,
        name: row.name,
        qty: row.qty,
        unit_price_cents: row.unit_price_cents,
        line_total_cents: row.line_total_cents,
      })),
      meta: {
        source: 'quick_sale',
      },
    };

    this.enqueueUnifiedMutation({
      mutationId: payload.mutation_id,
      tenantId: order.tenant_id,
      aggregateId: order.id,
      mutationType: 'SALE_CREATE',
      payload,
      now,
    });
  }

  private enqueueSaleReprintMutation(orderId: string, now: string): void {
    const order = this.getOrderRow(orderId);
    if (!order) throw new Error('Order not found while enqueueing sale reprint mutation.');
    const payload = {
      mutation_id: randomUUID(),
      type: 'SALE_REPRINT',
      order_id: order.id,
      kiosk_id: order.kiosk_id,
      print_status: order.print_status,
      print_attempt_count: order.print_attempt_count,
      last_print_error: order.last_error,
      last_print_at: order.last_print_at,
      created_at: now,
      meta: {
        source: 'quick_sale',
      },
    };

    this.enqueueUnifiedMutation({
      mutationId: payload.mutation_id,
      tenantId: order.tenant_id,
      aggregateId: order.id,
      mutationType: 'SALE_REPRINT',
      payload,
      now,
    });
  }

  private enqueueSaleCancelMutation(orderId: string, now: string): void {
    const order = this.getOrderRow(orderId);
    if (!order) throw new Error('Order not found while enqueueing sale cancel mutation.');
    const payload = {
      mutation_id: randomUUID(),
      type: 'SALE_CANCEL',
      order_id: order.id,
      kiosk_id: order.kiosk_id,
      canceled_at: order.canceled_at,
      cancel_reason: order.cancel_reason,
      created_at: now,
      meta: {
        source: 'quick_sale',
      },
    };

    this.enqueueUnifiedMutation({
      mutationId: payload.mutation_id,
      tenantId: order.tenant_id,
      aggregateId: order.id,
      mutationType: 'SALE_CANCEL',
      payload,
      now,
    });
  }

  private enqueueUnifiedMutation(input: {
    mutationId: string;
    tenantId: string | null;
    aggregateId: string;
    mutationType: 'SALE_CREATE' | 'SALE_REPRINT' | 'SALE_CANCEL';
    payload: Record<string, unknown>;
    now: string;
  }): void {
    if (!input.tenantId) {
      throw new Error('tenant_id is required to enqueue mutation.');
    }
    this.db
      .prepare(
        `
        INSERT INTO outbox_mutations (
          id, mutation_id, tenant_id, tab_id, mutation_type, base_tab_version, payload_json,
          status, attempts, last_error, created_at, updated_at, sent_at, acked_at
        ) VALUES (
          @id, @mutation_id, @tenant_id, @tab_id, @mutation_type, NULL, @payload_json,
          'PENDING', 0, NULL, @created_at, @updated_at, NULL, NULL
        )
      `,
      )
      .run({
        id: randomUUID(),
        mutation_id: input.mutationId,
        tenant_id: input.tenantId,
        tab_id: input.aggregateId,
        mutation_type: input.mutationType,
        payload_json: JSON.stringify(input.payload),
        created_at: input.now,
        updated_at: input.now,
      });
  }

  private nextFolioNumber(): number {
    const row = this.db
      .prepare("SELECT value FROM folio_counter_local WHERE key = 'kiosk_folio' LIMIT 1")
      .get() as { value: number } | undefined;

    const next = (row?.value || 0) + 1;
    this.db
      .prepare(`
        INSERT INTO folio_counter_local (key, value)
        VALUES ('kiosk_folio', @value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run({ value: next });

    return next;
  }

  listPendingOutbox(limit = 25): Array<OutboxRow> {
    return this.db
      .prepare(`
        SELECT id, event_type, payload_json, status, attempts
        FROM sync_outbox
        WHERE status IN ('PENDING', 'FAILED')
        ORDER BY created_at ASC
        LIMIT ?
      `)
      .all(limit) as OutboxRow[];
  }

  markOutboxSent(id: string): void {
    this.db
      .prepare(`
        UPDATE sync_outbox
        SET status = 'SENT', attempts = attempts + 1, last_error = NULL, updated_at = @updated_at
        WHERE id = @id
      `)
      .run({ id, updated_at: new Date().toISOString() });
  }

  markOutboxFailed(id: string, error: string): void {
    this.db
      .prepare(`
        UPDATE sync_outbox
        SET status = 'FAILED', attempts = attempts + 1, last_error = @last_error, updated_at = @updated_at
        WHERE id = @id
      `)
      .run({ id, last_error: error, updated_at: new Date().toISOString() });
  }

  markOrderSynced(orderId: string): void {
    this.db
      .prepare(
        `
        UPDATE orders_local
        SET synced_at = @synced_at
        WHERE id = @id
      `,
      )
      .run({ id: orderId, synced_at: new Date().toISOString() });
  }

  countPendingOutbox(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM sync_outbox WHERE status IN ('PENDING','FAILED')`)
      .get() as { count: number };
    return row.count || 0;
  }
}
