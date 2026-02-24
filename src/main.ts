import { app, BrowserWindow } from 'electron';
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
import { BarcodeScannerService } from './main/scanner/barcode-scanner-service';
import { IPC_CHANNELS } from './shared/ipc-channels';
import type { ScannerReading } from './shared/scanner';

function loadRuntimeEnv() {
  const userDataPath = app.getPath('userData');
  const runtimeEnvPath = path.join(userDataPath, 'config.env');

  if (fs.existsSync(runtimeEnvPath)) {
    dotenv.config({ path: runtimeEnvPath });
    return;
  }

  dotenv.config();
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let embeddedPrintServer: ReturnType<typeof createEmbeddedPrintServer> | null = null;
let barcodeScannerService: BarcodeScannerService | null = null;

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  loadRuntimeEnv();
  applyOpenTabsLocalMigrations(app.getPath('userData'));
  const ordersRepository = new OrdersRepository(app.getPath('userData'));
  const catalogRepository = new CatalogRepository(app.getPath('userData'));
  const catalogSyncService = new CatalogSyncService(catalogRepository, ordersRepository);
  const printJobsRepository = new PrintJobsRepository(app.getPath('userData'));
  const printService = new PrintService(
    printJobsRepository,
    new NativeV2Transport(printJobsRepository),
  );
  const salesService = new SalesService(ordersRepository, printService);
  const openTabsAppService = new OpenTabsAppService({
    userDataPath: app.getPath('userData'),
    catalogRepository,
    ordersRepository,
    printService,
  });
  registerCatalogHandlers(catalogRepository, catalogSyncService);
  registerPrintHandlers(printService);
  registerSalesHandlers(ordersRepository, salesService, openTabsAppService);
  barcodeScannerService = new BarcodeScannerService((reading: ScannerReading) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(IPC_CHANNELS.SCANNER_DATA, reading);
    });
  });
  barcodeScannerService.start();
  embeddedPrintServer = createEmbeddedPrintServer(printService, {
    host: '127.0.0.1',
    port: 7777,
  });
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  if (barcodeScannerService) {
    barcodeScannerService.stop();
    barcodeScannerService = null;
  }
  if (embeddedPrintServer) {
    embeddedPrintServer.close();
    embeddedPrintServer = null;
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
