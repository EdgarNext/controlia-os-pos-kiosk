import type { RegionKey } from '../render/scheduler';
import type { AppState } from '../state/app-state';

export type ActionContext = {
  state: AppState;
  event: Event;
  actionKey: string;
  id: string;
  target: HTMLElement;
  invalidate: (region: RegionKey) => void;
  invalidateMany: (regions: RegionKey[]) => void;
  queueRender: (reason?: string, regionsToInvalidate?: RegionKey[]) => void;
  posKiosk: Window['posKiosk'];
  posScanner: Window['posScanner'];
  handlers: {
    activateDeviceClaimFlow: () => Promise<void>;
    loginPosUser: () => Promise<void>;
    loginPinNumpadInput: (value: string) => void;
    loginPinNumpadBackspace: () => void;
    loginPinNumpadClear: () => void;
    logoutPosUser: () => Promise<void>;
    closeSupervisorOverride: () => void;
    supervisorPinNumpadInput: (value: string) => void;
    supervisorPinNumpadBackspace: () => void;
    supervisorPinNumpadClear: () => void;
    submitSupervisorOverride: () => Promise<void>;
    toggleTheme: () => void;
    toggleRenderMetrics: () => void;
    activateTableMode: () => Promise<void>;
    deactivateTableMode: () => void;
    openTablesSettings: () => Promise<void>;
    closeTablesSettings: () => void;
    previewTablesGeneration: () => Promise<void>;
    confirmTablesGeneration: () => Promise<void>;
    saveTableName: (id: string) => Promise<void>;
    toggleTableActive: (id: string, isActive: boolean) => Promise<void>;
    deleteTableWithGuardrail: (id: string) => Promise<void>;
    reorderTable: (id: string, direction: 'up' | 'down') => Promise<void>;
    tableSelectMesa: () => void;
    tableSelectOption: (id: string) => void;
    confirmTableSelection: () => Promise<void>;
    tableCancelSelect: () => void;
    tableRefreshDetail: () => Promise<void>;
    openOpenTabsModal: () => Promise<void>;
    closeOpenTabsModal: () => void;
    configureOpenTabsTables: () => Promise<void>;
    openTabsSelectTable: (id: string) => void;
    openTabForSelectedTable: () => Promise<void>;
    openTabsSelectTab: (id: string) => Promise<void>;
    toggleOpenTabsSentLines: () => void;
    addItemToSelectedTab: (input?: { productId?: string; qty?: number }) => Promise<void>;
    openTabsLineDec: (id: string) => Promise<void>;
    openTabsLineInc: (id: string) => Promise<void>;
    removeTabLine: (id: string) => Promise<void>;
    sendSelectedTabToKitchen: () => Promise<void>;
    closeSelectedTabPaid: () => Promise<void>;
    cancelSelectedTab: () => Promise<void>;
    openBarcodeBinding: () => void;
    closeBarcodeBinding: () => void;
    openDeviceBinding: () => Promise<void>;
    closeDeviceBinding: () => void;
    resetDeviceBinding: () => Promise<void>;
    saveDeviceConfigToggles: () => Promise<void>;
    bindingFilterCategory: (id: string) => void;
    bindingSelectItem: (id: string) => void;
    syncCatalog: () => Promise<void>;
    openSettings: () => Promise<void>;
    openScannerDebug: () => Promise<void>;
    closeScannerDebug: () => void;
    refreshScannerDebugState: () => Promise<void>;
    copyScannerLogs: () => Promise<void>;
    saveScannerDebugSettings: () => Promise<void>;
    openPrinterDebug: () => Promise<void>;
    closePrinterDebug: () => void;
    refreshPrinterDiagnostics: () => Promise<void>;
    savePrinterDebugConfig: () => Promise<void>;
    refreshPrintJobs: () => Promise<void>;
    printTest: () => Promise<void>;
    printerSelfTest: () => Promise<void>;
    printerPrintCustomText: () => Promise<void>;
    copyPrinterDebugLogs: () => Promise<void>;
    openOrderHistory: () => Promise<void>;
    closeOrderHistory: () => void;
    openTabKitchenHistory: (id: string) => Promise<void>;
    closeTabKitchenHistory: () => void;
    reprintTabKitchenRound: (id: string) => Promise<void>;
    cancelTabKitchenRound: (id: string) => Promise<void>;
    refreshOrderHistory: () => Promise<void>;
    reprintOrderFromHistory: (id: string) => Promise<void>;
    cancelOrderFromHistory: (id: string) => Promise<void>;
    cancelTabFromHistory: (id: string) => Promise<void>;
    closeSettings: () => void;
    saveSettings: () => Promise<void>;
    selectCategory: (id: string) => void;
    addToCart: (id: string) => Promise<void>;
    increaseCartQty: (id: string) => void;
    decreaseCartQty: (id: string) => void;
    removeItem: (id: string) => void;
    clearCart: () => void;
    openCheckout: () => void;
    setCheckoutPaymentMethod: (methodRaw: string) => void;
    closeCheckout: () => void;
    checkoutNumpadInput: (value: string) => void;
    checkoutNumpadBackspace: () => void;
    checkoutNumpadClear: () => void;
    quickAmount: (valueRaw: string | undefined) => void;
    exactAmount: () => void;
    confirmSale: () => Promise<void>;
    syncOutbox: (manual?: boolean) => Promise<void>;
  };
  flags: {
    showOpenTabsDebug: boolean;
  };
};

