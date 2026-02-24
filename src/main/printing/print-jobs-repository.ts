import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  PrintConfig,
  PrintJobRecord,
  PrintJobStatus,
  PrintV2Request,
} from '../../shared/print-v2';

interface PrintJobRow {
  id: string;
  created_at: string;
  updated_at: string;
  status: PrintJobStatus;
  job_name: string;
  tenant_id: string | null;
  kiosk_id: string | null;
  order_id: string | null;
  attempts: number;
  last_error: string | null;
}

const DEFAULT_LINUX_PRINTER_NAME = 'POS58';
const DEFAULT_WINDOWS_PRINTER_SHARE = '\\\\localhost\\\\POS58';

export class PrintJobsRepository {
  private db: Database.Database;

  constructor(userDataPath: string) {
    const dbPath = path.join(userDataPath, 'pos-kiosk.sqlite3');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('QUEUED', 'SENT', 'FAILED')),
        job_name TEXT NOT NULL,
        tenant_id TEXT,
        kiosk_id TEXT,
        order_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_print_jobs_created_at
      ON print_jobs(created_at DESC);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  enqueue(input: PrintV2Request): PrintJobRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    const jobName = (input.jobName || '').trim() || `print_${id}`;

    const statement = this.db.prepare(`
      INSERT INTO print_jobs (
        id,
        created_at,
        updated_at,
        status,
        job_name,
        tenant_id,
        kiosk_id,
        order_id,
        attempts,
        last_error,
        payload_json
      )
      VALUES (
        @id,
        @created_at,
        @updated_at,
        'QUEUED',
        @job_name,
        @tenant_id,
        @kiosk_id,
        @order_id,
        0,
        NULL,
        @payload_json
      )
    `);

    statement.run({
      id,
      created_at: now,
      updated_at: now,
      job_name: jobName,
      tenant_id: input.tenantId ?? null,
      kiosk_id: input.kioskId ?? null,
      order_id: input.orderId ?? null,
      payload_json: JSON.stringify(input),
    });

    return {
      id,
      createdAt: now,
      updatedAt: now,
      status: 'QUEUED',
      jobName,
      tenantId: input.tenantId ?? null,
      kioskId: input.kioskId ?? null,
      orderId: input.orderId ?? null,
      attempts: 0,
      lastError: null,
    };
  }

  markSent(jobId: string): void {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      UPDATE print_jobs
      SET
        status = 'SENT',
        attempts = attempts + 1,
        last_error = NULL,
        updated_at = @updated_at
      WHERE id = @id
    `);
    statement.run({ id: jobId, updated_at: now });
  }

  markFailed(jobId: string, errorMessage: string): void {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      UPDATE print_jobs
      SET
        status = 'FAILED',
        attempts = attempts + 1,
        last_error = @last_error,
        updated_at = @updated_at
      WHERE id = @id
    `);
    statement.run({ id: jobId, last_error: errorMessage, updated_at: now });
  }

  list(limit = 20): PrintJobRecord[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 20;
    const statement = this.db.prepare(`
      SELECT
        id,
        created_at,
        updated_at,
        status,
        job_name,
        tenant_id,
        kiosk_id,
        order_id,
        attempts,
        last_error
      FROM print_jobs
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = statement.all(safeLimit) as PrintJobRow[];
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
      jobName: row.job_name,
      tenantId: row.tenant_id,
      kioskId: row.kiosk_id,
      orderId: row.order_id,
      attempts: row.attempts,
      lastError: row.last_error,
    }));
  }

  getPrintConfig(): PrintConfig {
    const statement = this.db.prepare(`
      SELECT key, value
      FROM app_settings
      WHERE key IN ('linux_printer_name', 'windows_printer_share')
    `);

    const rows = statement.all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((row) => [row.key, row.value]));

    return {
      linuxPrinterName:
        map.get('linux_printer_name') ||
        process.env.PRINTER_NAME ||
        DEFAULT_LINUX_PRINTER_NAME,
      windowsPrinterShare:
        map.get('windows_printer_share') ||
        process.env.PRINTER_SHARE ||
        DEFAULT_WINDOWS_PRINTER_SHARE,
    };
  }

  setPrintConfig(input: Partial<PrintConfig>): PrintConfig {
    const current = this.getPrintConfig();
    const next: PrintConfig = {
      linuxPrinterName:
        typeof input.linuxPrinterName === 'string' && input.linuxPrinterName.trim()
          ? input.linuxPrinterName.trim()
          : current.linuxPrinterName,
      windowsPrinterShare:
        typeof input.windowsPrinterShare === 'string' &&
        input.windowsPrinterShare.trim()
          ? input.windowsPrinterShare.trim()
          : current.windowsPrinterShare,
    };

    const upsert = this.db.prepare(`
      INSERT INTO app_settings(key, value)
      VALUES (@key, @value)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    const transaction = this.db.transaction(() => {
      upsert.run({
        key: 'linux_printer_name',
        value: next.linuxPrinterName,
      });
      upsert.run({
        key: 'windows_printer_share',
        value: next.windowsPrinterShare,
      });
    });

    transaction();
    return next;
  }
}
