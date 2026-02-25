import type {
  PrintConfig,
  PrintJobRecord,
  PrintJobStatus,
  PrintV2Request,
  PrintV2Response,
} from '../../shared/print-v2';
import type { PrintTransport } from './print-transport';
import { PrintJobsRepository } from './print-jobs-repository';

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

    const job = this.jobsRepository.enqueue(request);
    this.queue.push({ request, jobId: job.id });
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
          this.emit({ jobId: next.jobId, status: 'SENT' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Print error';
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
}
