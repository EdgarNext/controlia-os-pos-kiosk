import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import dotenv from 'dotenv';
import { applyOpenTabsLocalMigrations } from '../lib/local-db/migrator';
import { CatalogRepository } from './main/catalog/catalog-repository';
import { CatalogSyncService } from './main/catalog/sync-catalog-service';
import { registerCatalogHandlers } from './main/ipc/register-catalog-handlers';
import { registerPrintHandlers } from './main/ipc/register-print-handlers';
import { registerSalesHandlers } from './main/ipc/register-sales-handlers';
import { OrdersRepository } from './main/orders/orders-repository';
import { SalesService } from './main/orders/sales-service';
import { OpenTabsAppService } from './main/sales-pos/open-tabs-app-service';
import { createEmbeddedPrintServer } from './main/printing/embedded-print-server';
import { NativeV2Transport } from './main/printing/native-v2-transport';
import { PrintJobsRepository } from './main/printing/print-jobs-repository';
import { PrintService } from './main/printing/print-service';
import { createScanCapture } from './main/scanner/scan-capture';
import { SyncCoordinator } from './main/sync/sync-coordinator';
import { IPC_CHANNELS } from './shared/ipc-channels';
import type { RuntimeConfig } from './shared/orders';
import type { HidScannerSettings, ScanCaptureDebugState, ScanContext, ScannerReading } from './shared/scanner';

function loadRuntimeEnv() {
  const userDataPath = app.getPath('userData');
  const runtimeEnvPath = path.join(userDataPath, 'config.env');

  if (fs.existsSync(runtimeEnvPath)) {
    dotenv.config({ path: runtimeEnvPath });
    return;
  }

  dotenv.config();
}

if (started) {
  app.quit();
}

let embeddedPrintServer: ReturnType<typeof createEmbeddedPrintServer> | null = null;
let scanCapture: ReturnType<typeof createScanCapture> | null = null;
let mainWindow: BrowserWindow | null = null;
let ordersRepositoryRef: OrdersRepository | null = null;
let syncCoordinatorRef: SyncCoordinator | null = null;

const scanContextState: ScanContext = {
  enabled: true,
  mode: 'sale',
  selectedProductId: null,
};

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    fullscreen: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
    win.webContents.openDevTools();
  }

  // Open maximized by default, but keep standard windowed mode (not fullscreen).
  win.maximize();

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
    if (scanCapture) {
      scanCapture.destroy();
      scanCapture = null;
    }
  });

  return win;
};

function runtimeConfigToHidSettings(runtime: RuntimeConfig): Partial<HidScannerSettings> {
  return {
    minCodeLen: runtime.scannerMinCodeLen ?? undefined,
    maxCodeLen: runtime.scannerMaxCodeLen ?? undefined,
    maxInterKeyMsScan: runtime.scannerMaxInterKeyMsScan ?? undefined,
    scanEndGapMs: runtime.scannerScanEndGapMs ?? undefined,
    humanKeyGapMs: runtime.scannerHumanKeyGapMs ?? undefined,
    allowEnterTerminator: runtime.scannerAllowEnterTerminator ?? undefined,
    allowedCharsPattern: runtime.scannerAllowedCharsPattern ?? undefined,
  };
}

function sendLegacyScanToRenderer(reading: ScannerReading): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.SCANNER_DATA, reading);
  });
}

function sendHidScanToRenderer(reading: ScannerReading): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.SCAN_CAPTURE_DATA, reading);
  });
}

function initScanner(runtimeConfig: RuntimeConfig): void {
  if (!mainWindow) return;
  scanCapture = createScanCapture({
    win: mainWindow,
    settingsProvider: () => runtimeConfigToHidSettings(runtimeConfig),
    onScan: (reading) => {
      sendLegacyScanToRenderer(reading);
      sendHidScanToRenderer(reading);
    },
  });
  scanCapture.setContext(scanContextState);
}

function buildDefaultDebugState(): ScanCaptureDebugState {
  return {
    enabled: false,
    context: { ...scanContextState },
    scanModeActive: false,
    buffer: '',
    averageInterKeyMs: null,
    settings: {
      minCodeLen: 6,
      maxCodeLen: 64,
      maxInterKeyMsScan: 35,
      scanEndGapMs: 80,
      humanKeyGapMs: 100,
      allowEnterTerminator: true,
      allowedCharsPattern: '[0-9A-Za-z\\-_.]',
    },
    recentScans: [],
    logs: [],
  };
}

function registerScanCaptureHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SCAN_CAPTURE_SET_CONTEXT, async (_event, ctx: Partial<ScanContext>): Promise<ScanContext> => {
    const next: ScanContext = {
      ...scanContextState,
      ...ctx,
      selectedProductId: ctx.selectedProductId ?? scanContextState.selectedProductId ?? null,
    };
    scanContextState.enabled = next.enabled;
    scanContextState.mode = next.mode;
    scanContextState.selectedProductId = next.selectedProductId;

    if (scanCapture) return scanCapture.setContext(next);
    return next;
  });

  ipcMain.handle(IPC_CHANNELS.SCAN_CAPTURE_SET_ENABLED, async (_event, enabled: boolean): Promise<ScanContext> => {
    scanContextState.enabled = Boolean(enabled);
    if (scanCapture) {
      return scanCapture.setContext({ enabled: scanContextState.enabled });
    }
    return { ...scanContextState };
  });

  ipcMain.handle(
    IPC_CHANNELS.SCAN_CAPTURE_SET_SETTINGS,
    async (_event, input: Partial<HidScannerSettings>): Promise<HidScannerSettings> => {
      if (ordersRepositoryRef) {
        ordersRepositoryRef.setRuntimeConfig({
          scannerMinCodeLen: input.minCodeLen,
          scannerMaxCodeLen: input.maxCodeLen,
          scannerMaxInterKeyMsScan: input.maxInterKeyMsScan,
          scannerScanEndGapMs: input.scanEndGapMs,
          scannerHumanKeyGapMs: input.humanKeyGapMs,
          scannerAllowEnterTerminator: input.allowEnterTerminator,
          scannerAllowedCharsPattern: input.allowedCharsPattern,
        });
      }

      if (scanCapture) {
        return scanCapture.updateSettings(input);
      }

      const runtimeConfig = ordersRepositoryRef?.getRuntimeConfig() || null;
      return {
        minCodeLen: runtimeConfig?.scannerMinCodeLen ?? 6,
        maxCodeLen: runtimeConfig?.scannerMaxCodeLen ?? 64,
        maxInterKeyMsScan: runtimeConfig?.scannerMaxInterKeyMsScan ?? 35,
        scanEndGapMs: runtimeConfig?.scannerScanEndGapMs ?? 80,
        humanKeyGapMs: runtimeConfig?.scannerHumanKeyGapMs ?? 100,
        allowEnterTerminator: runtimeConfig?.scannerAllowEnterTerminator ?? true,
        allowedCharsPattern: runtimeConfig?.scannerAllowedCharsPattern || '[0-9A-Za-z\\-_.]',
      };
    },
  );

  ipcMain.handle(IPC_CHANNELS.SCAN_CAPTURE_GET_DEBUG_STATE, async (): Promise<ScanCaptureDebugState> => {
    if (!scanCapture) return buildDefaultDebugState();
    return scanCapture.getDebugState();
  });
}

app.on('ready', () => {
  loadRuntimeEnv();
  applyOpenTabsLocalMigrations(app.getPath('userData'));
  const ordersRepository = new OrdersRepository(app.getPath('userData'));
  ordersRepositoryRef = ordersRepository;
  const catalogRepository = new CatalogRepository(app.getPath('userData'));
  const catalogSyncService = new CatalogSyncService(catalogRepository, ordersRepository);
  const printJobsRepository = new PrintJobsRepository(app.getPath('userData'));
  const printService = new PrintService(printJobsRepository, new NativeV2Transport(printJobsRepository));
  const syncCoordinator = new SyncCoordinator({
    userDataPath: app.getPath('userData'),
    getRuntimeConfig: () => ordersRepository.getRuntimeConfig(),
    onStatus: (status) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send(IPC_CHANNELS.OUTBOX_STATUS_EVENT, status);
      });
    },
  });
  syncCoordinatorRef = syncCoordinator;
  const salesService = new SalesService(ordersRepository, printService, syncCoordinator);
  const openTabsAppService = new OpenTabsAppService({
    userDataPath: app.getPath('userData'),
    catalogRepository,
    ordersRepository,
    printService,
  });

  registerCatalogHandlers(catalogRepository, catalogSyncService);
  registerPrintHandlers(printService);
  registerSalesHandlers(ordersRepository, salesService, openTabsAppService, syncCoordinator);
  registerScanCaptureHandlers();

  embeddedPrintServer = createEmbeddedPrintServer(printService, {
    host: '127.0.0.1',
    port: 7777,
  });

  mainWindow = createWindow();
  salesService.start();
  syncCoordinator.start();
  initScanner(ordersRepository.getRuntimeConfig());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
    if (!scanCapture) {
      const runtime = ordersRepositoryRef?.getRuntimeConfig();
      if (runtime) initScanner(runtime);
    }
  }
});

app.on('will-quit', () => {
  if (scanCapture) {
    scanCapture.destroy();
    scanCapture = null;
  }
  if (embeddedPrintServer) {
    embeddedPrintServer.close();
    embeddedPrintServer = null;
  }
  if (syncCoordinatorRef) {
    syncCoordinatorRef.stop();
    syncCoordinatorRef = null;
  }
  mainWindow = null;
});
