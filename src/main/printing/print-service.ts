import type {
  PrintConfig,
  PrintJobRecord,
  PrintV2Request,
  PrintV2Response,
} from '../../shared/print-v2';
import type { PrintTransport } from './print-transport';
import { PrintJobsRepository } from './print-jobs-repository';

export class PrintService {
  constructor(
    private readonly jobsRepository: PrintJobsRepository,
    private readonly transport: PrintTransport,
  ) {}

  async printV2(request: PrintV2Request): Promise<PrintV2Response> {
    if (!request.rawBase64 || typeof request.rawBase64 !== 'string') {
      return {
        ok: false,
        status: 'FAILED',
        jobId: '',
        error: 'rawBase64 is required',
      };
    }

    const job = this.jobsRepository.enqueue(request);

    try {
      await this.transport.send(request);
      this.jobsRepository.markSent(job.id);
      return {
        ok: true,
        status: 'SENT',
        jobId: job.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Print error';
      this.jobsRepository.markFailed(job.id, message);
      return {
        ok: false,
        status: 'FAILED',
        jobId: job.id,
        error: message,
      };
    }
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
