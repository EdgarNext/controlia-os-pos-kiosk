export interface PrintV2Request {
  rawBase64: string;
  jobName?: string;
  tenantId?: string | null;
  kioskId?: string | null;
  orderId?: string | null;
}

export type PrintJobStatus = 'QUEUED' | 'SENT' | 'FAILED';

export interface PrintJobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: PrintJobStatus;
  jobName: string;
  tenantId: string | null;
  kioskId: string | null;
  orderId: string | null;
  attempts: number;
  lastError: string | null;
}

export interface PrintV2Response {
  ok: boolean;
  status: PrintJobStatus;
  jobId: string;
  error?: string;
}

export interface PrintConfig {
  linuxPrinterName: string;
  windowsPrinterShare: string;
}
