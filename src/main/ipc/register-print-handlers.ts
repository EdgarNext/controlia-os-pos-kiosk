import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type {
  PrintConfig,
  PrinterDebugTextOptions,
  PrinterDiagnostics,
  PrintV2Request,
  PrintV2Response,
  PrintJobRecord,
} from '../../shared/print-v2';
import { PrintService } from '../printing/print-service';

export function registerPrintHandlers(printService: PrintService): void {
  ipcMain.handle(IPC_CHANNELS.PRINT_V2, async (_event, request: PrintV2Request): Promise<PrintV2Response> => {
    return printService.printV2(request);
  });

  ipcMain.handle(
    IPC_CHANNELS.PRINT_JOBS_LIST,
    async (_event, limit?: number): Promise<PrintJobRecord[]> => {
      return printService.listJobs(limit);
    },
  );

  ipcMain.handle(IPC_CHANNELS.PRINT_CONFIG_GET, async (): Promise<PrintConfig> => {
    return printService.getPrintConfig();
  });

  ipcMain.handle(
    IPC_CHANNELS.PRINT_CONFIG_SET,
    async (_event, input: Partial<PrintConfig>): Promise<PrintConfig> => {
      return printService.setPrintConfig(input || {});
    },
  );

  ipcMain.handle(IPC_CHANNELS.PRINTER_GET_DIAGNOSTICS, async (): Promise<PrinterDiagnostics> => {
    return printService.getPrinterDiagnostics();
  });

  ipcMain.handle(
    IPC_CHANNELS.PRINTER_PRINT_SELF_TEST,
    async (_event, input?: { includeDebugFooter?: boolean }): Promise<PrintV2Response> => {
      return printService.printerPrintSelfTest(Boolean(input?.includeDebugFooter));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PRINTER_PRINT_TEXT,
    async (_event, text: string, options?: PrinterDebugTextOptions): Promise<PrintV2Response> => {
      return printService.printerPrintText(text, options || {});
    },
  );
}
