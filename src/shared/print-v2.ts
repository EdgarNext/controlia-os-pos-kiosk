export interface PrintV2Request {
  rawBase64: string;
  jobName?: string;
  tenantId?: string | null;
  kioskId?: string | null;
  orderId?: string | null;
}

export type PrinterBackend = 'epson_epos_ethernet' | 'usb_escpos';

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
  backend: PrinterBackend;
  epsonHost: string;
  epsonPort: number;
  epsonUseHttps: boolean;
  epsonDeviceId: string;
  epsonTimeoutMs: number;
  epsonPaperWidthMm: 58 | 80;
  epsonCopies: number;
  epsonCut: boolean;
  epsonOpenDrawer: boolean;
  linuxPrinterDevicePath: string;
  windowsPrinterShare: string;
}

export type EpsonPrinterStatusState =
  | 'ready'
  | 'no_response'
  | 'offline'
  | 'paper_end'
  | 'paper_near_end'
  | 'cover_open'
  | 'cutter_error'
  | 'mechanical_error'
  | 'unknown';

export interface EpsonPrinterStatusView {
  state: EpsonPrinterStatusState;
  label: string;
  message: string;
  checkedAt: string;
  success: boolean;
  code: string | null;
  status: number | null;
  battery: number | null;
  isOnline: boolean;
}

export interface PrinterConnectionResult {
  ok: boolean;
  checkedAt: string;
  endpoint: string;
  message: string;
  status: EpsonPrinterStatusView | null;
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
  backend: PrinterBackend;
  summary: string;
  platform: NodeJS.Platform;
  configuredDevicePath: string;
  resolvedDevicePath: string | null;
  currentUser: string;
  currentUid: number | null;
  currentGid: number | null;
  currentGroups: string[];
  pos58: PrinterDeviceStat;
  usbLpDevices: PrinterDeviceStat[];
  epsonEndpoint: string | null;
  epsonHost: string | null;
  epsonPort: number | null;
  epsonUseHttps: boolean;
  epsonDeviceId: string | null;
  epsonTimeoutMs: number | null;
  epsonLastStatus: EpsonPrinterStatusView | null;
  notes: string[];
}

export interface PrinterDebugTextOptions {
  includeDebugFooter?: boolean;
}

export function createDefaultPrintConfig(): PrintConfig {
  return {
    backend: 'epson_epos_ethernet',
    epsonHost: '',
    epsonPort: 80,
    epsonUseHttps: false,
    epsonDeviceId: 'local_printer',
    epsonTimeoutMs: 10000,
    epsonPaperWidthMm: 80,
    epsonCopies: 1,
    epsonCut: true,
    epsonOpenDrawer: false,
    linuxPrinterDevicePath: '/dev/pos58',
    windowsPrinterShare: '\\\\localhost\\POS58',
  };
}
