import type { PrintConfig, PrintJobRecord, PrintV2Request, PrintV2Response } from './print-v2';
import type {
  AssignBarcodeInput,
  AssignBarcodeResult,
  CatalogSnapshot,
  CatalogSyncResult,
} from './catalog';
import type {
  CancelOrderResult,
  CreateSaleInput,
  CreateSaleResult,
  OrderHistoryRecord,
  OutboxSyncResult,
  OutboxSyncStatus,
  ReprintOrderResult,
  RuntimeConfig,
} from './orders';
import type { ScannerReading } from './scanner';
import type {
  AddTabItemInput,
  CloseTabPaidInput,
  ConfigureOpenTabsTablesInput,
  ConfigureOpenTabsTablesResult,
  KitchenSendInput,
  KitchenSendResult,
  TabKitchenRoundActionInput,
  TabKitchenRoundActionResult,
  TabKitchenRoundCancelInput,
  OpenTabInput,
  OpenTabResult,
  OpenTabsSnapshot,
  PosTableCrudResult,
  ReorderPosTableInput,
  RemoveTabLineInput,
  SyncMutationsResult,
  TabCloseResult,
  TabDetailView,
  TabMutationResult,
  TogglePosTableInput,
  UpdatePosTableInput,
  UpdateTabLineQtyInput,
} from './open-tabs';

export interface PosKioskElectronApi {
  printV2(request: PrintV2Request): Promise<PrintV2Response>;
  listPrintJobs(limit?: number): Promise<PrintJobRecord[]>;
  getPrintConfig(): Promise<PrintConfig>;
  setPrintConfig(input: Partial<PrintConfig>): Promise<PrintConfig>;
  getCatalog(): Promise<CatalogSnapshot>;
  syncCatalog(): Promise<CatalogSyncResult>;
  assignProductBarcode(input: AssignBarcodeInput): Promise<AssignBarcodeResult>;
  createSaleAndPrint(input: CreateSaleInput): Promise<CreateSaleResult>;
  listOrderHistory(limit?: number): Promise<OrderHistoryRecord[]>;
  reprintOrder(orderId: string): Promise<ReprintOrderResult>;
  cancelOrder(orderId: string): Promise<CancelOrderResult>;
  syncOutbox(): Promise<OutboxSyncResult>;
  getSyncStatus(): Promise<OutboxSyncStatus>;
  getOpenTabsSnapshot(eventId?: string | null): Promise<OpenTabsSnapshot>;
  getOpenTabDetail(tabId: string): Promise<TabDetailView>;
  configureOpenTabsTables(input: ConfigureOpenTabsTablesInput): Promise<ConfigureOpenTabsTablesResult>;
  listOpenTabsTables(eventId?: string | null): Promise<OpenTabsSnapshot['tables']>;
  updateOpenTabsTable(input: UpdatePosTableInput): Promise<PosTableCrudResult>;
  toggleOpenTabsTable(input: TogglePosTableInput): Promise<PosTableCrudResult>;
  deleteOpenTabsTable(tableId: string): Promise<PosTableCrudResult>;
  reorderOpenTabsTable(input: ReorderPosTableInput): Promise<PosTableCrudResult>;
  openTab(input: OpenTabInput): Promise<OpenTabResult>;
  addTabItem(input: AddTabItemInput): Promise<TabMutationResult>;
  updateTabLineQty(input: UpdateTabLineQtyInput): Promise<TabMutationResult>;
  removeTabLine(input: RemoveTabLineInput): Promise<TabMutationResult>;
  sendTabToKitchen(input: KitchenSendInput): Promise<KitchenSendResult>;
  reprintKitchenRound(input: TabKitchenRoundActionInput): Promise<TabKitchenRoundActionResult>;
  cancelKitchenRound(input: TabKitchenRoundCancelInput): Promise<TabKitchenRoundActionResult>;
  closeTabPaid(input: CloseTabPaidInput): Promise<TabCloseResult>;
  cancelTab(tabId: string): Promise<TabMutationResult>;
  syncOpenTabs(limit?: number): Promise<SyncMutationsResult>;
  isPosMaster(): Promise<boolean>;
  getRuntimeConfig(): Promise<RuntimeConfig>;
  setRuntimeConfig(input: Partial<RuntimeConfig>): Promise<RuntimeConfig>;
  onScannerData(listener: (reading: ScannerReading) => void): () => void;
}
