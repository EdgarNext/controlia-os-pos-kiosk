export interface ScannerReading {
  code: string;
  receivedAt: string;
  source?: 'cdc' | 'hid';
  meta?: Record<string, unknown>;
}

export type ScannerMode = 'hid' | 'cdc';
export type ScanContextMode = 'sale' | 'assign' | 'disabled';

export interface HidScannerSettings {
  minCodeLen: number;
  maxCodeLen: number;
  maxInterKeyMsScan: number;
  scanEndGapMs: number;
  humanKeyGapMs: number;
  allowEnterTerminator: boolean;
  allowedCharsPattern: string;
}

export interface ScanContext {
  enabled: boolean;
  mode: ScanContextMode;
  selectedProductId?: string | null;
}

export interface HidScanPayload extends ScannerReading {
  source: 'hid';
}

export interface ScanCaptureLogEntry {
  level: 'debug' | 'info' | 'warn';
  message: string;
  ts: string;
  data?: Record<string, unknown>;
}

export interface ScanCaptureDebugState {
  enabled: boolean;
  context: ScanContext;
  scanModeActive: boolean;
  buffer: string;
  averageInterKeyMs: number | null;
  settings: HidScannerSettings;
  recentScans: ScannerReading[];
  logs: ScanCaptureLogEntry[];
}
