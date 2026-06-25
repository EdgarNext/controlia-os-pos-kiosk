import type {
  PrintConfig,
  PrinterBackend,
  PrinterConnectionResult,
  PrinterDebugTextOptions,
  PrinterDiagnostics,
  PrintJobRecord,
  PrintJobStatus,
  PrintV2Request,
  PrintV2Response,
} from '../../shared/print-v2';
import type { PrintTransport } from './print-transport';
import { EpsonEposClient, buildEpsonEndpoint } from './epson-epos-client';
import { buildEscPosTextPayload, normalizeEscPosPayload } from './escpos-utils';
import { getLinuxPrinterDiagnostics } from './linux-printer-device';
import { PrintJobsRepository } from './print-jobs-repository';
import { renderKioskTicketEposXml } from './kiosk-ticket-epos-renderer';

export type KioskTicketPrintInput = {
  headerTitle?: string | null;
  lines: Array<{ name: string; qty: number; unitPriceCents: number; itemType?: string | null }>;
  totalCents: number;
  pagoRecibidoCents: number;
  cambioCents: number;
  metodoPago: string;
  folioText?: string;
  createdAtIso?: string;
  isReprint?: boolean;
  tenantId?: string | null;
  kioskId?: string | null;
  orderId?: string | null;
  usbRawBase64: string;
  jobName: string;
};

export class PrintService {
  private processing = false;
  private queue: Array<{ request: PrintV2Request; jobId: string }> = [];
  private listeners = new Set<(event: { jobId: string; status: PrintJobStatus; error?: string }) => void>();
  private readonly epsonClient = new EpsonEposClient();
  private lastEpsonStatus: PrinterConnectionResult['status'] | null = null;

  constructor(
    private readonly jobsRepository: PrintJobsRepository,
    private readonly transport: PrintTransport,
  ) {}

  async printV2(request: PrintV2Request): Promise<PrintV2Response> {
    const queued = this.enqueuePrintV2(request);
    const done = await this.waitForJobResult(queued.jobId);
    return {
      ok: done.status === 'SENT',
      status: done.status,
      jobId: done.jobId,
      error: done.error,
    };
  }

  enqueuePrintV2(request: PrintV2Request): { jobId: string } {
    if (!request.rawBase64 || typeof request.rawBase64 !== 'string') {
      throw new Error('rawBase64 is required');
    }

    const normalizedRequest = this.normalizeRequest(request);
    const job = this.jobsRepository.enqueue(normalizedRequest);
    this.queue.push({ request: normalizedRequest, jobId: job.id });
    void this.processQueue();
    return { jobId: job.id };
  }

  async printSaleTicket(input: KioskTicketPrintInput): Promise<PrintV2Response> {
    const config = this.getPrintConfig();
    if (this.getBackend(config) === 'usb_escpos') {
      const queued = this.enqueuePrintV2({
        rawBase64: input.usbRawBase64,
        jobName: input.jobName,
        tenantId: input.tenantId ?? null,
        kioskId: input.kioskId ?? null,
        orderId: input.orderId ?? null,
      });
      return {
        ok: true,
        status: 'QUEUED',
        jobId: queued.jobId,
      };
    }

    const xml = renderKioskTicketEposXml({
      headerTitle: input.headerTitle,
      lines: input.lines,
      totalCents: input.totalCents,
      pagoRecibidoCents: input.pagoRecibidoCents,
      cambioCents: input.cambioCents,
      metodoPago: input.metodoPago,
      folioText: input.folioText,
      createdAtIso: input.createdAtIso,
      isReprint: input.isReprint,
      config,
    });
    return this.printEpsonXmlJob({
      config,
      xml,
      jobName: input.jobName,
      tenantId: input.tenantId ?? null,
      kioskId: input.kioskId ?? null,
      orderId: input.orderId ?? null,
      payloadJson: JSON.stringify({ type: 'epson_sale_ticket', folioText: input.folioText || null }),
    });
  }

