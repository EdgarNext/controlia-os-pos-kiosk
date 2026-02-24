import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from './shared/ipc-channels';
import type { PosKioskElectronApi } from './shared/electron-api';
import type { PrintV2Request } from './shared/print-v2';
import type { ScannerReading } from './shared/scanner';

const api: PosKioskElectronApi = {
  printV2(request: PrintV2Request) {
    return ipcRenderer.invoke(IPC_CHANNELS.PRINT_V2, request);
  },
  listPrintJobs(limit?: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.PRINT_JOBS_LIST, limit);
  },
  getPrintConfig() {
    return ipcRenderer.invoke(IPC_CHANNELS.PRINT_CONFIG_GET);
  },
  setPrintConfig(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.PRINT_CONFIG_SET, input);
  },
  getCatalog() {
    return ipcRenderer.invoke(IPC_CHANNELS.CATALOG_GET);
  },
  syncCatalog() {
    return ipcRenderer.invoke(IPC_CHANNELS.CATALOG_SYNC);
  },
  assignProductBarcode(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.CATALOG_ASSIGN_BARCODE, input);
  },
  createSaleAndPrint(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.SALE_CREATE_AND_PRINT, input);
  },
  listOrderHistory(limit?: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.ORDER_HISTORY_LIST, limit);
  },
  reprintOrder(orderId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.ORDER_REPRINT, orderId);
  },
  cancelOrder(orderId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.ORDER_CANCEL, orderId);
  },
  syncOutbox() {
    return ipcRenderer.invoke(IPC_CHANNELS.OUTBOX_SYNC);
  },
  getSyncStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.OUTBOX_SYNC_STATUS);
  },
  getOpenTabsSnapshot(eventId?: string | null) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_SNAPSHOT, eventId ?? null);
  },
  getOpenTabDetail(tabId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_DETAIL, tabId);
  },
  configureOpenTabsTables(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_CONFIGURE_TABLES, input);
  },
  listOpenTabsTables(eventId?: string | null) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_TABLES_LIST, eventId ?? null);
  },
  updateOpenTabsTable(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_TABLES_UPDATE, input);
  },
  toggleOpenTabsTable(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_TABLES_TOGGLE, input);
  },
  deleteOpenTabsTable(tableId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_TABLES_DELETE, tableId);
  },
  reorderOpenTabsTable(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_TABLES_REORDER, input);
  },
  openTab(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_OPEN, input);
  },
  addTabItem(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_ADD_ITEM, input);
  },
  updateTabLineQty(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_UPDATE_QTY, input);
  },
  removeTabLine(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_REMOVE_ITEM, input);
  },
  sendTabToKitchen(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_KITCHEN_SEND, input);
  },
  reprintKitchenRound(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_KITCHEN_REPRINT, input);
  },
  cancelKitchenRound(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_KITCHEN_CANCEL, input);
  },
  closeTabPaid(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_CLOSE_PAID, input);
  },
  cancelTab(tabId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_CANCEL, tabId);
  },
  syncOpenTabs(limit?: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_SYNC, limit);
  },
  isPosMaster() {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_TABS_IS_POS_MASTER);
  },
  getRuntimeConfig() {
    return ipcRenderer.invoke(IPC_CHANNELS.RUNTIME_CONFIG_GET);
  },
  setRuntimeConfig(input) {
    return ipcRenderer.invoke(IPC_CHANNELS.RUNTIME_CONFIG_SET, input);
  },
  onScannerData(listener: (reading: ScannerReading) => void) {
    const wrapped = (_event: IpcRendererEvent, reading: ScannerReading) => {
      listener(reading);
    };
    ipcRenderer.on(IPC_CHANNELS.SCANNER_DATA, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SCANNER_DATA, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('posKiosk', api);
