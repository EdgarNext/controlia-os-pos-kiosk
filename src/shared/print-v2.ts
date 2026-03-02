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
  linuxPrinterDevicePath: string;
  windowsPrinterShare: string;
}

export interface PrinterDeviceStat {
  path: string;
  exists: boolean;
  writable: boolean;
  owner: string | null;
  group: string | null;
  mode: string | null;
  error: string | null;
}

export interface PrinterDiagnostics {
  platform: NodeJS.Platform;
  configuredDevicePath: string;
  resolvedDevicePath: string | null;
  currentUser: string;
  currentUid: number | null;
  currentGid: number | null;
  currentGroups: string[];
  pos58: PrinterDeviceStat;
  usbLpDevices: PrinterDeviceStat[];
  notes: string[];
}

export interface PrinterDebugTextOptions {
  includeDebugFooter?: boolean;
}
