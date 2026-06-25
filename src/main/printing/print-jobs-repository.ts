import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  PrintConfig,
  PrintJobRecord,
  PrintJobStatus,
  PrintV2Request,
} from '../../shared/print-v2';
import { createDefaultPrintConfig } from '../../shared/print-v2';
import { DEFAULT_LINUX_PRINTER_DEVICE_PATH } from './linux-printer-device';

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
    const hadAppSettings = Boolean(
      this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_settings' LIMIT 1`)
        .get(),
    );

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
    this.ensurePrintConfigMigration(hadAppSettings);
  }

  private ensurePrintConfigMigration(hadAppSettings: boolean): void {
    const get = this.db.prepare(`SELECT value FROM app_settings WHERE key = ?`);
    const upsert = this.db.prepare(`
      INSERT INTO app_settings(key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const defaults = createDefaultPrintConfig();

    const transaction = this.db.transaction(() => {
      const hasDevicePath = get.get('linux_printer_device_path') as { value: string } | undefined;
      if (!hasDevicePath?.value) {
        upsert.run('linux_printer_device_path', DEFAULT_LINUX_PRINTER_DEVICE_PATH);
      }
      const defaultsByKey: Record<string, string> = {
        backend: hadAppSettings ? 'usb_escpos' : defaults.backend,
        epson_host: defaults.epsonHost,
        epson_port: String(defaults.epsonPort),
        epson_use_https: defaults.epsonUseHttps ? '1' : '0',
        epson_device_id: defaults.epsonDeviceId,
        epson_timeout_ms: String(defaults.epsonTimeoutMs),
        epson_paper_width_mm: String(defaults.epsonPaperWidthMm),
        epson_copies: String(defaults.epsonCopies),
        epson_cut: defaults.epsonCut ? '1' : '0',
        epson_open_drawer: defaults.epsonOpenDrawer ? '1' : '0',
        windows_printer_share: process.env.PRINTER_SHARE || DEFAULT_WINDOWS_PRINTER_SHARE,
      };

      Object.entries(defaultsByKey).forEach(([key, value]) => {
        const row = get.get(key) as { value: string } | undefined;
        if (!row?.value) {
          upsert.run(key, value);
        }
      });
    });
    transaction();
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

  createJobRecord(input: {
    jobName: string;
    tenantId?: string | null;
    kioskId?: string | null;
    orderId?: string | null;
    payloadJson?: string;
  }): PrintJobRecord {
    const now = new Date().toISOString();
    const id = randomUUID();

    this.db
      .prepare(`
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
      `)
      .run({
        id,
        created_at: now,
        updated_at: now,
        job_name: input.jobName,
        tenant_id: input.tenantId ?? null,
        kiosk_id: input.kioskId ?? null,
        order_id: input.orderId ?? null,
        payload_json: input.payloadJson || '{}',
      });

    return {
      id,
      createdAt: now,
      updatedAt: now,
      status: 'QUEUED',
      jobName: input.jobName,
      tenantId: input.tenantId ?? null,
      kioskId: input.kioskId ?? null,
      orderId: input.orderId ?? null,
      attempts: 0,
      lastError: null,
    };
  }

  getPrintConfig(): PrintConfig {
    const statement = this.db.prepare(`
      SELECT key, value
      FROM app_settings
      WHERE key IN (
        'backend',
        'epson_host',
        'epson_port',
        'epson_use_https',
        'epson_device_id',
        'epson_timeout_ms',
        'epson_paper_width_mm',
        'epson_copies',
        'epson_cut',
        'epson_open_drawer',
        'linux_printer_device_path',
        'windows_printer_share'
      )
    `);

    const rows = statement.all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((row) => [row.key, row.value]));
    const defaults = createDefaultPrintConfig();
    const backend = map.get('backend') === 'usb_escpos' ? 'usb_escpos' : defaults.backend;
    const epsonPort = Number.parseInt(map.get('epson_port') || '', 10);
    const epsonTimeoutMs = Number.parseInt(map.get('epson_timeout_ms') || '', 10);
    const epsonPaperWidthMm = Number.parseInt(map.get('epson_paper_width_mm') || '', 10);
    const epsonCopies = Number.parseInt(map.get('epson_copies') || '', 10);

    return {
      backend,
      epsonHost: map.get('epson_host') || defaults.epsonHost,
      epsonPort: Number.isFinite(epsonPort) ? epsonPort : defaults.epsonPort,
      epsonUseHttps: map.get('epson_use_https') === '1',
      epsonDeviceId: map.get('epson_device_id') || defaults.epsonDeviceId,
      epsonTimeoutMs: Number.isFinite(epsonTimeoutMs) ? epsonTimeoutMs : defaults.epsonTimeoutMs,
      epsonPaperWidthMm: epsonPaperWidthMm === 58 ? 58 : defaults.epsonPaperWidthMm,
      epsonCopies: Number.isFinite(epsonCopies) ? epsonCopies : defaults.epsonCopies,
      epsonCut: map.get('epson_cut') !== '0',
      epsonOpenDrawer: map.get('epson_open_drawer') === '1',
      linuxPrinterDevicePath:
        map.get('linux_printer_device_path') ||
        process.env.PRINTER_DEVICE_PATH ||
        defaults.linuxPrinterDevicePath,
      windowsPrinterShare:
        map.get('windows_printer_share') ||
        process.env.PRINTER_SHARE ||
        defaults.windowsPrinterShare,
    };
  }

  setPrintConfig(input: Partial<PrintConfig>): PrintConfig {
    const current = this.getPrintConfig();
    const next: PrintConfig = {
      backend: input.backend === 'usb_escpos' ? 'usb_escpos' : input.backend === 'epson_epos_ethernet' ? 'epson_epos_ethernet' : current.backend,
      epsonHost:
        typeof input.epsonHost === 'string'
          ? input.epsonHost.trim()
          : current.epsonHost,
      epsonPort:
        Number.isFinite(input.epsonPort) && Number(input.epsonPort) > 0
          ? Math.floor(Number(input.epsonPort))
          : current.epsonPort,
      epsonUseHttps:
        typeof input.epsonUseHttps === 'boolean' ? input.epsonUseHttps : current.epsonUseHttps,
      epsonDeviceId:
        typeof input.epsonDeviceId === 'string' && input.epsonDeviceId.trim()
          ? input.epsonDeviceId.trim()
          : current.epsonDeviceId,
      epsonTimeoutMs:
        Number.isFinite(input.epsonTimeoutMs) && Number(input.epsonTimeoutMs) >= 1000
          ? Math.floor(Number(input.epsonTimeoutMs))
          : current.epsonTimeoutMs,
      epsonPaperWidthMm:
        input.epsonPaperWidthMm === 58 || input.epsonPaperWidthMm === 80
          ? input.epsonPaperWidthMm
          : current.epsonPaperWidthMm,
      epsonCopies:
        Number.isFinite(input.epsonCopies) && Number(input.epsonCopies) >= 1
          ? Math.floor(Number(input.epsonCopies))
          : current.epsonCopies,
      epsonCut:
        typeof input.epsonCut === 'boolean' ? input.epsonCut : current.epsonCut,
      epsonOpenDrawer:
        typeof input.epsonOpenDrawer === 'boolean' ? input.epsonOpenDrawer : current.epsonOpenDrawer,
      linuxPrinterDevicePath:
        typeof input.linuxPrinterDevicePath === 'string' && input.linuxPrinterDevicePath.trim()
          ? input.linuxPrinterDevicePath.trim()
          : current.linuxPrinterDevicePath,
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
        key: 'backend',
        value: next.backend,
      });
      upsert.run({
        key: 'epson_host',
        value: next.epsonHost,
      });
      upsert.run({
        key: 'epson_port',
        value: String(next.epsonPort),
      });
      upsert.run({
        key: 'epson_use_https',
        value: next.epsonUseHttps ? '1' : '0',
      });
      upsert.run({
        key: 'epson_device_id',
        value: next.epsonDeviceId,
      });
      upsert.run({
        key: 'epson_timeout_ms',
        value: String(next.epsonTimeoutMs),
      });
      upsert.run({
        key: 'epson_paper_width_mm',
        value: String(next.epsonPaperWidthMm),
      });
      upsert.run({
        key: 'epson_copies',
        value: String(next.epsonCopies),
      });
      upsert.run({
        key: 'epson_cut',
        value: next.epsonCut ? '1' : '0',
      });
      upsert.run({
        key: 'epson_open_drawer',
        value: next.epsonOpenDrawer ? '1' : '0',
      });
      upsert.run({
        key: 'linux_printer_device_path',
        value: next.linuxPrinterDevicePath,
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
