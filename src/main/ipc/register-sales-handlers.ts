import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type {
  CancelOrderResult,
  CreateSaleInput,
  CreateSaleResult,
  OrderHistoryRecord,
  OutboxSyncResult,
  OutboxSyncStatus,
  ReprintOrderResult,
  RuntimeConfig,
} from '../../shared/orders';
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
  PosTableView,
  ReorderPosTableInput,
  RemoveTabLineInput,
  SyncMutationsResult,
  TabCloseResult,
  TabDetailView,
  TabMutationResult,
  TogglePosTableInput,
  UpdatePosTableInput,
  UpdateTabLineQtyInput,
} from '../../shared/open-tabs';
import { OrdersRepository } from '../orders/orders-repository';
import { SalesService } from '../orders/sales-service';
import { OpenTabsAppService } from '../sales-pos/open-tabs-app-service';

export function registerSalesHandlers(
  ordersRepository: OrdersRepository,
  salesService: SalesService,
  openTabsAppService: OpenTabsAppService,
): void {
  const createSaleHandler = async (_event: unknown, input: CreateSaleInput): Promise<CreateSaleResult> => {
    return salesService.createSaleAndPrint(input);
  };

  ipcMain.handle(
    IPC_CHANNELS.SALE_CREATE_AND_PRINT,
    createSaleHandler,
  );

  // Backward-compat typo channel from older renderer bundles.
  ipcMain.handle('pos:sale:create-amd-print', createSaleHandler);

  ipcMain.handle(IPC_CHANNELS.ORDER_HISTORY_LIST, async (_event, limit?: number): Promise<OrderHistoryRecord[]> => {
    return salesService.listOrderHistory(limit);
  });

  ipcMain.handle(IPC_CHANNELS.ORDER_REPRINT, async (_event, orderId: string): Promise<ReprintOrderResult> => {
    return salesService.reprintOrder(orderId);
  });

  ipcMain.handle(IPC_CHANNELS.ORDER_CANCEL, async (_event, orderId: string): Promise<CancelOrderResult> => {
    return salesService.cancelOrder(orderId);
  });

  ipcMain.handle(IPC_CHANNELS.OUTBOX_SYNC, async (): Promise<OutboxSyncResult> => {
    const tabs = await openTabsAppService.syncMutations(200);

    const processed = tabs.processed;
    const sent = tabs.acked;
    const failed = tabs.failed + tabs.conflicts;
    const pendingLegacy = 0;
    const pendingTabs = tabs.pending;
    const pending = pendingLegacy + pendingTabs;
    const ok = tabs.ok;
    const error = tabs.error;

    return {
      ok,
      processed,
      sent,
      failed,
      pending,
      processedLegacy: 0,
      sentLegacy: 0,
      failedLegacy: 0,
      pendingLegacy,
      processedTabs: tabs.processed,
      sentTabs: tabs.acked,
      failedTabs: tabs.failed,
      conflictsTabs: tabs.conflicts,
      pendingTabs,
      lastSyncedAt: new Date().toISOString(),
      error,
    };
  });

  ipcMain.handle(IPC_CHANNELS.OUTBOX_SYNC_STATUS, async (): Promise<OutboxSyncStatus> => {
    const pendingLegacy = 0;
    const pendingTabs = openTabsAppService.countPendingMutations();
    return {
      pendingLegacy,
      pendingTabs,
      pendingTotal: pendingLegacy + pendingTabs,
    };
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_SNAPSHOT, async (_event, eventId?: string | null): Promise<OpenTabsSnapshot> => {
    return openTabsAppService.getSnapshot(eventId);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_DETAIL, async (_event, tabId: string): Promise<TabDetailView> => {
    return openTabsAppService.getTabDetail(tabId);
  });

  ipcMain.handle(
    IPC_CHANNELS.OPEN_TABS_CONFIGURE_TABLES,
    async (_event, input: ConfigureOpenTabsTablesInput): Promise<ConfigureOpenTabsTablesResult> => {
      return openTabsAppService.configureTables(input || {});
    },
  );

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_TABLES_LIST, async (_event, eventId?: string | null): Promise<PosTableView[]> => {
    return openTabsAppService.listTables(eventId);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_TABLES_UPDATE, async (_event, input: UpdatePosTableInput): Promise<PosTableCrudResult> => {
    return openTabsAppService.updateTable(input);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_TABLES_TOGGLE, async (_event, input: TogglePosTableInput): Promise<PosTableCrudResult> => {
    return openTabsAppService.toggleTable(input);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_TABLES_DELETE, async (_event, tableId: string): Promise<PosTableCrudResult> => {
    return openTabsAppService.deleteTable(tableId);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_TABLES_REORDER, async (_event, input: ReorderPosTableInput): Promise<PosTableCrudResult> => {
    return openTabsAppService.reorderTable(input);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_OPEN, async (_event, input: OpenTabInput): Promise<OpenTabResult> => {
    return openTabsAppService.openTab(input || {});
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_ADD_ITEM, async (_event, input: AddTabItemInput): Promise<TabMutationResult> => {
    return openTabsAppService.addItem(input);
  });

  ipcMain.handle(
    IPC_CHANNELS.OPEN_TABS_UPDATE_QTY,
    async (_event, input: UpdateTabLineQtyInput): Promise<TabMutationResult> => {
      return openTabsAppService.updateQty(input);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.OPEN_TABS_REMOVE_ITEM,
    async (_event, input: RemoveTabLineInput): Promise<TabMutationResult> => {
      return openTabsAppService.removeItem(input);
    },
  );

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_KITCHEN_SEND, async (_event, input: KitchenSendInput): Promise<KitchenSendResult> => {
    return openTabsAppService.kitchenSend(input);
  });

  ipcMain.handle(
    IPC_CHANNELS.OPEN_TABS_KITCHEN_REPRINT,
    async (_event, input: TabKitchenRoundActionInput): Promise<TabKitchenRoundActionResult> => {
      return openTabsAppService.reprintKitchenRound(input);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.OPEN_TABS_KITCHEN_CANCEL,
    async (_event, input: TabKitchenRoundCancelInput): Promise<TabKitchenRoundActionResult> => {
      return openTabsAppService.cancelKitchenRound(input);
    },
  );

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_CLOSE_PAID, async (_event, input: CloseTabPaidInput): Promise<TabCloseResult> => {
    return openTabsAppService.closeTabPaid(input);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_CANCEL, async (_event, tabId: string): Promise<TabMutationResult> => {
    return openTabsAppService.cancelTab(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_SYNC, async (_event, limit?: number): Promise<SyncMutationsResult> => {
    return openTabsAppService.syncMutations(limit);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_TABS_IS_POS_MASTER, async (): Promise<boolean> => {
    return openTabsAppService.isPosMaster();
  });

  ipcMain.handle(IPC_CHANNELS.RUNTIME_CONFIG_GET, async (): Promise<RuntimeConfig> => {
    return ordersRepository.getRuntimeConfig();
  });

  ipcMain.handle(
    IPC_CHANNELS.RUNTIME_CONFIG_SET,
    async (_event, input: Partial<RuntimeConfig>): Promise<RuntimeConfig> => {
      return ordersRepository.setRuntimeConfig(input || {});
    },
  );
}