export const actions: Record<string, (ctx: ActionContext) => Promise<void> | void> = {
  'activate-device-claim': async (ctx) => {
    await ctx.handlers.activateDeviceClaimFlow();
    ctx.invalidateMany(['gate:activation', 'gate:auth', 'status', 'modals']);
    ctx.queueRender('action:activate-device-claim');
  },
  'pos-login-submit': async (ctx) => {
    await ctx.handlers.loginPosUser();
    ctx.invalidateMany(['gate:auth', 'shell', 'status', 'modals']);
    ctx.queueRender('action:pos-login-submit');
  },
  'pos-login-pin-numpad-input': (ctx) => {
    const value = String(ctx.target.dataset.value || '');
    if (!value) return;
    ctx.handlers.loginPinNumpadInput(value);
    ctx.invalidate('gate:auth');
    ctx.queueRender('action:pos-login-pin-numpad-input');
  },
  'pos-login-pin-numpad-backspace': (ctx) => {
    ctx.handlers.loginPinNumpadBackspace();
    ctx.invalidate('gate:auth');
    ctx.queueRender('action:pos-login-pin-numpad-backspace');
  },
  'pos-login-pin-numpad-clear': (ctx) => {
    ctx.handlers.loginPinNumpadClear();
    ctx.invalidate('gate:auth');
    ctx.queueRender('action:pos-login-pin-numpad-clear');
  },
  'supervisor-override-cancel': (ctx) => {
    ctx.handlers.closeSupervisorOverride();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:supervisor-override-cancel');
  },
  'supervisor-pin-numpad-input': (ctx) => {
    const value = String(ctx.target.dataset.value || '');
    if (!value) return;
    ctx.handlers.supervisorPinNumpadInput(value);
    ctx.invalidate('modals');
    ctx.queueRender('action:supervisor-pin-numpad-input');
  },
  'supervisor-pin-numpad-backspace': (ctx) => {
    ctx.handlers.supervisorPinNumpadBackspace();
    ctx.invalidate('modals');
    ctx.queueRender('action:supervisor-pin-numpad-backspace');
  },
  'supervisor-pin-numpad-clear': (ctx) => {
    ctx.handlers.supervisorPinNumpadClear();
    ctx.invalidate('modals');
    ctx.queueRender('action:supervisor-pin-numpad-clear');
  },
  'supervisor-override-submit': async (ctx) => {
    await ctx.handlers.submitSupervisorOverride();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:supervisor-override-submit');
  },
  'pos-logout': async (ctx) => {
    await ctx.handlers.logoutPosUser();
    ctx.invalidateMany(['gate:auth', 'shell', 'status', 'modals']);
    ctx.queueRender('action:pos-logout');
  },
  'toggle-render-metrics': (ctx) => {
    ctx.handlers.toggleRenderMetrics();
    ctx.invalidate('status');
    ctx.queueRender('action:toggle-render-metrics');
  },
  'toggle-theme': (ctx) => {
    ctx.handlers.toggleTheme();
    ctx.invalidateMany(['shell', 'catalog', 'cart', 'status', 'modals', 'open-tabs', 'printer-debug']);
    ctx.queueRender('action:toggle-theme');
  },
  'toggle-table-mode': async (ctx) => {
    if (ctx.state.tableModeEnabled) ctx.handlers.deactivateTableMode();
    else await ctx.handlers.activateTableMode();
    ctx.invalidateMany(['shell', 'open-tabs', 'cart', 'status', 'modals']);
    ctx.queueRender('action:toggle-table-mode');
  },
  'open-tables-settings': async (ctx) => {
    await ctx.handlers.openTablesSettings();
    ctx.invalidateMany(['open-tabs', 'modals']);
    ctx.queueRender('action:open-tables-settings');
  },
  'close-tables-settings': (ctx) => {
    ctx.handlers.closeTablesSettings();
    ctx.invalidate('modals');
    ctx.queueRender('action:close-tables-settings');
  },
  'tables-generate-preview': async (ctx) => {
    await ctx.handlers.previewTablesGeneration();
    ctx.invalidate('modals');
    ctx.queueRender('action:tables-generate-preview');
  },
  'tables-generate-confirm': async (ctx) => {
    await ctx.handlers.confirmTablesGeneration();
    ctx.invalidateMany(['open-tabs', 'modals', 'status']);
    ctx.queueRender('action:tables-generate-confirm');
  },
  'tables-row-save': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.saveTableName(ctx.id);
    ctx.invalidateMany(['open-tabs', 'modals', 'status']);
    ctx.queueRender('action:tables-row-save');
  },
  'tables-row-toggle': async (ctx) => {
    if (!ctx.id) return;
    const active = ctx.target.dataset.active !== '1';
    await ctx.handlers.toggleTableActive(ctx.id, active);
    ctx.invalidateMany(['open-tabs', 'modals', 'status']);
    ctx.queueRender('action:tables-row-toggle');
  },
  'tables-row-delete': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.deleteTableWithGuardrail(ctx.id);
    ctx.invalidateMany(['open-tabs', 'modals', 'status']);
    ctx.queueRender('action:tables-row-delete');
  },
  'tables-row-up': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.reorderTable(ctx.id, 'up');
    ctx.invalidateMany(['open-tabs', 'modals', 'status']);
    ctx.queueRender('action:tables-row-up');
  },
  'tables-row-down': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.reorderTable(ctx.id, 'down');
    ctx.invalidateMany(['open-tabs', 'modals', 'status']);
    ctx.queueRender('action:tables-row-down');
  },
  'table-select-mesa': (ctx) => {
    ctx.handlers.tableSelectMesa();
    ctx.invalidateMany(['open-tabs', 'modals']);
    ctx.queueRender('action:table-select-mesa');
  },
  'table-select-option': (ctx) => {
    if (!ctx.id) return;
    ctx.handlers.tableSelectOption(ctx.id);
    ctx.invalidate('modals');
    ctx.queueRender('action:table-select-option');
  },
  'table-confirm-select': async (ctx) => {
    await ctx.handlers.confirmTableSelection();
    ctx.invalidateMany(['open-tabs', 'cart', 'status', 'modals']);
    ctx.queueRender('action:table-confirm-select');
  },
  'table-cancel-select': (ctx) => {
    ctx.handlers.tableCancelSelect();
    ctx.invalidateMany(['open-tabs', 'cart', 'modals']);
    ctx.queueRender('action:table-cancel-select');
  },
  'table-refresh-detail': async (ctx) => {
    await ctx.handlers.tableRefreshDetail();
    ctx.invalidateMany(['open-tabs', 'modals', 'status']);
    ctx.queueRender('action:table-refresh-detail');
  },
  'open-open-tabs': async (ctx) => {
    if (!ctx.flags.showOpenTabsDebug) return;
    await ctx.handlers.openOpenTabsModal();
    ctx.invalidateMany(['open-tabs', 'modals', 'status']);
    ctx.queueRender('action:open-open-tabs');
  },
  'open-tabs-close-modal': (ctx) => {
    if (!ctx.flags.showOpenTabsDebug) return;
    ctx.handlers.closeOpenTabsModal();
    ctx.invalidateMany(['open-tabs', 'modals']);
    ctx.queueRender('action:open-tabs-close-modal');
  },
  'open-tabs-configure': async (ctx) => {
    await ctx.handlers.configureOpenTabsTables();
    ctx.invalidateMany(['open-tabs', 'modals', 'status']);
    ctx.queueRender('action:open-tabs-configure');
  },
  'open-tabs-select-table': (ctx) => {
    if (!ctx.id) return;
    ctx.handlers.openTabsSelectTable(ctx.id);
    ctx.invalidate('open-tabs');
    ctx.queueRender('action:open-tabs-select-table');
  },
  'open-tabs-open-tab': async (ctx) => {
    await ctx.handlers.openTabForSelectedTable();
    ctx.invalidateMany(['open-tabs', 'cart', 'status', 'modals']);
    ctx.queueRender('action:open-tabs-open-tab');
  },
  'open-tabs-select-tab': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.openTabsSelectTab(ctx.id);
    ctx.invalidateMany(['open-tabs', 'cart', 'modals', 'status']);
    ctx.queueRender('action:open-tabs-select-tab');
  },
  'open-tabs-toggle-line-visibility': (ctx) => {
    ctx.handlers.toggleOpenTabsSentLines();
    ctx.invalidateMany(['open-tabs', 'cart']);
    ctx.queueRender('action:open-tabs-toggle-line-visibility');
  },
  'open-tabs-add-item': async (ctx) => {
    await ctx.handlers.addItemToSelectedTab();
    ctx.invalidateMany(['open-tabs', 'cart', 'status']);
    ctx.queueRender('action:open-tabs-add-item');
  },
  'open-tabs-line-dec': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.openTabsLineDec(ctx.id);
    ctx.invalidateMany(['open-tabs', 'cart', 'status']);
    ctx.queueRender('action:open-tabs-line-dec');
  },
  'open-tabs-line-inc': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.openTabsLineInc(ctx.id);
    ctx.invalidateMany(['open-tabs', 'cart', 'status']);
    ctx.queueRender('action:open-tabs-line-inc');
  },
  'open-tabs-line-remove': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.removeTabLine(ctx.id);
    ctx.invalidateMany(['open-tabs', 'cart', 'status']);
    ctx.queueRender('action:open-tabs-line-remove');
  },
  'open-tabs-send-kitchen': async (ctx) => {
    await ctx.handlers.sendSelectedTabToKitchen();
    ctx.invalidateMany(['open-tabs', 'status', 'modals']);
    ctx.queueRender('action:open-tabs-send-kitchen');
  },
  'open-tabs-close-paid': async (ctx) => {
    await ctx.handlers.closeSelectedTabPaid();
    ctx.invalidateMany(['open-tabs', 'cart', 'status', 'modals']);
    ctx.queueRender('action:open-tabs-close-paid');
  },
  'open-tabs-cancel-tab': async (ctx) => {
    await ctx.handlers.cancelSelectedTab();
    ctx.invalidateMany(['open-tabs', 'cart', 'status', 'modals']);
    ctx.queueRender('action:open-tabs-cancel-tab');
  },
  'open-barcode-binding': (ctx) => {
    ctx.handlers.openBarcodeBinding();
    ctx.invalidateMany(['catalog', 'modals', 'status']);
    ctx.queueRender('action:open-barcode-binding');
  },
  'close-barcode-binding': (ctx) => {
    ctx.handlers.closeBarcodeBinding();
    ctx.invalidateMany(['catalog', 'modals', 'status']);
    ctx.queueRender('action:close-barcode-binding');
  },
  'open-device-binding': async (ctx) => {
    await ctx.handlers.openDeviceBinding();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:open-device-binding');
  },
  'close-device-binding': (ctx) => {
    ctx.handlers.closeDeviceBinding();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:close-device-binding');
  },
  'reset-device-binding': async (ctx) => {
    await ctx.handlers.resetDeviceBinding();
    ctx.invalidateMany(['shell', 'modals', 'gate:activation', 'gate:auth', 'status']);
    ctx.queueRender('action:reset-device-binding');
  },
  'save-touch-screen-setting': async (ctx) => {
    await ctx.handlers.saveDeviceConfigToggles();
    ctx.invalidateMany(['modals', 'cart', 'status']);
    ctx.queueRender('action:save-touch-screen-setting');
  },
  'binding-filter-category': (ctx) => {
    ctx.handlers.bindingFilterCategory(ctx.id);
    ctx.invalidateMany(['catalog', 'modals']);
    ctx.queueRender('action:binding-filter-category');
  },
  'binding-select-item': (ctx) => {
    if (!ctx.id) return;
    ctx.handlers.bindingSelectItem(ctx.id);
    ctx.invalidateMany(['catalog', 'modals', 'status']);
    ctx.queueRender('action:binding-select-item');
  },
  'sync-catalog': async (ctx) => {
    await ctx.handlers.syncCatalog();
    ctx.invalidateMany(['catalog', 'cart', 'status', 'modals']);
    ctx.queueRender('action:sync-catalog');
  },
  'open-settings': async (ctx) => {
    await ctx.handlers.openSettings();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:open-settings');
  },
  'scanner-debug-open': async (ctx) => {
    await ctx.handlers.openScannerDebug();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:scanner-debug-open');
  },
  'scanner-debug-close': (ctx) => {
    ctx.handlers.closeScannerDebug();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:scanner-debug-close');
  },
  'scanner-debug-refresh': async (ctx) => {
    await ctx.handlers.refreshScannerDebugState();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:scanner-debug-refresh');
  },
  'scanner-debug-copy': async (ctx) => {
    await ctx.handlers.copyScannerLogs();
    ctx.invalidate('status');
    ctx.queueRender('action:scanner-debug-copy');
  },
  'scanner-debug-save-settings': async (ctx) => {
    await ctx.handlers.saveScannerDebugSettings();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:scanner-debug-save-settings');
  },
  'printer-debug-open': async (ctx) => {
    await ctx.handlers.openPrinterDebug();
    ctx.invalidateMany(['printer-debug', 'status', 'modals']);
    ctx.queueRender('action:printer-debug-open');
  },
  'printer-debug-close': (ctx) => {
    ctx.handlers.closePrinterDebug();
    ctx.invalidateMany(['printer-debug', 'status', 'modals']);
    ctx.queueRender('action:printer-debug-close');
  },
  'printer-debug-refresh': async (ctx) => {
    await ctx.handlers.refreshPrinterDiagnostics();
    ctx.invalidateMany(['printer-debug', 'status', 'modals']);
    ctx.queueRender('action:printer-debug-refresh');
  },
  'printer-debug-save-config': async (ctx) => {
    await ctx.handlers.savePrinterDebugConfig();
    ctx.invalidateMany(['printer-debug', 'status', 'modals']);
    ctx.queueRender('action:printer-debug-save-config');
  },
  'printer-debug-refresh-jobs': async (ctx) => {
    await ctx.handlers.refreshPrintJobs();
    ctx.invalidateMany(['printer-debug', 'status', 'modals']);
    ctx.queueRender('action:printer-debug-refresh-jobs');
  },
  'printer-debug-self-test': async (ctx) => {
    await ctx.handlers.printerSelfTest();
    ctx.invalidateMany(['printer-debug', 'status', 'modals']);
    ctx.queueRender('action:printer-debug-self-test');
  },
  'printer-debug-print-text': async (ctx) => {
    await ctx.handlers.printerPrintCustomText();
    ctx.invalidateMany(['printer-debug', 'status', 'modals']);
    ctx.queueRender('action:printer-debug-print-text');
  },
  'printer-debug-copy-logs': async (ctx) => {
    await ctx.handlers.copyPrinterDebugLogs();
    ctx.invalidate('status');
    ctx.queueRender('action:printer-debug-copy-logs');
  },
  'open-order-history': async (ctx) => {
    await ctx.handlers.openOrderHistory();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:open-order-history');
  },
  'close-order-history': (ctx) => {
    ctx.handlers.closeOrderHistory();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:close-order-history');
  },
  'tab-kitchen-history': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.openTabKitchenHistory(ctx.id);
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:tab-kitchen-history');
  },
  'close-tab-kitchen-history': (ctx) => {
    ctx.handlers.closeTabKitchenHistory();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:close-tab-kitchen-history');
  },
  'tab-round-reprint': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.reprintTabKitchenRound(ctx.id);
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:tab-round-reprint');
  },
  'tab-round-cancel': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.cancelTabKitchenRound(ctx.id);
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:tab-round-cancel');
  },
  'history-refresh': async (ctx) => {
    await ctx.handlers.refreshOrderHistory();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:history-refresh');
  },
  'order-reprint': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.reprintOrderFromHistory(ctx.id);
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:order-reprint');
  },
  'order-cancel': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.cancelOrderFromHistory(ctx.id);
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:order-cancel');
  },
  'tab-cancel-from-history': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.cancelTabFromHistory(ctx.id);
    ctx.invalidateMany(['shell', 'open-tabs', 'cart', 'modals', 'status']);
    ctx.queueRender('action:tab-cancel-from-history');
  },
  'close-settings': (ctx) => {
    ctx.handlers.closeSettings();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:close-settings');
  },
  'settings-save-all': async (ctx) => {
    await ctx.handlers.saveSettings();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:settings-save-all');
  },
  'settings-refresh-all': async (ctx) => {
    await ctx.handlers.openSettings();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:settings-refresh-all');
  },
  'settings-refresh-jobs': async (ctx) => {
    await ctx.handlers.refreshPrintJobs();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:settings-refresh-jobs');
  },
  'settings-print-test': async (ctx) => {
    await ctx.handlers.printTest();
    ctx.invalidateMany(['modals', 'status']);
    ctx.queueRender('action:settings-print-test');
  },
  'select-category': (ctx) => {
    if (!ctx.id) return;
    ctx.handlers.selectCategory(ctx.id);
    ctx.invalidate('catalog');
    ctx.queueRender('action:select-category');
  },
  'add-to-cart': async (ctx) => {
    if (!ctx.id) return;
    await ctx.handlers.addToCart(ctx.id);
    const cartEl = document.getElementById('region-cart');
    if (cartEl) {
      cartEl.classList.remove('is-add-pulse');
      // Reflow para reiniciar animacion en taps consecutivos.
      void cartEl.offsetWidth;
      cartEl.classList.add('is-add-pulse');
      window.setTimeout(() => {
        cartEl.classList.remove('is-add-pulse');
      }, 120);
    }
    ctx.invalidateMany(['cart', 'status']);
    ctx.queueRender('action:add-to-cart');
  },
  'cart:increase-qty': (ctx) => {
    if (!ctx.id) return;
    ctx.handlers.increaseCartQty(ctx.id);
    ctx.invalidateMany(['cart', 'status']);
    ctx.queueRender('action:cart:increase-qty');
  },
  'cart:decrease-qty': (ctx) => {
    if (!ctx.id) return;
    ctx.handlers.decreaseCartQty(ctx.id);
    ctx.invalidateMany(['cart', 'status']);
    ctx.queueRender('action:cart:decrease-qty');
  },
  'remove-item': (ctx) => {
    if (!ctx.id) return;
    ctx.handlers.removeItem(ctx.id);
    ctx.invalidateMany(['cart', 'status']);
    ctx.queueRender('action:remove-item');
  },
  'clear-cart': (ctx) => {
    ctx.handlers.clearCart();
    ctx.invalidateMany(['cart', 'status', 'modals']);
    ctx.queueRender('action:clear-cart');
  },
  'open-checkout': (ctx) => {
    ctx.handlers.openCheckout();
    ctx.invalidateMany(['cart', 'modals', 'status']);
    ctx.queueRender('action:open-checkout');
  },
  'set-checkout-payment': (ctx) => {
    const value = String(ctx.target.dataset.value || '');
    if (!value) return;
    ctx.handlers.setCheckoutPaymentMethod(value);
    ctx.invalidateMany(['cart', 'modals']);
    ctx.queueRender('action:set-checkout-payment');
  },
  'checkout-numpad-input': (ctx) => {
    const value = String(ctx.target.dataset.value || '');
    if (!value) return;
    ctx.handlers.checkoutNumpadInput(value);
    ctx.invalidateMany(['cart', 'modals']);
    ctx.queueRender('action:checkout-numpad-input');
  },
  'checkout-numpad-backspace': (ctx) => {
    ctx.handlers.checkoutNumpadBackspace();
    ctx.invalidateMany(['cart', 'modals']);
    ctx.queueRender('action:checkout-numpad-backspace');
  },
  'checkout-numpad-clear': (ctx) => {
    ctx.handlers.checkoutNumpadClear();
    ctx.invalidateMany(['cart', 'modals']);
    ctx.queueRender('action:checkout-numpad-clear');
  },
  'cancel-checkout': (ctx) => {
    ctx.handlers.closeCheckout();
    ctx.invalidateMany(['cart', 'modals', 'status']);
    ctx.queueRender('action:cancel-checkout');
  },
  'quick-amount': (ctx) => {
    ctx.handlers.quickAmount(ctx.target.dataset.value);
    ctx.invalidateMany(['cart', 'modals']);
    ctx.queueRender('action:quick-amount');
  },
  'exact-amount': (ctx) => {
    ctx.handlers.exactAmount();
    ctx.invalidateMany(['cart', 'modals']);
    ctx.queueRender('action:exact-amount');
  },
  'confirm-sale': async (ctx) => {
    await ctx.handlers.confirmSale();
    ctx.invalidateMany(['cart', 'modals', 'status']);
    ctx.queueRender('action:confirm-sale');
  },
  'sync-outbox': async (ctx) => {
    await ctx.handlers.syncOutbox(true);
    ctx.invalidateMany(['status', 'modals']);
    ctx.queueRender('action:sync-outbox');
  },
};
