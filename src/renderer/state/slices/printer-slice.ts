import type { PrintConfig, PrinterDiagnostics, PrintJobRecord } from '../../../shared/print-v2';

export function createPrinterSlice() {
  return {
    printConfig: null as PrintConfig | null,
    printJobs: [] as PrintJobRecord[],
    printerDebugOpen: false,
    printerDiagnostics: null as PrinterDiagnostics | null,
    printerDebugLoading: false,
    printerDebugCustomText: '',
    printerDebugIncludeFooter: true,
    printerDebugLogs: [] as string[],
    printer: {
      version: 0,
    },
  };
}
