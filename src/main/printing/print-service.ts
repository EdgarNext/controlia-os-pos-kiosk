import type {
  PrintConfig,
  PrinterDebugTextOptions,
  PrinterDiagnostics,
  PrintJobRecord,
  PrintJobStatus,
  PrintV2Request,
  PrintV2Response,
} from '../../shared/print-v2';
import type { PrintTransport } from './print-transport';
import { PrintJobsRepository } from './print-jobs-repository';
import { buildEscPosTextPayload, normalizeEscPosPayload } from './escpos-utils';
import { getLinuxPrinterDiagnostics } from './linux-printer-device';

export class PrintService {
  private processing = false;
  private queue: Array<{ request: PrintV2Request; jobId: string }> = [];
  private listeners = new Set<(event: { jobId: string; status: PrintJobStatus; error?: string }) => void>();

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

  onJobCompleted(listener: (event: { jobId: string; status: PrintJobStatus; error?: string }) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
    const config = this.jobsRepository.getPrintConfig();
    if (process.platform !== 'linux') {
      return {
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
        notes: ['Linux diagnostics are only available on Linux.'],
      };
    }
    return getLinuxPrinterDiagnostics(config.linuxPrinterDevicePath);
  }

  async printerPrintSelfTest(includeDebugFooter = false): Promise<PrintV2Response> {
    const config = this.jobsRepository.getPrintConfig();
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
    const config = this.jobsRepository.getPrintConfig();
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
}
