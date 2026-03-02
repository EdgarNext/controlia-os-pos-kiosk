import type { ScanCaptureDebugState, ScanContextMode } from '../../../shared/scanner';

export function createScannerSlice() {
  return {
    scanCaptureEnabled: true,
    scanCaptureMode: 'sale' as ScanContextMode,
    scanCaptureSensitiveFocusCount: 0,
    scannerDebugOpen: false,
    scannerDebugState: null as ScanCaptureDebugState | null,
    scannerDebugLoading: false,
    scanner: {
      version: 0,
    },
  };
}