  onJobCompleted(listener: (event: { jobId: string; status: PrintJobStatus; error?: string }) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  listJobs(limit = 20): PrintJobRecord[] {
    return this.jobsRepository.list(limit);
  }

  getPrintConfig(): PrintConfig {
    return this.jobsRepository.getPrintConfig();
  }

  setPrintConfig(input: Partial<PrintConfig>): PrintConfig {
    return this.jobsRepository.setPrintConfig(input);
  }

  async getPrinterDiagnostics(): Promise<PrinterDiagnostics> {
    const config = this.getPrintConfig();
    if (this.getBackend(config) === 'epson_epos_ethernet') {
      const endpoint = config.epsonHost ? buildEpsonEndpoint(config) : null;
      return {
        backend: 'epson_epos_ethernet',
        summary: endpoint
          ? `backend=epson_epos_ethernet · endpoint=${endpoint}`
          : 'backend=epson_epos_ethernet · host pendiente',
        platform: process.platform,
        configuredDevicePath: config.linuxPrinterDevicePath,
        resolvedDevicePath: null,
        currentUser: 'n/a',
        currentUid: null,
        currentGid: null,
        currentGroups: [],
        pos58: {
          path: '/dev/pos58',
          exists: false,
          writable: false,
          owner: null,
          group: null,
          mode: null,
          error: 'No usado mientras Epson Ethernet esté activo.',
        },
        usbLpDevices: [],
        epsonEndpoint: endpoint,
        epsonHost: config.epsonHost || null,
        epsonPort: config.epsonPort,
        epsonUseHttps: config.epsonUseHttps,
        epsonDeviceId: config.epsonDeviceId || null,
        epsonTimeoutMs: config.epsonTimeoutMs,
        epsonLastStatus: this.lastEpsonStatus,
        notes: [
          config.epsonHost
            ? 'Usa "Probar conexion Epson" para validar conectividad real.'
            : 'Captura host/IP Epson para habilitar pruebas.',
        ],
      };
    }

    if (process.platform !== 'linux') {
      return {
        backend: 'usb_escpos',
        summary: `backend=usb_escpos · platform=${process.platform}`,
        platform: process.platform,
        configuredDevicePath: config.linuxPrinterDevicePath,
        resolvedDevicePath: null,
        currentUser: 'n/a',
        currentUid: null,
        currentGid: null,
        currentGroups: [],
        pos58: {
          path: '/dev/pos58',
          exists: false,
          writable: false,
          owner: null,
          group: null,
          mode: null,
          error: 'Linux diagnostics are only available on Linux.',
        },
        usbLpDevices: [],
        epsonEndpoint: null,
        epsonHost: null,
        epsonPort: null,
        epsonUseHttps: false,
        epsonDeviceId: null,
        epsonTimeoutMs: null,
        epsonLastStatus: this.lastEpsonStatus,
        notes: ['Linux diagnostics are only available on Linux.'],
      };
    }

    const diagnostics = await getLinuxPrinterDiagnostics(config.linuxPrinterDevicePath);
    return {
      ...diagnostics,
      backend: 'usb_escpos',
      summary: `backend=usb_escpos · configured=${diagnostics.configuredDevicePath} · resolved=${diagnostics.resolvedDevicePath || 'none'}`,
      epsonEndpoint: null,
      epsonHost: null,
      epsonPort: null,
      epsonUseHttps: false,
      epsonDeviceId: null,
      epsonTimeoutMs: null,
      epsonLastStatus: this.lastEpsonStatus,
    };
  }

  async printerTestConnection(): Promise<PrinterConnectionResult> {
    const config = this.getPrintConfig();
    if (this.getBackend(config) === 'epson_epos_ethernet') {
      if (!config.epsonHost.trim()) {
        throw new Error('Configura host/IP Epson antes de probar conexión.');
      }
      const result = await this.epsonClient.checkStatus(config);
      this.lastEpsonStatus = result.status;
      return result;
    }

    const diagnostics = await this.getPrinterDiagnostics();
    return {
      ok: Boolean(diagnostics.resolvedDevicePath),
      checkedAt: new Date().toISOString(),
      endpoint: diagnostics.resolvedDevicePath || diagnostics.configuredDevicePath,
      message: diagnostics.resolvedDevicePath
        ? `Dispositivo USB listo en ${diagnostics.resolvedDevicePath}.`
        : diagnostics.notes[0] || 'No se detectó dispositivo USB listo.',
      status: null,
    };
  }

  async printerPrintSelfTest(includeDebugFooter = false): Promise<PrintV2Response> {
    const config = this.getPrintConfig();
    if (this.getBackend(config) === 'epson_epos_ethernet') {
      if (!config.epsonHost.trim()) {
        throw new Error('Configura host/IP Epson antes de imprimir prueba.');
      }
      const result = await this.epsonClient.testPrint(config);
      this.lastEpsonStatus = result.status;
      return this.mapDirectResultToPrintResponse(result, `epson_self_test_${Date.now()}`, {
        payloadJson: JSON.stringify({ type: 'epson_self_test', includeDebugFooter }),
      });
    }

    const footer = includeDebugFooter
      ? [
          '--------------------',
          `ts=${new Date().toISOString()}`,
          `app=${process.env.npm_package_version || 'dev'}`,
          `device=${config.linuxPrinterDevicePath || '/dev/pos58'}`,
        ]
      : [];
    const payload = buildEscPosTextPayload(
      ['POS KIOSK SELF-TEST', 'PRINT V2 DIRECT USB', `fecha=${new Date().toISOString()}`].join('\n'),
      footer,
    );
    return this.printV2({
      rawBase64: payload.toString('base64'),
      jobName: `self_test_${Date.now()}`,
    });
  }

  async printerPrintText(text: string, options: PrinterDebugTextOptions = {}): Promise<PrintV2Response> {
    const config = this.getPrintConfig();
    if (this.getBackend(config) === 'epson_epos_ethernet') {
      if (!config.epsonHost.trim()) {
        throw new Error('Configura host/IP Epson antes de imprimir texto.');
      }
      const result = await this.epsonClient.printDebugText(config, text, Boolean(options.includeDebugFooter));
      this.lastEpsonStatus = result.status;
      return this.mapDirectResultToPrintResponse(result, `epson_debug_text_${Date.now()}`, {
        payloadJson: JSON.stringify({ type: 'epson_debug_text' }),
      });
    }

    const footer = options.includeDebugFooter
      ? [
          '--------------------',
          `ts=${new Date().toISOString()}`,
          `app=${process.env.npm_package_version || 'dev'}`,
          `device=${config.linuxPrinterDevicePath || '/dev/pos58'}`,
        ]
      : [];
    const payload = buildEscPosTextPayload(text, footer);
    return this.printV2({
      rawBase64: payload.toString('base64'),
      jobName: `debug_text_${Date.now()}`,
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) break;
        try {
          await this.transport.send(next.request);
          this.jobsRepository.markSent(next.jobId);
          console.info('[print] job sent', { jobId: next.jobId, jobName: next.request.jobName || 'unnamed' });
          this.emit({ jobId: next.jobId, status: 'SENT' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Print error';
          console.error('[print] job failed', { jobId: next.jobId, error: message });
          this.jobsRepository.markFailed(next.jobId, message);
          this.emit({ jobId: next.jobId, status: 'FAILED', error: message });
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private waitForJobResult(jobId: string): Promise<{ jobId: string; status: PrintJobStatus; error?: string }> {
    return new Promise((resolve) => {
      const unsubscribe = this.onJobCompleted((event) => {
        if (event.jobId !== jobId) return;
        unsubscribe();
        resolve(event);
      });
    });
  }

  private emit(event: { jobId: string; status: PrintJobStatus; error?: string }): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private normalizeRequest(request: PrintV2Request): PrintV2Request {
    const rawBuffer = Buffer.from(String(request.rawBase64 || ''), 'base64');
    if (!rawBuffer.length) {
      throw new Error('Invalid rawBase64 payload');
    }
    const normalized = normalizeEscPosPayload(rawBuffer);
    return {
      ...request,
      rawBase64: normalized.toString('base64'),
    };
  }

  private getBackend(config: PrintConfig): PrinterBackend {
    return config.backend === 'usb_escpos' ? 'usb_escpos' : 'epson_epos_ethernet';
  }

  private async printEpsonXmlJob(input: {
    config: PrintConfig;
    xml: string;
    jobName: string;
    tenantId?: string | null;
    kioskId?: string | null;
    orderId?: string | null;
    payloadJson?: string;
  }): Promise<PrintV2Response> {
    const job = this.jobsRepository.createJobRecord({
      jobName: input.jobName,
      tenantId: input.tenantId ?? null,
      kioskId: input.kioskId ?? null,
      orderId: input.orderId ?? null,
      payloadJson: input.payloadJson,
    });
    try {
      const result = await this.epsonClient.printXml(input.config, input.xml);
      this.lastEpsonStatus = result.status;
      if (result.ok) {
        this.jobsRepository.markSent(job.id);
        this.emit({ jobId: job.id, status: 'SENT' });
        return { ok: true, status: 'SENT', jobId: job.id };
      }
      this.jobsRepository.markFailed(job.id, result.message);
      this.emit({ jobId: job.id, status: 'FAILED', error: result.message });
      return { ok: false, status: 'FAILED', jobId: job.id, error: result.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Print error';
      this.jobsRepository.markFailed(job.id, message);
      this.emit({ jobId: job.id, status: 'FAILED', error: message });
      return { ok: false, status: 'FAILED', jobId: job.id, error: message };
    }
  }

  private async mapDirectResultToPrintResponse(
    result: PrinterConnectionResult,
    jobName: string,
    metadata?: { payloadJson?: string },
  ): Promise<PrintV2Response> {
    const job = this.jobsRepository.createJobRecord({
      jobName,
      payloadJson: metadata?.payloadJson,
    });
    if (result.ok) {
      this.jobsRepository.markSent(job.id);
      this.emit({ jobId: job.id, status: 'SENT' });
      return { ok: true, status: 'SENT', jobId: job.id };
    }

    this.jobsRepository.markFailed(job.id, result.message);
    this.emit({ jobId: job.id, status: 'FAILED', error: result.message });
    return { ok: false, status: 'FAILED', jobId: job.id, error: result.message };
  }
}
