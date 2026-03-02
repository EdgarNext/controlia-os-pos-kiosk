import type {
  PrintConfig,
  PrinterDebugTextOptions,
  PrinterDiagnostics,
  PrintJobRecord,
  PrintV2Request,
  PrintV2Response,
} from './print-v2';
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
  DeviceActivationState,
  DeviceBindingInfo,
  DeviceBindingResetResult,
  DeviceClaimActivateInput,
  DeviceClaimActivateResult,
  OrderHistoryRecord,
  OutboxSyncResult,
  OutboxSyncStatus,
  PosLoginInput,
  PosLoginResult,
  PosSessionView,
  PosUserView,
  ReprintOrderResult,
  RuntimeConfig,
  SupervisorOverrideInput,
  SupervisorOverrideResult,
} from './orders';
import type {
  HidScannerSettings,
  ScanCaptureDebugState,
  ScanContext,
  ScannerReading,
} from './scanner';
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
  printerGetDiagnostics(): Promise<PrinterDiagnostics>;
  printerPrintSelfTest(input?: { includeDebugFooter?: boolean }): Promise<PrintV2Response>;
  printerPrintText(text: string, options?: PrinterDebugTextOptions): Promise<PrintV2Response>;
  getCatalog(): Promise<CatalogSnapshot>;
  syncCatalog(): Promise<CatalogSyncResult>;
  assignProductBarcode(input: AssignBarcodeInput): Promise<AssignBarcodeResult>;
  createSaleAndPrint(input: CreateSaleInput): Promise<CreateSaleResult>;
  listOrderHistory(limit?: number): Promise<OrderHistoryRecord[]>;
  reprintOrder(orderId: string): Promise<ReprintOrderResult>;
  cancelOrder(orderId: string): Promise<CancelOrderResult>;
  syncOutbox(mode?: 'manual' | 'auto' | 'sale'): Promise<OutboxSyncResult>;
  getSyncStatus(): Promise<OutboxSyncStatus>;
  onOutboxStatus(listener: (status: OutboxSyncStatus) => void): () => void;
  getDebugState(): Promise<{ events: Array<{ ts: string; event: string; data?: Record<string, unknown> }>; status: OutboxSyncStatus }>;
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
  activateDeviceClaim(input: DeviceClaimActivateInput): Promise<DeviceClaimActivateResult>;
  getDeviceActivationState(): Promise<DeviceActivationState>;
  getDeviceBindingInfo(): Promise<DeviceBindingInfo>;
  resetDeviceBinding(): Promise<DeviceBindingResetResult>;
  listPosUsers(): Promise<PosUserView[]>;
  loginPosUser(input: PosLoginInput): Promise<PosLoginResult>;
  logoutPosUser(): Promise<{ ok: boolean }>;
  getPosSession(): Promise<PosSessionView | null>;
  touchPosSession(): Promise<PosSessionView | null>;
  supervisorOverride(input: SupervisorOverrideInput): Promise<SupervisorOverrideResult>;
  onScannerData(listener: (reading: ScannerReading) => void): () => void;
}

export interface PosScannerElectronApi {
  onScan(listener: (reading: ScannerReading) => void): () => void;
  setContext(context: Partial<ScanContext>): Promise<ScanContext>;
  setEnabled(enabled: boolean): Promise<ScanContext>;
  setSettings(input: Partial<HidScannerSettings>): Promise<HidScannerSettings>;
  getDebugState(): Promise<ScanCaptureDebugState>;
}
