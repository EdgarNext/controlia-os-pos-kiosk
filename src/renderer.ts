import './index.css';
import type { CatalogCategory, CatalogItem, CatalogSnapshot } from './shared/catalog';
import type { OrderHistoryRecord, RuntimeConfig } from './shared/orders';
import type { PrintConfig, PrintJobRecord } from './shared/print-v2';
import type {
  HidScannerSettings,
  ScanCaptureDebugState,
  ScanContextMode,
  ScannerReading,
} from './shared/scanner';
import type { OpenTabsSnapshot, TabDetailView } from './shared/open-tabs';

interface CartLine {
  item: CatalogItem;
  qty: number;
}

type StatusBarPhase = 'idle' | 'working' | 'ok' | 'warn' | 'error';

interface UiRefs {
  initialized: boolean;
  topbarSubtitle: HTMLElement | null;
  headerActions: HTMLElement | null;
  categoriesRegion: HTMLElement | null;
  productsRegion: HTMLElement | null;
  cartRegion: HTMLElement | null;
  modalsRegion: HTMLElement | null;
  bottomStatusRegion: HTMLElement | null;
}

interface RenderRuntime {
  scheduled: boolean;
  frameId: number | null;
  reasons: Set<string>;
  regionSignature: Record<'header' | 'categories' | 'products' | 'cart' | 'modals' | 'statusbar', string>;
  metricsEnabled: boolean;
  metrics: Record<'header' | 'categories' | 'products' | 'cart' | 'modals' | 'statusbar', { count: number; totalMs: number }>;
}

const app = document.getElementById('app');
if (!app) throw new Error('Renderer root #app not found');

const ENTER_CONFIRM_WINDOW_MS = 1500;
const SHOW_OPEN_TABS_DEBUG = false;
type SettingsPendingAction = 'load' | 'save' | 'print-test' | 'refresh-jobs' | null;

const state = {
  snapshot: null as CatalogSnapshot | null,
  activeCategoryId: '' as string,
  barcodeBindingOpen: false,
  barcodeBindingCategoryId: '' as string,
  barcodeBindingSearch: '',
  barcodeBindingSelectedItemId: '' as string,
  barcodeBindingBusy: false,
  barcodeBindingStatusMessage: 'Selecciona un producto y escanea una etiqueta.' as string,
  barcodeBindingStatusKind: 'info' as 'info' | 'success' | 'error',
  cartQtyByItemId: new Map<string, number>(),
  checkoutOpen: false,
  receivedInput: '',
  enterConfirmArmedAt: null as number | null,
  settingsOpen: false,
  settingsStatusMessage: 'Listo para configurar.' as string,
  settingsStatusKind: 'info' as 'info' | 'success' | 'error',
  settingsPendingAction: null as SettingsPendingAction,
  ordersHistoryOpen: false,
  ordersHistory: [] as OrderHistoryRecord[],
  ordersHistoryLoading: false,
  ordersHistoryActionBusy: false,
  ordersHistoryStatusMessage: 'Selecciona una orden para reimprimir o cancelar.' as string,
  ordersHistoryStatusKind: 'info' as 'info' | 'success' | 'error',
  tabKitchenHistoryOpen: false,
  tabKitchenHistoryLoading: false,
  tabKitchenHistoryBusy: false,
  tabKitchenHistoryTabId: '' as string,
  tabKitchenHistoryDetail: null as TabDetailView | null,
  tabKitchenHistoryStatusMessage: 'Selecciona una comanda para operar.' as string,
  tabKitchenHistoryStatusKind: 'info' as 'info' | 'success' | 'error',
  printConfig: null as PrintConfig | null,
  runtimeConfig: null as RuntimeConfig | null,
  printJobs: [] as PrintJobRecord[],
  busy: false,
  status: 'Listo.' as string,
  statusKind: 'info' as 'info' | 'success' | 'error',
  scanCaptureEnabled: true,
  scanCaptureMode: 'sale' as ScanContextMode,
  scanCaptureSensitiveFocusCount: 0,
  scannerDebugOpen: false,
  scannerDebugState: null as ScanCaptureDebugState | null,
  scannerDebugLoading: false,
  openTabsOpen: false,
  openTabsLoading: false,
  openTabsBusy: false,
  openTabsStatusMessage: 'Listo para operar mesas VIP.' as string,
  openTabsStatusKind: 'info' as 'info' | 'success' | 'error',
  openTabsSnapshot: { tables: [], tabs: [] } as OpenTabsSnapshot,
  openTabsSelectedTableId: '' as string,
  openTabsSelectedTabId: '' as string,
  openTabsDetail: null as TabDetailView | null,
  openTabsSelectedProductId: '' as string,
  openTabsQtyInput: '1',
  openTabsNotesInput: '',
  openTabsGenerateCountInput: '12',
  openTabsGeneratePrefixInput: 'Mesa',
  openTabsGenerateStartAtInput: '1',
  openTabsPaymentMethod: 'efectivo' as 'efectivo' | 'tarjeta',
  openTabsForceRefresh: false,
  openTabsIsPosMaster: false,
  tableModeEnabled: false,
  tableSelectorOpen: false,
  tableSelectorSelectedTableId: '' as string,
  checkoutPaymentMethod: 'efectivo' as 'efectivo' | 'tarjeta',
  tablesSettingsOpen: false,
  tablesSettingsLoading: false,
  tablesSettingsBusy: false,
  tablesSettingsRows: [] as OpenTabsSnapshot['tables'],
  tablesSettingsPreview: '',
  tablesSettingsConfirmText: '',
  tablesSettingsGeneratePrefix: 'Mesa',
  tablesSettingsGenerateCount: '12',
  tablesSettingsGenerateStartAt: '1',
  syncPendingLegacy: 0,
  syncPendingTabs: 0,
  syncPendingTotal: 0,
  syncLastAt: null as string | null,
  syncLastError: '' as string,
  manualSync: {
    inFlight: false,
    lastError: '' as string,
    lastResultAt: null as string | null,
  },
  autoSync: {
    phase: 'idle' as 'idle' | 'syncing' | 'retrying' | 'error' | 'ok',
    pendingTotal: 0,
    lastOkAt: null as string | null,
    lastErrorShort: '' as string,
  },
  statusBar: {
    sync: {
      phase: 'idle' as StatusBarPhase,
      pendingTotal: 0,
      lastOkAt: null as string | null,
      lastErrorShort: '' as string,
    },
    scanner: {
      phase: 'ok' as StatusBarPhase,
      lastCode: '' as string,
      lastAt: null as string | null,
    },
    print: {
      phase: 'idle' as StatusBarPhase,
      lastErrorShort: '' as string,
    },
    runtime: {
      modeMesa: false,
      kioskLabel: '' as string,
      folioHint: '' as string,
    },
  },
};

const ui: UiRefs = {
  initialized: false,
  topbarSubtitle: null,
  headerActions: null,
  categoriesRegion: null,
  productsRegion: null,
  cartRegion: null,
  modalsRegion: null,
  bottomStatusRegion: null,
};

const renderRuntime: RenderRuntime = {
  scheduled: false,
  frameId: null,
  reasons: new Set<string>(),
  regionSignature: {
    header: '',
    categories: '',
    products: '',
    cart: '',
    modals: '',
    statusbar: '',
  },
  metricsEnabled: false,
  metrics: {
    header: { count: 0, totalMs: 0 },
    categories: { count: 0, totalMs: 0 },
    products: { count: 0, totalMs: 0 },
    cart: { count: 0, totalMs: 0 },
    modals: { count: 0, totalMs: 0 },
    statusbar: { count: 0, totalMs: 0 },
  },
};

const derivedCache = {
  visibleItemsKey: '',
  visibleItems: [] as CatalogItem[],
  barcodeBindingKey: '',
  barcodeBindingItems: [] as CatalogItem[],
  cartLinesKey: '',
  cartLines: [] as CartLine[],
};

function resetDerivedCache(): void {
  derivedCache.visibleItemsKey = '';
  derivedCache.visibleItems = [];
  derivedCache.barcodeBindingKey = '';
  derivedCache.barcodeBindingItems = [];
  derivedCache.cartLinesKey = '';
  derivedCache.cartLines = [];
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function queueRender(reason = 'state-change'): void {
  renderRuntime.reasons.add(reason);
  if (renderRuntime.scheduled) return;
  renderRuntime.scheduled = true;
  renderRuntime.frameId = requestAnimationFrame(() => {
    renderRuntime.scheduled = false;
    renderRuntime.frameId = null;
    flushRender();
    renderRuntime.reasons.clear();
  });
}

function renderRegion(name: keyof RenderRuntime['metrics'], fn: () => void): void {
  if (!renderRuntime.metricsEnabled) {
    fn();
    return;
  }
  const t0 = performance.now();
  fn();
  const elapsed = performance.now() - t0;
  renderRuntime.metrics[name].count += 1;
  renderRuntime.metrics[name].totalMs += elapsed;
}

function setStatus(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  state.status = message;
  state.statusKind = kind;
  queueRender('status-update');
}

function getScanModeByUiState(): ScanContextMode {
  if (state.barcodeBindingOpen) return 'assign';
  if (state.settingsOpen || state.ordersHistoryOpen || state.tabKitchenHistoryOpen || state.checkoutOpen) return 'disabled';
  return 'sale';
}

function resolveRuntimeConfigDefaults(): RuntimeConfig {
  return {
    tenantId: null,
    kioskId: null,
    kioskNumber: null,
    tenantSlug: null,
    deviceId: null,
    deviceSecret: null,
    scannerMode: 'hid',
    scannerMinCodeLen: 6,
    scannerMaxCodeLen: 64,
    scannerMaxInterKeyMsScan: 35,
    scannerScanEndGapMs: 80,
    scannerHumanKeyGapMs: 100,
    scannerAllowEnterTerminator: true,
    scannerAllowedCharsPattern: '[0-9A-Za-z\\-_.]',
  };
}

function runtimeScannerSettingsToInput(runtime: RuntimeConfig | null): Partial<HidScannerSettings> {
  if (!runtime) return {};
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

async function applyScanContext(): Promise<void> {
  const mode = getScanModeByUiState();
  state.scanCaptureMode = mode;
  const enabled = state.scanCaptureSensitiveFocusCount <= 0 && mode !== 'disabled';
  state.scanCaptureEnabled = enabled;
  await window.posScanner.setContext({
    enabled,
    mode,
    selectedProductId: state.barcodeBindingSelectedItemId || null,
  });
}

async function refreshScannerDebugState(): Promise<void> {
  state.scannerDebugLoading = true;
  render();
  try {
    state.scannerDebugState = await window.posScanner.getDebugState();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'No se pudo cargar scanner debug.', 'error');
  } finally {
    state.scannerDebugLoading = false;
    render();
  }
}

function playScanFeedback(): void {
  try {
    const audio = new Audio(
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    );
    void audio.play();
  } catch {
    // optional best-effort beep
  }
}

function getCategories(): CatalogCategory[] {
  return state.snapshot?.categories || [];
}

function getItems(): CatalogItem[] {
  return state.snapshot?.items || [];
}

function findItemByBarcode(barcodeRaw: string): CatalogItem | null {
  const normalized = String(barcodeRaw || '').replace(/[\r\n\t]+/g, '').trim();
  if (!normalized) return null;
  return getItems().find((item) => (item.barcode || '').trim() === normalized) || null;
}

function getVisibleItems(): CatalogItem[] {
  const snapshotKey = `${state.snapshot?.lastSyncedAt || 'na'}:${state.snapshot?.items.length || 0}`;
  const cacheKey = `${snapshotKey}:${state.activeCategoryId || 'all'}`;
  if (derivedCache.visibleItemsKey === cacheKey) return derivedCache.visibleItems;
  const items = getItems();
  const value = !state.activeCategoryId ? items : items.filter((row) => row.categoryId === state.activeCategoryId);
  derivedCache.visibleItemsKey = cacheKey;
  derivedCache.visibleItems = value;
  return value;
}

function getBarcodeBindingItems(): CatalogItem[] {
  const categoryId = state.barcodeBindingCategoryId;
  const search = state.barcodeBindingSearch.trim().toLowerCase();
  const snapshotKey = `${state.snapshot?.lastSyncedAt || 'na'}:${state.snapshot?.items.length || 0}`;
  const cacheKey = `${snapshotKey}:${categoryId}:${search}`;
  if (derivedCache.barcodeBindingKey === cacheKey) return derivedCache.barcodeBindingItems;

  const value = getItems().filter((item) => {
    const categoryMatch = !categoryId || item.categoryId === categoryId;
    const searchMatch =
      !search ||
      item.name.toLowerCase().includes(search) ||
      (item.barcode || '').toLowerCase().includes(search);
    return categoryMatch && searchMatch;
  });
  derivedCache.barcodeBindingKey = cacheKey;
  derivedCache.barcodeBindingItems = value;
  return value;
}

function getCartLines(): CartLine[] {
  const snapshotKey = `${state.snapshot?.lastSyncedAt || 'na'}:${state.snapshot?.items.length || 0}`;
  const cartKey = `${snapshotKey}:${Array.from(state.cartQtyByItemId.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, qty]) => `${itemId}:${qty}`)
    .join('|')}`;
  if (derivedCache.cartLinesKey === cartKey) return derivedCache.cartLines;
  const byId = new Map(getItems().map((item) => [item.id, item]));
  const lines: CartLine[] = [];
  state.cartQtyByItemId.forEach((qty, itemId) => {
    const item = byId.get(itemId);
    if (item && qty > 0) lines.push({ item, qty });
  });
  const value = lines.sort((a, b) => a.item.name.localeCompare(b.item.name));
  derivedCache.cartLinesKey = cartKey;
  derivedCache.cartLines = value;
  return value;
}

function getTotalCents(): number {
  return getCartLines().reduce((sum, line) => sum + line.item.priceCents * line.qty, 0);
}

function getActiveTabTotalCents(): number {
  return (state.openTabsDetail?.lines || []).reduce((sum, line) => sum + line.lineTotalCents, 0);
}

function hasPendingKitchenDelta(): boolean {
  return Boolean(state.openTabsDetail && state.openTabsDetail.pendingKitchenCount > 0);
}

function getCurrentSaleTotalCents(): number {
  return state.tableModeEnabled ? getActiveTabTotalCents() : getTotalCents();
}

function parseReceivedCents(): number {
  const raw = Number.parseInt(state.receivedInput || '0', 10);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw * 100;
}

function canConfirmPayment(): boolean {
  const total = getCurrentSaleTotalCents();
  if (state.tableModeEnabled && state.checkoutPaymentMethod === 'tarjeta') {
    return total > 0 && !state.busy;
  }
  const received = parseReceivedCents();
  return total > 0 && received >= total && !state.busy;
}

function hasSaleInProgress(): boolean {
  if (state.tableModeEnabled) {
    return Boolean(state.openTabsSelectedTabId) || state.checkoutOpen;
  }
  return getCartLines().length > 0 || state.checkoutOpen;
}

function adjustQty(itemId: string, delta: number): void {
  const current = state.cartQtyByItemId.get(itemId) || 0;
  const next = current + delta;
  if (next <= 0) state.cartQtyByItemId.delete(itemId);
  else state.cartQtyByItemId.set(itemId, next);
  render();
}

function clearCart(): void {
  state.cartQtyByItemId.clear();
  state.receivedInput = '';
  state.enterConfirmArmedAt = null;
  render();
}

function openCheckout(): void {
  if (state.tableModeEnabled) {
    if (!state.openTabsSelectedTabId || !state.openTabsDetail?.lines.length) return;
    if (hasPendingKitchenDelta()) {
      const accepted = window.confirm(
        'Hay productos pendientes de enviar a cocina. Deseas continuar al cierre de cuenta?',
      );
      if (!accepted) return;
    }
  } else if (getCartLines().length === 0) {
    return;
  }
  state.checkoutOpen = true;
  state.receivedInput = '';
  state.checkoutPaymentMethod = state.tableModeEnabled ? state.openTabsPaymentMethod : 'efectivo';
  state.enterConfirmArmedAt = null;
  void applyScanContext();
  render();
}

function closeCheckout(): void {
  if (state.busy) return;
  state.checkoutOpen = false;
  state.receivedInput = '';
  state.enterConfirmArmedAt = null;
  void applyScanContext();
  render();
}

function ensureActiveCategory(): void {
  const categories = getCategories();
  if (!categories.length) {
    state.activeCategoryId = '';
    return;
  }
  if (!categories.some((row) => row.id === state.activeCategoryId)) {
    state.activeCategoryId = categories[0].id;
  }
}

function ensureBarcodeBindingCategory(): void {
  const categories = getCategories();
  if (!categories.length) {
    state.barcodeBindingCategoryId = '';
    return;
  }
  if (state.barcodeBindingCategoryId && !categories.some((row) => row.id === state.barcodeBindingCategoryId)) {
    state.barcodeBindingCategoryId = '';
  }
}

function ensureBarcodeBindingSelection(filteredItems: CatalogItem[]): void {
  if (!filteredItems.length) {
    state.barcodeBindingSelectedItemId = '';
    return;
  }
  if (!filteredItems.some((row) => row.id === state.barcodeBindingSelectedItemId)) {
    state.barcodeBindingSelectedItemId = filteredItems[0].id;
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
  }).format(date);
}

function openTabsStatusClass(): string {
  return state.openTabsStatusKind === 'error' ? 'error' : state.openTabsStatusKind === 'success' ? 'success' : '';
}

function setOpenTabsStatus(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  state.openTabsStatusMessage = message;
  state.openTabsStatusKind = kind;
}

function ensureOpenTabsSelections(): void {
  if (
    state.openTabsSelectedTableId &&
    !state.openTabsSnapshot.tables.some((table) => table.id === state.openTabsSelectedTableId)
  ) {
    state.openTabsSelectedTableId = '';
  }

  if (!state.openTabsSelectedTableId && state.openTabsSnapshot.tables.length > 0) {
    state.openTabsSelectedTableId = state.openTabsSnapshot.tables[0].id;
  }

  if (
    state.openTabsSelectedTabId &&
    !state.openTabsSnapshot.tabs.some((tab) => tab.id === state.openTabsSelectedTabId)
  ) {
    state.openTabsSelectedTabId = '';
    state.openTabsDetail = null;
  }
}

async function refreshOpenTabsSnapshot(loadDetail = true): Promise<void> {
  const snapshot = await window.posKiosk.getOpenTabsSnapshot(null);
  state.openTabsSnapshot = snapshot;
  ensureOpenTabsSelections();

  if (loadDetail && state.openTabsSelectedTabId) {
    state.openTabsDetail = await window.posKiosk.getOpenTabDetail(state.openTabsSelectedTabId);
  } else if (!state.openTabsSelectedTabId) {
    state.openTabsDetail = null;
  }
}

async function refreshOpenTabsDetail(tabId: string): Promise<void> {
  state.openTabsDetail = await window.posKiosk.getOpenTabDetail(tabId);
}

async function openOpenTabsModal(): Promise<void> {
  if (state.busy) return;
  state.openTabsOpen = true;
  state.openTabsLoading = true;
  setOpenTabsStatus('Cargando mesas y tabs...', 'info');
  render();

  try {
    state.openTabsIsPosMaster = await window.posKiosk.isPosMaster();
    await refreshOpenTabsSnapshot(false);
    setOpenTabsStatus('Open Tabs listo.', 'success');
  } catch (error) {
    setOpenTabsStatus(error instanceof Error ? error.message : 'No se pudo cargar Open Tabs.', 'error');
  } finally {
    state.openTabsLoading = false;
    render();
  }
}

function closeOpenTabsModal(): void {
  if (state.openTabsBusy) return;
  state.openTabsOpen = false;
  state.openTabsDetail = null;
  state.openTabsForceRefresh = false;
  render();
}

function renderTableSelectorModal(): string {
  if (!state.tableSelectorOpen) return '';
  const tablesHtml = state.openTabsSnapshot.tables.length
    ? state.openTabsSnapshot.tables
        .map((table) => {
          const existing = state.openTabsSnapshot.tabs.find((tab) => tab.posTableId === table.id);
          return `
        <button class="binding-item ${state.tableSelectorSelectedTableId === table.id ? 'selected' : ''}" data-action="table-select-option" data-id="${table.id}">
          <div class="binding-item-name">${escapeHtml(table.name)}</div>
          <div class="binding-item-meta">
            <span>${existing ? `Tab abierta: ${escapeHtml(existing.folioText)}` : 'Sin tab abierta'}</span>
            <span>${existing ? formatMoney(existing.totalCents) : ''}</span>
          </div>
        </button>
      `;
        })
        .join('')
    : '<div class="empty">No hay mesas. Configura mesas para comenzar.</div>';

  return `
    <div class="modal-overlay">
      <div class="modal">
        <h2>Seleccionar mesa</h2>
        <p class="cart-sub">Al confirmar, se usa tab abierta de la mesa o se crea una nueva.</p>
        <div class="barcode-items-list">${tablesHtml}</div>
        <div class="modal-actions">
          <button class="button secondary" data-action="table-cancel-select" ${state.openTabsBusy ? 'disabled' : ''}>Cancelar</button>
          <button class="button" data-action="table-confirm-select" ${state.openTabsBusy ? 'disabled' : ''}>Confirmar mesa</button>
        </div>
      </div>
    </div>
  `;
}

function renderTablesSettingsModal(): string {
  if (!state.tablesSettingsOpen) return '';
  const rowsHtml = state.tablesSettingsRows.length
    ? state.tablesSettingsRows
        .map(
          (row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>
          <input id="table-name-${row.id}" class="input table-name-input" value="${escapeHtml(row.name)}" />
        </td>
        <td>${row.isActive ? 'Activa' : 'Inactiva'}</td>
        <td>${row.sortOrder}</td>
        <td>
          <div class="history-actions">
            <button class="button secondary history-action-btn" data-action="tables-row-save" data-id="${row.id}" ${
              state.tablesSettingsBusy ? 'disabled' : ''
            }>Guardar</button>
            <button class="button secondary history-action-btn" data-action="tables-row-toggle" data-id="${row.id}" data-active="${
              row.isActive ? '1' : '0'
            }" ${state.tablesSettingsBusy ? 'disabled' : ''}>
              ${row.isActive ? 'Desactivar' : 'Activar'}
            </button>
            <button class="button secondary history-action-btn" data-action="tables-row-up" data-id="${row.id}" ${
              state.tablesSettingsBusy ? 'disabled' : ''
            }>Subir</button>
            <button class="button secondary history-action-btn" data-action="tables-row-down" data-id="${row.id}" ${
              state.tablesSettingsBusy ? 'disabled' : ''
            }>Bajar</button>
            <button class="button secondary history-action-btn danger" data-action="tables-row-delete" data-id="${row.id}" ${
              state.tablesSettingsBusy ? 'disabled' : ''
            }>Eliminar</button>
          </div>
        </td>
      </tr>
    `,
        )
        .join('')
    : '<tr><td colspan="5">No hay mesas registradas.</td></tr>';

  return `
    <div class="modal-overlay">
      <div class="modal history-modal">
        <div class="settings-header">
          <h2>Ajustes > Mesas</h2>
          <div class="settings-inline-status ${state.tablesSettingsLoading ? '' : 'success'}">
            ${
              state.tablesSettingsLoading
                ? 'Cargando mesas...'
                : 'CRUD local de mesas. Acciones destructivas requieren confirmacion fuerte.'
            }
          </div>
        </div>

        <div class="panel" style="margin-top: 10px;">
          <div class="settings-section-title">Generacion masiva (con guardrail)</div>
          <div class="settings-actions">
            <label class="field" style="min-width: 180px;">
              <span>Prefijo</span>
              <input id="tables-generate-prefix" class="input" value="${escapeHtml(state.tablesSettingsGeneratePrefix)}" />
            </label>
            <label class="field" style="min-width: 120px;">
              <span>Cantidad</span>
              <input id="tables-generate-count" class="input" inputmode="numeric" value="${escapeHtml(
                state.tablesSettingsGenerateCount,
              )}" />
            </label>
            <label class="field" style="min-width: 120px;">
              <span>Inicio</span>
              <input id="tables-generate-start-at" class="input" inputmode="numeric" value="${escapeHtml(
                state.tablesSettingsGenerateStartAt,
              )}" />
            </label>
          </div>
          <div class="settings-actions">
            <button class="button secondary" data-action="tables-generate-preview" ${
              state.tablesSettingsBusy ? 'disabled' : ''
            }>Preview</button>
            <input id="tables-generate-confirm" class="input" placeholder="Escribe CONFIRMAR" value="${escapeHtml(
              state.tablesSettingsConfirmText,
            )}" ${state.tablesSettingsBusy ? 'disabled' : ''} />
            <button class="button" data-action="tables-generate-confirm" ${
              state.tablesSettingsBusy ? 'disabled' : ''
            }>Generar</button>
          </div>
          ${state.tablesSettingsPreview ? `<div class="status">${escapeHtml(state.tablesSettingsPreview)}</div>` : ''}
        </div>

        <div class="jobs-table-wrap history-table-wrap" style="margin-top: 10px;">
          <table class="jobs-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Nombre</th>
                <th>Estado</th>
                <th>Orden</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="close-tables-settings" ${state.tablesSettingsBusy ? 'disabled' : ''}>Cerrar</button>
        </div>
      </div>
    </div>
  `;
}

async function activateTableMode(): Promise<void> {
  if (state.busy || state.openTabsBusy) return;
  state.openTabsLoading = true;
  setOpenTabsStatus('Activando modo mesa...', 'info');
  render();
  try {
    state.tableModeEnabled = true;
    await refreshOpenTabsSnapshot(false);
    state.tableSelectorOpen = true;
    state.tableSelectorSelectedTableId =
      state.openTabsSelectedTableId || state.openTabsSnapshot.tables[0]?.id || '';
    setOpenTabsStatus('Selecciona una mesa para operar.', 'info');
  } catch (error) {
    state.tableModeEnabled = false;
    setOpenTabsStatus(error instanceof Error ? error.message : 'No se pudo activar modo mesa.', 'error');
  } finally {
    state.openTabsLoading = false;
    render();
  }
}

function deactivateTableMode(): void {
  state.tableModeEnabled = false;
  state.tableSelectorOpen = false;
  state.openTabsSelectedTabId = '';
  state.openTabsDetail = null;
  state.checkoutOpen = false;
  state.receivedInput = '';
  setOpenTabsStatus('Modo mesa desactivado.', 'info');
  render();
}

async function confirmTableSelection(): Promise<void> {
  if (state.openTabsBusy) return;
  const tableId = state.tableSelectorSelectedTableId || state.openTabsSnapshot.tables[0]?.id || '';
  if (!tableId) {
    setOpenTabsStatus('No hay mesas disponibles. Configura mesas primero.', 'error');
    render();
    return;
  }

  state.openTabsSelectedTableId = tableId;
  const existingTab = state.openTabsSnapshot.tabs.find((tab) => tab.posTableId === tableId);
  if (existingTab) {
    state.openTabsSelectedTabId = existingTab.id;
    await refreshOpenTabsDetail(existingTab.id);
    state.tableSelectorOpen = false;
    setOpenTabsStatus(`Operando mesa con tab ${existingTab.folioText}.`, 'success');
    render();
    return;
  }

  await openTabForSelectedTable();
  state.tableSelectorOpen = false;
  render();
}

function initUI(): void {
  if (ui.initialized) return;
  app.innerHTML = `
    <main class="kiosk-shell">
      <header class="topbar">
        <div>
          <h1>Kiosk POS</h1>
          <p id="topbar-subtitle">Operacion local offline-first.</p>
        </div>
        <div class="topbar-right">
          <div class="topbar-actions" data-region="header-actions"></div>
        </div>
      </header>

      <section class="layout">
        <aside class="panel categories">
          <h2>Categorias</h2>
          <div class="stack" data-region="categories"></div>
        </aside>

        <section class="panel products">
          <h2>Productos</h2>
          <div class="products-grid" data-region="products"></div>
        </section>

        <aside class="panel cart" data-region="cart"></aside>
      </section>

      <footer class="bottom-status" data-region="statusbar"></footer>
      <div data-region="modals"></div>
    </main>
  `;

  ui.topbarSubtitle = app.querySelector('#topbar-subtitle');
  ui.headerActions = app.querySelector('[data-region="header-actions"]');
  ui.categoriesRegion = app.querySelector('[data-region="categories"]');
  ui.productsRegion = app.querySelector('[data-region="products"]');
  ui.cartRegion = app.querySelector('[data-region="cart"]');
  ui.bottomStatusRegion = app.querySelector('[data-region="statusbar"]');
  ui.modalsRegion = app.querySelector('[data-region="modals"]');
  ui.initialized = true;
}

function renderBottomStatusRegion(): void {
  if (!ui.bottomStatusRegion) return;
  const sync = state.statusBar.sync;
  const scanner = state.statusBar.scanner;
  const print = state.statusBar.print;
  const runtime = state.statusBar.runtime;

  const syncValue =
    sync.phase === 'working'
      ? 'Sync...'
      : sync.phase === 'warn' && sync.pendingTotal > 0
        ? `Pend: ${sync.pendingTotal} · reintento`
        : sync.pendingTotal > 0
          ? `Pend: ${sync.pendingTotal}`
          : 'Al dia';
  const scannerValue =
    scanner.phase === 'warn'
      ? 'No encontrado'
      : scanner.lastCode
        ? `Ultimo: ${scanner.lastCode}`
        : 'Scanner listo';
  const printValue =
    print.phase === 'working'
      ? 'Imprimiendo...'
      : print.phase === 'error'
        ? 'Fallo impresion'
        : 'Impresion lista';
  const runtimeValue = runtime.modeMesa
    ? `Modo mesa: ON ${runtime.folioHint ? `· ${runtime.folioHint}` : ''}`
    : `Modo mesa: OFF ${runtime.kioskLabel ? `· ${runtime.kioskLabel}` : ''}`;

  const html = `
    <div class="status-segment" title="${escapeHtml(sync.lastOkAt ? `Ultimo OK: ${formatDate(sync.lastOkAt)}` : 'Sin sync previa')}">
      <span class="status-label">Sync</span>
      <span class="status-value">${escapeHtml(syncValue)}</span>
    </div>
    <div class="status-separator"></div>
    <div class="status-segment" title="${escapeHtml(scanner.lastAt ? `Ultima lectura: ${formatDate(scanner.lastAt)}` : 'Scanner listo')}">
      <span class="status-label">Scanner</span>
      <span class="status-value">${escapeHtml(scannerValue)}</span>
    </div>
    <div class="status-separator"></div>
    <div class="status-segment" title="${escapeHtml(print.lastErrorShort || 'Cola de impresion disponible')}">
      <span class="status-label">Print</span>
      <span class="status-value">${escapeHtml(printValue)}</span>
    </div>
    <div class="status-separator"></div>
    <button class="status-segment runtime-segment" data-action="toggle-render-metrics" title="Click para togglear metricas de render">
      <span class="status-label">Runtime</span>
      <span class="status-value">${escapeHtml(runtimeValue)}</span>
    </button>
  `;
  if (renderRuntime.regionSignature.statusbar === html) return;
  renderRuntime.regionSignature.statusbar = html;
  ui.bottomStatusRegion.innerHTML = html;
}

function updateStatusBarState(): void {
  state.statusBar.sync.pendingTotal = state.autoSync.pendingTotal;
  state.statusBar.sync.lastErrorShort = state.autoSync.lastErrorShort;
  state.statusBar.sync.lastOkAt = state.autoSync.lastOkAt;
  if (state.autoSync.phase === 'syncing') {
    state.statusBar.sync.phase = 'working';
  } else if (state.autoSync.phase === 'retrying' || state.autoSync.phase === 'error') {
    state.statusBar.sync.phase = 'warn';
  } else if (state.autoSync.phase === 'ok') {
    state.statusBar.sync.phase = 'ok';
  } else {
    state.statusBar.sync.phase = 'idle';
  }

  state.statusBar.runtime.modeMesa = state.tableModeEnabled;
  state.statusBar.runtime.kioskLabel = state.runtimeConfig?.kioskId || '';
  state.statusBar.runtime.folioHint = state.openTabsDetail?.tab.folioText || '';
}

// Diagnostico previo:
// 1) aqui existia re-render global con app.innerHTML del shell completo por cada setState.
// 2) despues de cada render se re-ataban listeners attachSettingsInputs/attachBarcodeBindingInputs/etc.
// 3) los estatus operativos de sync estaban en el header superior y en un banner global.
function render(): void {
  queueRender('legacy-render-call');
}

function flushRender(): void {
  initUI();
  const activeElement = document.activeElement as HTMLElement | null;
  const refocusId = activeElement?.id || '';
  const shouldRefocusInput = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;
  const prevSelectionStart =
    shouldRefocusInput && activeElement instanceof HTMLInputElement
      ? activeElement.selectionStart
      : null;
  const prevSelectionEnd =
    shouldRefocusInput && activeElement instanceof HTMLInputElement
      ? activeElement.selectionEnd
      : null;

  ensureActiveCategory();
  ensureBarcodeBindingCategory();

  const categories = getCategories();
  const items = getVisibleItems();
  const barcodeBindingItems = getBarcodeBindingItems();
  ensureBarcodeBindingSelection(barcodeBindingItems);
  const selectedBarcodeItem =
    getItems().find((row) => row.id === state.barcodeBindingSelectedItemId) || null;
  const cartLines = getCartLines();
  const tableLines = state.openTabsDetail?.lines || [];
  const totalCents = getCurrentSaleTotalCents();
  const receivedCents = parseReceivedCents();
  const missingCents = Math.max(totalCents - receivedCents, 0);
  const changeCents = Math.max(receivedCents - totalCents, 0);

  const categoryHtml = categories.length
    ? categories
        .map(
          (category) => `
      <button class="category-btn ${category.id === state.activeCategoryId ? 'active' : ''}" data-action="select-category" data-id="${category.id}">
        ${escapeHtml(category.name)}
      </button>
    `,
        )
        .join('')
    : '<div class="empty">Sin categorias locales.</div>';

  const productsHtml = items.length
    ? items
        .map(
          (item) => `
      <button class="product-card" data-action="add-item" data-id="${item.id}">
        <div class="product-name">${escapeHtml(item.name)}</div>
        <div class="product-meta">
          <span>${item.type === 'combo' ? 'Combo' : 'Producto'}</span>
          <strong>${formatMoney(item.priceCents)}</strong>
        </div>
      </button>
    `,
        )
        .join('')
    : '<div class="empty">Sin productos en esta categoria.</div>';

  const itemNameById = new Map(getItems().map((item) => [item.id, item.name]));
  const cartHtml = state.tableModeEnabled
    ? tableLines.length
      ? tableLines
          .map(
            (line) => `
        <div class="cart-line">
          <div>
            <div class="cart-name">${escapeHtml(itemNameById.get(line.productId) || line.productId)}</div>
            <div class="cart-sub">${line.qty} x ${formatMoney(line.unitPriceCents)} · cocina: ${line.kitchenStatus === 'PENDING' ? 'pendiente' : 'enviado'}</div>
          </div>
          <div class="cart-actions-inline">
            <button class="qty-btn" data-action="open-tabs-line-dec" data-id="${line.id}" ${line.qty <= 1 ? 'disabled' : ''}>-</button>
            <span class="qty-value">${line.qty}</span>
            <button class="qty-btn" data-action="open-tabs-line-inc" data-id="${line.id}">+</button>
            <button class="remove-btn" data-action="open-tabs-line-remove" data-id="${line.id}">Quitar</button>
          </div>
        </div>
      `,
          )
          .join('')
      : '<div class="empty">Esta mesa no tiene productos. Agrega desde el catalogo.</div>'
    : cartLines.length
      ? cartLines
          .map(
            (line) => `
      <div class="cart-line">
        <div>
          <div class="cart-name">${escapeHtml(line.item.name)}</div>
          <div class="cart-sub">${line.qty} x ${formatMoney(line.item.priceCents)}</div>
        </div>
        <div class="cart-actions-inline">
          <button class="qty-btn" data-action="dec-item" data-id="${line.item.id}">-</button>
          <span class="qty-value">${line.qty}</span>
          <button class="qty-btn" data-action="inc-item" data-id="${line.item.id}">+</button>
          <button class="remove-btn" data-action="remove-item" data-id="${line.item.id}">Quitar</button>
        </div>
      </div>
    `,
          )
          .join('')
      : '<div class="empty">Agrega productos para iniciar una orden.</div>';

  const kitchenRoundsHtml =
    state.openTabsDetail?.kitchenRounds?.length
      ? state.openTabsDetail.kitchenRounds
          .slice(0, 5)
          .map(
            (round) => `
      <div class="cart-sub">Ronda v${round.fromVersion}->v${round.printedVersion} · ${round.linesCount} lineas · ${round.ok ? 'OK' : 'ERROR'} · ${escapeHtml(round.status)} · ${formatDate(round.createdAt)}</div>
    `,
          )
          .join('')
      : '<div class="cart-sub">Sin rondas de cocina registradas.</div>';
  const barcodeBindingStatusClass =
    state.barcodeBindingStatusKind === 'error'
      ? 'error'
      : state.barcodeBindingStatusKind === 'success'
        ? 'success'
        : '';

  const barcodeBindingCategoriesHtml = `
    <button class="category-btn ${state.barcodeBindingCategoryId ? '' : 'active'}" data-action="binding-filter-category" data-id="">
      Todas
    </button>
    ${categories
      .map(
        (category) => `
      <button class="category-btn ${category.id === state.barcodeBindingCategoryId ? 'active' : ''}" data-action="binding-filter-category" data-id="${category.id}">
        ${escapeHtml(category.name)}
      </button>
    `,
      )
      .join('')}
  `;

  const barcodeBindingItemsHtml = barcodeBindingItems.length
    ? barcodeBindingItems
        .map((item) => {
          const selectedClass = item.id === state.barcodeBindingSelectedItemId ? 'selected' : '';
          return `
        <button class="binding-item ${selectedClass}" data-action="binding-select-item" data-id="${item.id}">
          <div class="binding-item-name">${escapeHtml(item.name)}</div>
          <div class="binding-item-meta">
            <span>${formatMoney(item.priceCents)}</span>
            <span>${item.barcode ? `Etiqueta: ${escapeHtml(item.barcode)}` : 'Sin etiqueta'}</span>
          </div>
        </button>
      `;
        })
        .join('')
    : '<div class="empty">No hay productos para el filtro actual.</div>';

  const barcodeBindingHtml = state.barcodeBindingOpen
    ? `
    <div class="modal-overlay">
      <div class="modal barcode-modal">
        <div class="settings-header">
          <h2>Asignar etiqueta de scanner</h2>
          <div class="settings-inline-status ${barcodeBindingStatusClass}">
            ${escapeHtml(state.barcodeBindingStatusMessage)}
          </div>
        </div>

        <div class="barcode-layout">
          <aside class="panel barcode-categories-panel">
            <div class="settings-section-title">Categorias</div>
            <div class="stack">${barcodeBindingCategoriesHtml}</div>
          </aside>

          <section class="panel barcode-items-panel">
            <div class="barcode-toolbar">
              <label class="field barcode-search">
                <span>Filtrar por nombre o etiqueta</span>
                <input id="binding-search-input" data-scan-capture="off" class="input barcode-search-input" value="${escapeHtml(state.barcodeBindingSearch)}" placeholder="Ej: Coca o 75010..." />
              </label>
            </div>
            <div class="barcode-items-list">${barcodeBindingItemsHtml}</div>
          </section>

          <aside class="panel barcode-selection-panel">
            <div class="settings-section-title">Producto seleccionado</div>
            ${
              selectedBarcodeItem
                ? `
              <div class="binding-selection-name">${escapeHtml(selectedBarcodeItem.name)}</div>
              <div class="binding-selection-meta">Precio: ${formatMoney(selectedBarcodeItem.priceCents)}</div>
              <div class="binding-selection-meta">
                Etiqueta actual: ${selectedBarcodeItem.barcode ? escapeHtml(selectedBarcodeItem.barcode) : 'Sin etiqueta'}
              </div>
              <div class="binding-hint">Escanea la etiqueta ahora para asignarla.</div>
            `
                : '<div class="empty">Selecciona un producto para poder asignar etiqueta.</div>'
            }
          </aside>
        </div>

        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="close-barcode-binding" ${state.barcodeBindingBusy ? 'disabled' : ''}>Cerrar</button>
        </div>
      </div>
    </div>
  `
    : '';

  const checkoutHtml = state.checkoutOpen
    ? `
    <div class="modal-overlay">
      <div class="modal">
        <h2>${state.tableModeEnabled ? 'Cerrar cuenta de mesa' : 'Cobro'}</h2>
        <div class="checkout-lines">
          ${
            state.tableModeEnabled
              ? Array.from(
                  tableLines.reduce(
                    (acc, line) => {
                      const key = line.productId;
                      const current = acc.get(key);
                      if (current) {
                        current.qty += line.qty;
                        current.totalCents += line.lineTotalCents;
                        return acc;
                      }
                      acc.set(key, {
                        name: itemNameById.get(line.productId) || line.productId,
                        qty: line.qty,
                        totalCents: line.lineTotalCents,
                      });
                      return acc;
                    },
                    new Map<string, { name: string; qty: number; totalCents: number }>(),
                  ).values(),
                )
                  .map(
                    (line) => `
              <div class="checkout-line">
                <span>${line.qty} x ${escapeHtml(line.name)}</span>
                <strong>${formatMoney(line.totalCents)}</strong>
              </div>
            `,
                  )
                  .join('')
              : cartLines
                  .map(
                    (line) => `
              <div class="checkout-line">
                <span>${line.qty} x ${escapeHtml(line.item.name)}</span>
                <strong>${formatMoney(line.item.priceCents * line.qty)}</strong>
              </div>
            `,
                  )
                  .join('')
          }
        </div>

        <div class="checkout-total">
          <span>Total</span>
          <strong>${formatMoney(totalCents)}</strong>
        </div>

        <label class="field">
          <span>Metodo de pago</span>
          <select id="checkout-payment-method" class="input">
            <option value="efectivo" ${state.checkoutPaymentMethod === 'efectivo' ? 'selected' : ''}>Efectivo</option>
            <option value="tarjeta" ${state.checkoutPaymentMethod === 'tarjeta' ? 'selected' : ''}>Tarjeta</option>
          </select>
        </label>

        <label class="field">
          <span>Pago recibido</span>
          <input id="input-received" data-scan-capture="off" class="input" inputmode="numeric" value="${escapeHtml(state.receivedInput)}" placeholder="0" ${
            state.checkoutPaymentMethod === 'tarjeta' ? 'disabled' : ''
          } />
        </label>

        <div class="quick-amounts">
          <button class="button secondary" data-action="quick-amount" data-value="50">$50</button>
          <button class="button secondary" data-action="quick-amount" data-value="100">$100</button>
          <button class="button secondary" data-action="quick-amount" data-value="200">$200</button>
          <button class="button secondary" data-action="quick-amount" data-value="500">$500</button>
          <button class="button secondary" data-action="exact-amount">EXACTO</button>
        </div>

        <div class="checkout-result ${missingCents > 0 ? 'danger' : 'ok'}">
          ${
            state.checkoutPaymentMethod === 'tarjeta'
              ? 'Pago con tarjeta (sin cambio).'
              : missingCents > 0
                ? `Faltan ${formatMoney(missingCents)}`
                : `Cambio ${formatMoney(changeCents)}`
          }
        </div>

        <div class="modal-actions">
          <button class="button secondary" data-action="cancel-checkout" ${state.busy ? 'disabled' : ''}>Cancelar</button>
          <button class="button" data-action="confirm-sale" ${canConfirmPayment() ? '' : 'disabled'}>${state.busy ? 'Procesando...' : 'Confirmar e imprimir'}</button>
        </div>
      </div>
    </div>
  `
    : '';

  const settingsConfig = state.printConfig || { linuxPrinterName: '', windowsPrinterShare: '' };
  const runtime = state.runtimeConfig || resolveRuntimeConfigDefaults();

  const settingsJobsHtml = state.printJobs.length
    ? state.printJobs
        .map(
          (job) => `
      <tr>
        <td>${formatDate(job.createdAt)}</td>
        <td>${escapeHtml(job.jobName)}</td>
        <td>${escapeHtml(job.status)}</td>
        <td>${job.attempts}</td>
        <td>${escapeHtml(job.lastError || '')}</td>
      </tr>
    `,
        )
        .join('')
    : '<tr><td colspan="5">Sin jobs registrados.</td></tr>';

  const settingsHtml = state.settingsOpen
    ? `
    <div class="modal-overlay">
      <div class="modal settings-modal">
        <div class="settings-header">
          <h2>Ajustes de impresora y kiosko</h2>
          <div class="settings-inline-status ${state.settingsStatusKind}">
            ${
              state.settingsPendingAction === 'load'
                ? 'Cargando ajustes...'
                : state.settingsPendingAction === 'save'
                  ? 'Guardando ajustes...'
                  : state.settingsPendingAction === 'print-test'
                    ? 'Enviando impresion de prueba...'
                    : state.settingsPendingAction === 'refresh-jobs'
                      ? 'Refrescando jobs...'
                      : escapeHtml(state.settingsStatusMessage)
            }
          </div>
        </div>

        <div class="settings-body">
          <section class="settings-column settings-column-config">
            <div class="settings-section-title">Configuracion</div>

            <label class="field">
              <span>Linux printer name</span>
              <input id="settings-linux-printer" class="input" value="${escapeHtml(settingsConfig.linuxPrinterName)}" />
            </label>

            <label class="field">
              <span>Windows printer share</span>
              <input id="settings-windows-printer" class="input" value="${escapeHtml(settingsConfig.windowsPrinterShare)}" />
            </label>

            <label class="field">
              <span>Tenant Slug (sync catalogo)</span>
              <input id="settings-tenant-slug" class="input" value="${escapeHtml(runtime.tenantSlug || '')}" />
            </label>

            <label class="field">
              <span>Device ID (sync catalogo)</span>
              <input id="settings-device-id" class="input" value="${escapeHtml(runtime.deviceId || '')}" />
            </label>

            <label class="field">
              <span>Device Secret (sync catalogo)</span>
              <input id="settings-device-secret" class="input" value="${escapeHtml(runtime.deviceSecret || '')}" />
            </label>

            <label class="field">
              <span>Tenant ID (ventas)</span>
              <input id="settings-tenant-id" class="input" value="${escapeHtml(runtime.tenantId || '')}" />
            </label>

            <label class="field">
              <span>Kiosk ID (ventas)</span>
              <input id="settings-kiosk-id" class="input" value="${escapeHtml(runtime.kioskId || '')}" />
            </label>

            <label class="field">
              <span>Kiosk Number (ventas)</span>
              <input id="settings-kiosk-number" class="input" inputmode="numeric" value="${runtime.kioskNumber ?? ''}" />
            </label>

            <div class="settings-section-title">Scanner</div>

            <label class="field">
              <span>Minimo caracteres</span>
              <input id="settings-scanner-min-len" class="input" inputmode="numeric" value="${runtime.scannerMinCodeLen ?? 6}" />
            </label>

            <label class="field">
              <span>Maximo caracteres</span>
              <input id="settings-scanner-max-len" class="input" inputmode="numeric" value="${runtime.scannerMaxCodeLen ?? 64}" />
            </label>

            <label class="field">
              <span>Max interkey scan (ms)</span>
              <input id="settings-scanner-max-interkey" class="input" inputmode="numeric" value="${runtime.scannerMaxInterKeyMsScan ?? 35}" />
            </label>

            <label class="field">
              <span>Gap fin scan (ms)</span>
              <input id="settings-scanner-end-gap" class="input" inputmode="numeric" value="${runtime.scannerScanEndGapMs ?? 80}" />
            </label>

            <label class="field">
              <span>Gap humano (ms)</span>
              <input id="settings-scanner-human-gap" class="input" inputmode="numeric" value="${runtime.scannerHumanKeyGapMs ?? 100}" />
            </label>

            <label class="field">
              <span>Pattern caracteres permitidos</span>
              <input id="settings-scanner-allowed-pattern" class="input" value="${escapeHtml(runtime.scannerAllowedCharsPattern || '[0-9A-Za-z\\-_.]')}" />
            </label>

            <label class="field">
              <span>Enter termina scan</span>
              <select id="settings-scanner-enter-terminator" class="input">
                <option value="1" ${runtime.scannerAllowEnterTerminator !== false ? 'selected' : ''}>Si</option>
                <option value="0" ${runtime.scannerAllowEnterTerminator === false ? 'selected' : ''}>No</option>
              </select>
            </label>

            <div class="settings-actions">
              <button class="button" data-action="settings-save-all" ${state.busy ? 'disabled' : ''}>
                ${state.settingsPendingAction === 'save' ? 'Guardando...' : 'Guardar ajustes'}
              </button>
              <button class="button secondary" data-action="settings-refresh-all" ${state.busy ? 'disabled' : ''}>
                ${state.settingsPendingAction === 'load' ? 'Recargando...' : 'Recargar ajustes'}
              </button>
              ${
                state.openTabsIsPosMaster
                  ? `<button class="button secondary" data-action="open-tables-settings" ${state.busy ? 'disabled' : ''}>Mesas (master)</button>`
                  : '<span class="cart-sub">Gestion de mesas disponible solo para kiosk master.</span>'
              }
            </div>
          </section>

          <section class="settings-column settings-column-jobs">
            <div class="settings-section-title">Impresion y jobs</div>

            <div class="settings-actions">
              <button class="button secondary" data-action="settings-print-test" ${state.busy ? 'disabled' : ''}>
                ${state.settingsPendingAction === 'print-test' ? 'Imprimiendo...' : 'Imprimir prueba'}
              </button>
              <button class="button secondary" data-action="settings-refresh-jobs" ${state.busy ? 'disabled' : ''}>
                ${state.settingsPendingAction === 'refresh-jobs' ? 'Refrescando...' : 'Refrescar jobs'}
              </button>
            </div>

            <div class="jobs-table-wrap">
              <table class="jobs-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Intentos</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>${settingsJobsHtml}</tbody>
              </table>
            </div>
          </section>
        </div>

        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="close-settings" ${state.busy ? 'disabled' : ''}>Cerrar</button>
        </div>
      </div>
    </div>
  `
    : '';

  const historyStatusClass =
    state.ordersHistoryStatusKind === 'error'
      ? 'error'
      : state.ordersHistoryStatusKind === 'success'
        ? 'success'
        : '';
  const ordersHistoryRowsHtml = state.ordersHistory.length
    ? state.ordersHistory
        .map((order) => {
          const isTabHistory = order.source === 'tab';
          return `
      <tr>
        <td>${formatDate(order.createdAt)}</td>
        <td>${escapeHtml(order.folioText)}${isTabHistory ? ' (TAB)' : ''}</td>
        <td>${formatMoney(order.totalCents)}</td>
        <td>${escapeHtml(order.status)}</td>
        <td>${escapeHtml(order.printStatus)}</td>
        <td>${order.printAttempts}</td>
        <td>${order.canceledAt ? formatDate(order.canceledAt) : '-'}</td>
        <td>${escapeHtml(order.lastError || order.cancelReason || '')}</td>
        <td>
          <div class="history-actions">
            ${
              isTabHistory
                ? `<button class="button secondary history-action-btn" data-action="tab-kitchen-history" data-id="${order.id}" ${
                    state.ordersHistoryActionBusy ? 'disabled' : ''
                  }>Comandas</button>`
                : ''
            }
            <button class="button secondary history-action-btn" data-action="order-reprint" data-id="${order.id}" ${
              state.ordersHistoryActionBusy || order.status === 'CANCELED' || isTabHistory ? 'disabled' : ''
            }>
              Reimprimir
            </button>
            <button class="button secondary history-action-btn danger" data-action="order-cancel" data-id="${order.id}" ${
              state.ordersHistoryActionBusy || order.status === 'CANCELED' || isTabHistory ? 'disabled' : ''
            }>
              Cancelar
            </button>
          </div>
        </td>
      </tr>
    `;
        })
        .join('')
    : '<tr><td colspan="9">Sin ordenes del dia.</td></tr>';

  const historyHtml = state.ordersHistoryOpen
    ? `
    <div class="modal-overlay">
      <div class="modal history-modal">
        <div class="settings-header">
          <h2>Historial del dia</h2>
          <div class="settings-inline-status ${historyStatusClass}">
            ${
              state.ordersHistoryLoading
                ? 'Cargando historial...'
                : state.ordersHistoryActionBusy
                  ? 'Procesando accion...'
                  : escapeHtml(state.ordersHistoryStatusMessage)
            }
          </div>
        </div>

        <div class="history-actions-row">
          <button class="button secondary" data-action="history-refresh" ${
            state.ordersHistoryLoading || state.ordersHistoryActionBusy ? 'disabled' : ''
          }>
            Refrescar
          </button>
        </div>

        <div class="jobs-table-wrap history-table-wrap">
          <table class="jobs-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Folio</th>
                <th>Total</th>
                <th>Status</th>
                <th>Impresion</th>
                <th>Intentos</th>
                <th>Cancelada</th>
                <th>Detalle</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>${ordersHistoryRowsHtml}</tbody>
          </table>
        </div>

        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="close-order-history" ${
            state.ordersHistoryActionBusy ? 'disabled' : ''
          }>Cerrar</button>
        </div>
      </div>
    </div>
  `
    : '';

  const tabKitchenHistoryStatusClass =
    state.tabKitchenHistoryStatusKind === 'error'
      ? 'error'
      : state.tabKitchenHistoryStatusKind === 'success'
        ? 'success'
        : '';
  const tabKitchenRowsHtml =
    state.tabKitchenHistoryDetail?.kitchenRounds?.length
      ? state.tabKitchenHistoryDetail.kitchenRounds
          .map(
            (round) => {
              const tabClosed = state.tabKitchenHistoryDetail?.tab.status !== 'OPEN';
              return `
      <tr>
        <td>${formatDate(round.createdAt)}</td>
        <td>v${round.fromVersion} -> v${round.printedVersion}</td>
        <td>${round.linesCount}</td>
        <td>${round.ok ? 'OK' : 'ERROR'}</td>
        <td>${escapeHtml(round.status)}${round.canceled ? ' (CANCELADA)' : ''}</td>
        <td>${escapeHtml(round.error || round.cancelReason || '')}</td>
        <td>
          <div class="history-actions">
            <button class="button secondary history-action-btn" data-action="tab-round-reprint" data-id="${round.mutationId}" ${
              state.tabKitchenHistoryBusy || tabClosed ? 'disabled' : ''
            }>
              Reimprimir
            </button>
            <button class="button secondary history-action-btn danger" data-action="tab-round-cancel" data-id="${round.mutationId}" ${
              state.tabKitchenHistoryBusy || round.canceled ? 'disabled' : ''
            }>
              Cancelar comanda
            </button>
          </div>
        </td>
      </tr>
    `;
            },
          )
          .join('')
      : '<tr><td colspan="7">Sin comandas registradas.</td></tr>';
  const tabKitchenHistoryHtml = state.tabKitchenHistoryOpen
    ? `
    <div class="modal-overlay">
      <div class="modal history-modal">
        <div class="settings-header">
          <h2>Comandas de cocina · ${escapeHtml(state.tabKitchenHistoryDetail?.tab.folioText || state.tabKitchenHistoryTabId)}</h2>
          <div class="settings-inline-status ${tabKitchenHistoryStatusClass}">
            ${
              state.tabKitchenHistoryLoading
                ? 'Cargando comandas...'
                : state.tabKitchenHistoryBusy
                  ? 'Procesando accion...'
                  : escapeHtml(state.tabKitchenHistoryStatusMessage)
            }
          </div>
        </div>

        <div class="jobs-table-wrap history-table-wrap">
          <table class="jobs-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Version</th>
                <th>Lineas</th>
                <th>Print</th>
                <th>Estado</th>
                <th>Error</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>${tabKitchenRowsHtml}</tbody>
          </table>
        </div>

        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="close-tab-kitchen-history" ${
            state.tabKitchenHistoryBusy ? 'disabled' : ''
          }>Cerrar</button>
        </div>
      </div>
    </div>
  `
    : '';

  ensureOpenTabsSelections();
  const selectedTab = state.openTabsSnapshot.tabs.find((tab) => tab.id === state.openTabsSelectedTabId) || null;
  const openTabsStatus = openTabsStatusClass();
  const openTabsTablesHtml = state.openTabsSnapshot.tables.length
    ? state.openTabsSnapshot.tables
        .map(
          (table) => `
      <button class="category-btn ${table.id === state.openTabsSelectedTableId ? 'active' : ''}" data-action="open-tabs-select-table" data-id="${table.id}">
        ${escapeHtml(table.name)}
      </button>
    `,
        )
        .join('')
    : '<div class="empty">No hay mesas configuradas.</div>';

  const openTabsListHtml = state.openTabsSnapshot.tabs.length
    ? state.openTabsSnapshot.tabs
        .map(
          (tab) => `
      <button class="binding-item ${tab.id === state.openTabsSelectedTabId ? 'selected' : ''}" data-action="open-tabs-select-tab" data-id="${tab.id}">
        <div class="binding-item-name">${escapeHtml(tab.folioText)}</div>
        <div class="binding-item-meta">
          <span>${formatMoney(tab.totalCents)}</span>
          <span>v${tab.tabVersionLocal} | cocina v${tab.kitchenLastPrintedVersion}</span>
        </div>
      </button>
    `,
        )
        .join('')
    : '<div class="empty">Sin tabs abiertas.</div>';

  const catalogNameById = new Map(getItems().map((item) => [item.id, item.name]));
  const openTabsLinesHtml =
    state.openTabsDetail && state.openTabsDetail.lines.length
      ? state.openTabsDetail.lines
          .map(
            (line) => `
      <div class="cart-line">
        <div class="cart-name">${escapeHtml(catalogNameById.get(line.productId) || line.productId)}</div>
        <div class="cart-sub">${line.qty} x ${formatMoney(line.unitPriceCents)} = ${formatMoney(line.lineTotalCents)} · cocina: ${line.kitchenStatus === 'PENDING' ? 'pendiente' : 'enviado'}</div>
        <div class="cart-actions-inline">
          <button class="qty-btn" data-action="open-tabs-line-dec" data-id="${line.id}" ${line.qty <= 1 ? 'disabled' : ''}>-</button>
          <button class="qty-btn" data-action="open-tabs-line-inc" data-id="${line.id}">+</button>
          <button class="remove-btn" data-action="open-tabs-line-remove" data-id="${line.id}">Quitar</button>
        </div>
      </div>
    `,
          )
          .join('')
      : '<div class="empty">Sin lineas en la tab seleccionada.</div>';

  const openTabsProducts = getItems();
  const selectedProductFallback = openTabsProducts[0]?.id || '';
  if (!state.openTabsSelectedProductId && selectedProductFallback) {
    state.openTabsSelectedProductId = selectedProductFallback;
  }

  const openTabsProductOptionsHtml = openTabsProducts
    .map(
      (item) => `
    <option value="${item.id}" ${item.id === state.openTabsSelectedProductId ? 'selected' : ''}>
      ${escapeHtml(item.name)} (${formatMoney(item.priceCents)})
    </option>
  `,
    )
    .join('');

  const openTabsHtml = state.openTabsOpen
    ? `
    <div class="modal-overlay">
      <div class="modal history-modal open-tabs-modal">
        <div class="settings-header">
          <h2>Open Tabs VIP</h2>
          <div class="settings-inline-status ${openTabsStatus}">
            ${state.openTabsLoading ? 'Cargando...' : escapeHtml(state.openTabsStatusMessage)}
          </div>
        </div>

        ${
          state.openTabsForceRefresh
            ? '<div class="status error">Conflicto detectado en sync. Refresca tab/snapshot antes de continuar.</div>'
            : ''
        }

        <div class="barcode-layout open-tabs-layout">
          <aside class="panel barcode-categories-panel">
            <div class="settings-section-title">Mesas</div>
            <div class="stack">${openTabsTablesHtml}</div>
            ${
              state.openTabsIsPosMaster
                ? `
              <div class="settings-section-title">Configurar mesas</div>
              <label class="field">
                <span>Prefijo</span>
                <input id="open-tabs-prefix" class="input" value="${escapeHtml(state.openTabsGeneratePrefixInput)}" />
              </label>
              <label class="field">
                <span>Cantidad</span>
                <input id="open-tabs-count" class="input" inputmode="numeric" value="${escapeHtml(state.openTabsGenerateCountInput)}" />
              </label>
              <label class="field">
                <span>Inicio</span>
                <input id="open-tabs-start-at" class="input" inputmode="numeric" value="${escapeHtml(state.openTabsGenerateStartAtInput)}" />
              </label>
              <button class="button secondary" data-action="open-tabs-configure" ${state.openTabsBusy ? 'disabled' : ''}>Guardar mesas</button>
            `
                : '<div class="empty">Solo POS Master puede configurar mesas.</div>'
            }
          </aside>

          <section class="panel barcode-items-panel">
            <div class="settings-section-title">Tabs abiertas</div>
            <div class="barcode-items-list">${openTabsListHtml}</div>
            <div class="settings-actions">
              <button class="button" data-action="open-tabs-open-tab" ${state.openTabsBusy ? 'disabled' : ''}>Abrir tab</button>
            </div>
          </section>

          <aside class="panel barcode-selection-panel">
            <div class="settings-section-title">Detalle tab</div>
            ${
              selectedTab
                ? `
              <div class="binding-selection-name">${escapeHtml(selectedTab.folioText)}</div>
              <div class="binding-selection-meta">Total: ${formatMoney(selectedTab.totalCents)}</div>
              <div class="binding-selection-meta">Version: ${selectedTab.tabVersionLocal}</div>
              <div class="binding-selection-meta">Cocina impresa: v${selectedTab.kitchenLastPrintedVersion}</div>
              <label class="field">
                <span>Producto</span>
                <select id="open-tabs-product" class="input">${openTabsProductOptionsHtml}</select>
              </label>
              <label class="field">
                <span>Cantidad</span>
                <input id="open-tabs-qty" class="input" inputmode="numeric" value="${escapeHtml(state.openTabsQtyInput)}" />
              </label>
              <label class="field">
                <span>Notas</span>
                <input id="open-tabs-notes" data-scan-capture="off" class="input" value="${escapeHtml(state.openTabsNotesInput)}" />
              </label>
              <button class="button" data-action="open-tabs-add-item" ${state.openTabsBusy ? 'disabled' : ''}>Agregar item</button>
              <div class="cart-list">${openTabsLinesHtml}</div>
              <label class="field">
                <span>Metodo de pago</span>
                <select id="open-tabs-payment" class="input">
                  <option value="efectivo" ${state.openTabsPaymentMethod === 'efectivo' ? 'selected' : ''}>Efectivo</option>
                  <option value="tarjeta" ${state.openTabsPaymentMethod === 'tarjeta' ? 'selected' : ''}>Tarjeta</option>
                </select>
              </label>
              <div class="settings-actions">
                <button class="button secondary" data-action="open-tabs-send-kitchen" ${state.openTabsBusy ? 'disabled' : ''}>Enviar cocina</button>
                <button class="button" data-action="open-tabs-close-paid" ${state.openTabsBusy ? 'disabled' : ''}>Cerrar cuenta</button>
                <button class="button secondary danger" data-action="open-tabs-cancel-tab" ${state.openTabsBusy ? 'disabled' : ''}>Cancelar tab</button>
              </div>
            `
                : '<div class="empty">Selecciona una tab para ver y editar lineas.</div>'
            }
          </aside>
        </div>

        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="open-tabs-close-modal" ${state.openTabsBusy ? 'disabled' : ''}>Cerrar</button>
        </div>
      </div>
    </div>
  `
    : '';

  const scannerDebugRows = state.scannerDebugState?.recentScans?.length
    ? state.scannerDebugState.recentScans
        .slice()
        .reverse()
        .map(
          (reading) => `
      <tr>
        <td>${formatDate(reading.receivedAt)}</td>
        <td>${escapeHtml(reading.code)}</td>
        <td>${escapeHtml(String(reading.source || 'n/a'))}</td>
      </tr>
    `,
        )
        .join('')
    : '<tr><td colspan="3">Sin lecturas recientes.</td></tr>';
  const scannerDebugLogs = state.scannerDebugState?.logs?.length
    ? state.scannerDebugState.logs
        .slice(-25)
        .map((log) => `${log.ts} [${log.level}] ${log.message} ${log.data ? JSON.stringify(log.data) : ''}`)
        .join('\\n')
    : '';
  const scannerDebugHtml = state.scannerDebugOpen
    ? `
    <div class="modal-overlay">
      <div class="modal history-modal">
        <div class="settings-header">
          <h2>Scanner Debug</h2>
          <div class="settings-inline-status ${state.scannerDebugLoading ? '' : 'success'}">
            ${
              state.scannerDebugLoading
                ? 'Cargando estado...'
                : `enabled=${state.scannerDebugState?.enabled ? 'true' : 'false'} · mode=${escapeHtml(
                    state.scannerDebugState?.context.mode || 'disabled',
                  )} · scanMode=${state.scannerDebugState?.scanModeActive ? 'true' : 'false'}`
            }
          </div>
        </div>
        <div class="jobs-table-wrap history-table-wrap">
          <table class="jobs-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Codigo</th>
                <th>Fuente</th>
              </tr>
            </thead>
            <tbody>${scannerDebugRows}</tbody>
          </table>
        </div>
        <label class="field">
          <span>Logs</span>
          <textarea id="scanner-debug-logs" class="input scanner-debug-logs" rows="12" readonly>${escapeHtml(scannerDebugLogs)}</textarea>
        </label>
        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="scanner-debug-refresh" ${state.scannerDebugLoading ? 'disabled' : ''}>Refrescar</button>
          <button class="button secondary" data-action="scanner-debug-copy">Copiar logs</button>
          <button class="button secondary" data-action="scanner-debug-close">Cerrar</button>
        </div>
      </div>
    </div>
  `
    : '';

  const headerActionsHtml = `
    <button class="button secondary" data-action="open-barcode-binding" ${state.busy ? 'disabled' : ''}>Vincular etiquetas</button>
    <button class="button secondary" data-action="open-settings" ${state.busy ? 'disabled' : ''}>Ajustes impresora</button>
    <button class="button secondary" data-action="scanner-debug-open" ${state.busy ? 'disabled' : ''}>Scanner debug</button>
    <button class="button secondary" data-action="open-order-history" ${
      state.busy || hasSaleInProgress() ? 'disabled' : ''
    }>Historial del dia</button>
    <button class="button secondary" data-action="toggle-table-mode" ${state.busy ? 'disabled' : ''}>
      ${state.tableModeEnabled ? 'Modo mesa: ON' : 'Modo mesa: OFF'}
    </button>
    <button class="button secondary" data-action="sync-outbox" ${state.manualSync.inFlight ? 'disabled' : ''}>
      ${state.manualSync.inFlight ? 'Sincronizando ordenes...' : 'Sincronizar ordenes'}
    </button>
    <button class="button secondary" data-action="sync-catalog" ${state.busy ? 'disabled' : ''}>Sincronizar catalogo</button>
  `;
  if (ui.headerActions && renderRuntime.regionSignature.header !== headerActionsHtml) {
    renderRuntime.regionSignature.header = headerActionsHtml;
    const headerRegion = ui.headerActions;
    renderRegion('header', () => {
      headerRegion.innerHTML = headerActionsHtml;
    });
  }
  const subtitleText = state.tableModeEnabled ? 'Operacion de mesas activa.' : 'Operacion local offline-first.';
  if (ui.topbarSubtitle) {
    ui.topbarSubtitle.textContent = subtitleText;
    ui.topbarSubtitle.title = state.status;
  }

  if (ui.categoriesRegion && renderRuntime.regionSignature.categories !== categoryHtml) {
    renderRuntime.regionSignature.categories = categoryHtml;
    const categoriesRegion = ui.categoriesRegion;
    renderRegion('categories', () => {
      categoriesRegion.innerHTML = categoryHtml;
    });
  }

  if (ui.productsRegion && renderRuntime.regionSignature.products !== productsHtml) {
    renderRuntime.regionSignature.products = productsHtml;
    const productsRegion = ui.productsRegion;
    renderRegion('products', () => {
      productsRegion.innerHTML = productsHtml;
    });
  }

  const cartPanelHtml = `
    <h2>${state.tableModeEnabled ? 'Mesa activa' : 'Carrito'}</h2>
    ${
      state.tableModeEnabled
        ? `<div class="cart-sub">${
            state.openTabsDetail?.tab
              ? `Mesa: ${escapeHtml(
                  state.openTabsSnapshot.tables.find((t) => t.id === state.openTabsDetail?.tab.posTableId)?.name || 'Sin mesa',
                )} | Tab: ${escapeHtml(state.openTabsDetail.tab.folioText)} | Estado: ${escapeHtml(
                  state.openTabsDetail.tab.status,
                )} | Pendientes cocina: ${state.openTabsDetail.pendingKitchenCount}`
              : 'Selecciona mesa/tab para operar.'
          }</div>`
        : ''
    }
    ${
      state.tableModeEnabled && state.openTabsDetail
        ? `<div class="cart-sub"><strong>Rondas cocina recientes</strong></div>${kitchenRoundsHtml}`
        : ''
    }
    <div class="cart-list">${cartHtml}</div>
    <div class="cart-footer">
      <div class="total-row">
        <span>Total</span>
        <strong>${formatMoney(totalCents)}</strong>
      </div>
      <div class="cart-actions">
        ${
          state.tableModeEnabled
            ? `
          <button class="button secondary" data-action="table-select-mesa" ${state.busy ? 'disabled' : ''}>Seleccionar mesa</button>
          <button class="button secondary" data-action="open-tabs-send-kitchen" ${
            state.busy || !state.openTabsSelectedTabId ? 'disabled' : ''
          }>Enviar cocina</button>
          <button class="button secondary" data-action="table-refresh-detail" ${
            state.busy || !state.openTabsSelectedTabId ? 'disabled' : ''
          }>Ver detalle</button>
          <button class="button secondary danger" data-action="open-tabs-cancel-tab" ${
            state.busy || !state.openTabsSelectedTabId ? 'disabled' : ''
          }>Cancelar</button>
          <button class="button" data-action="open-checkout" ${
            state.busy || !state.openTabsSelectedTabId || !tableLines.length ? 'disabled' : ''
          }>Cerrar cuenta</button>
        `
            : `
          <button class="button secondary" data-action="clear-cart" ${cartLines.length ? '' : 'disabled'}>Limpiar</button>
          <button class="button" data-action="open-checkout" ${cartLines.length ? '' : 'disabled'}>Confirmar pedido</button>
        `
        }
      </div>
    </div>
  `;
  if (ui.cartRegion && renderRuntime.regionSignature.cart !== cartPanelHtml) {
    renderRuntime.regionSignature.cart = cartPanelHtml;
    const cartRegion = ui.cartRegion;
    renderRegion('cart', () => {
      cartRegion.innerHTML = cartPanelHtml;
    });
  }

  const modalsHtml = `
    ${checkoutHtml}
    ${settingsHtml}
    ${barcodeBindingHtml}
    ${historyHtml}
    ${tabKitchenHistoryHtml}
    ${scannerDebugHtml}
    ${SHOW_OPEN_TABS_DEBUG ? openTabsHtml : ''}
    ${renderTableSelectorModal()}
    ${renderTablesSettingsModal()}
  `;
  if (ui.modalsRegion && renderRuntime.regionSignature.modals !== modalsHtml) {
    renderRuntime.regionSignature.modals = modalsHtml;
    const modalsRegion = ui.modalsRegion;
    renderRegion('modals', () => {
      modalsRegion.innerHTML = modalsHtml;
    });
  }

  updateStatusBarState();
  renderRegion('statusbar', () => {
    renderBottomStatusRegion();
  });

  if (refocusId) {
    const nextEl = document.getElementById(refocusId) as HTMLInputElement | HTMLTextAreaElement | null;
    if (nextEl && nextEl !== document.activeElement) {
      nextEl.focus();
      if (nextEl instanceof HTMLInputElement && prevSelectionStart !== null && prevSelectionEnd !== null) {
        nextEl.setSelectionRange(prevSelectionStart, prevSelectionEnd);
      }
    }
  }
}

function openBarcodeBinding(): void {
  state.barcodeBindingOpen = true;
  state.barcodeBindingStatusMessage = 'Selecciona un producto y escanea una etiqueta.';
  state.barcodeBindingStatusKind = 'info';
  ensureBarcodeBindingCategory();
  ensureBarcodeBindingSelection(getBarcodeBindingItems());
  void applyScanContext();
  render();
}

function closeBarcodeBinding(): void {
  if (state.barcodeBindingBusy) return;
  state.barcodeBindingOpen = false;
  void applyScanContext();
  render();
}

async function openScannerDebug(): Promise<void> {
  state.scannerDebugOpen = true;
  await refreshScannerDebugState();
}

function closeScannerDebug(): void {
  state.scannerDebugOpen = false;
  render();
}

async function copyScannerLogs(): Promise<void> {
  const logs = state.scannerDebugState?.logs || [];
  const content = logs
    .map((entry) => `${entry.ts} [${entry.level}] ${entry.message} ${entry.data ? JSON.stringify(entry.data) : ''}`)
    .join('\n');
  if (!content) {
    setStatus('No hay logs para copiar.', 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(content);
    setStatus('Logs de scanner copiados.', 'success');
  } catch {
    const area = document.getElementById('scanner-debug-logs') as HTMLTextAreaElement | null;
    area?.focus();
    area?.select();
    const ok = document.execCommand('copy');
    setStatus(ok ? 'Logs de scanner copiados.' : 'No se pudo copiar logs.', ok ? 'success' : 'error');
  }
}

function ensureRuntimeConfigMutable(): RuntimeConfig {
  if (!state.runtimeConfig) {
    state.runtimeConfig = resolveRuntimeConfigDefaults();
  }
  return state.runtimeConfig;
}

async function assignBarcodeToSelectedProduct(barcodeRaw: string): Promise<void> {
  const barcode = String(barcodeRaw || '').replace(/[\r\n\t]+/g, '').trim();
  if (!state.barcodeBindingOpen || !barcode) return;

  const itemId = state.barcodeBindingSelectedItemId;
  if (!itemId) {
    state.barcodeBindingStatusMessage = 'Selecciona un producto antes de escanear.';
    state.barcodeBindingStatusKind = 'error';
    render();
    return;
  }

  if (state.barcodeBindingBusy) return;

  state.barcodeBindingBusy = true;
  state.barcodeBindingStatusMessage = `Asignando etiqueta ${barcode}...`;
  state.barcodeBindingStatusKind = 'info';
  render();

  try {
    const result = await window.posKiosk.assignProductBarcode({ itemId, barcode });
    if (!result.ok) {
      state.barcodeBindingStatusMessage = result.error || 'No se pudo asignar la etiqueta.';
      state.barcodeBindingStatusKind = 'error';
      return;
    }

    if (state.snapshot) {
      state.snapshot.items = state.snapshot.items.map((item) =>
        item.id === itemId ? { ...item, barcode } : item,
      );
      resetDerivedCache();
    }

    state.barcodeBindingStatusMessage = `Etiqueta ${barcode} asignada correctamente.`;
    state.barcodeBindingStatusKind = 'success';
  } catch (error) {
    state.barcodeBindingStatusMessage =
      error instanceof Error ? error.message : 'Error al guardar etiqueta.';
    state.barcodeBindingStatusKind = 'error';
  } finally {
    state.barcodeBindingBusy = false;
    render();
  }
}

function addScannedProductToCart(barcodeRaw: string): void {
  if (state.busy || state.checkoutOpen || state.settingsOpen || state.ordersHistoryOpen)
    return;

  const product = findItemByBarcode(barcodeRaw);
  if (!product) {
    state.statusBar.scanner.phase = 'warn';
    state.statusBar.scanner.lastCode = barcodeRaw;
    state.statusBar.scanner.lastAt = new Date().toISOString();
    setStatus(`No existe producto con etiqueta: ${barcodeRaw}`, 'error');
    return;
  }

  if (state.tableModeEnabled && state.openTabsSelectedTabId) {
    void addItemToSelectedTab({ productId: product.id, qty: 1 });
    return;
  }

  adjustQty(product.id, 1);
  playScanFeedback();
  state.statusBar.scanner.phase = 'ok';
  state.statusBar.scanner.lastCode = barcodeRaw;
  state.statusBar.scanner.lastAt = new Date().toISOString();
  setStatus(`Escaneado: ${product.name} agregado al carrito.`, 'success');
}

async function handleScanReading(reading: ScannerReading): Promise<void> {
  state.statusBar.scanner.lastCode = reading.code;
  state.statusBar.scanner.lastAt = reading.receivedAt || new Date().toISOString();
  const mode = getScanModeByUiState();
  if (mode === 'assign') {
    await assignBarcodeToSelectedProduct(reading.code);
    render();
    return;
  }

  if (mode !== 'sale') return;
  addScannedProductToCart(reading.code);
  render();
}

async function loadCatalogFromLocal(): Promise<void> {
  state.snapshot = await window.posKiosk.getCatalog();
  resetDerivedCache();
  ensureActiveCategory();
}

async function syncCatalog(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  setStatus('Sincronizando catalogo...');
  try {
    const result = await window.posKiosk.syncCatalog();
    if (!result.ok) {
      setStatus(result.error || 'No se pudo sincronizar.', 'error');
      return;
    }
    await loadCatalogFromLocal();
    setStatus(`Sync completada: ${result.categoriesCount} categorias y ${result.itemsCount} productos.`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Error al sincronizar catalogo.', 'error');
  } finally {
    state.busy = false;
    render();
  }
}

async function loadSettingsData(): Promise<void> {
  const [printConfig, printJobs, runtimeConfig, isPosMaster] = await Promise.all([
    window.posKiosk.getPrintConfig(),
    window.posKiosk.listPrintJobs(20),
    window.posKiosk.getRuntimeConfig(),
    window.posKiosk.isPosMaster(),
  ]);
  state.printConfig = printConfig;
  state.printJobs = printJobs;
  state.runtimeConfig = runtimeConfig;
  state.openTabsIsPosMaster = isPosMaster;
}

async function openSettings(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.settingsOpen = true;
  state.settingsPendingAction = 'load';
  state.settingsStatusMessage = 'Cargando ajustes...';
  state.settingsStatusKind = 'info';
  void applyScanContext();
  render();

  try {
    await loadSettingsData();
    state.settingsStatusMessage = 'Ajustes cargados correctamente.';
    state.settingsStatusKind = 'success';
  } catch (error) {
    state.settingsStatusMessage = error instanceof Error ? error.message : 'No se pudieron cargar los ajustes.';
    state.settingsStatusKind = 'error';
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    render();
  }
}

function closeSettings(): void {
  if (state.busy) return;
  state.settingsOpen = false;
  void applyScanContext();
  render();
}

async function loadTablesSettings(): Promise<void> {
  state.tablesSettingsRows = await window.posKiosk.listOpenTabsTables(null);
}

async function openTablesSettings(): Promise<void> {
  if (state.tablesSettingsBusy || !state.openTabsIsPosMaster) return;
  state.tablesSettingsOpen = true;
  state.tablesSettingsLoading = true;
  render();
  try {
    await loadTablesSettings();
  } finally {
    state.tablesSettingsLoading = false;
    render();
  }
}

function closeTablesSettings(): void {
  if (state.tablesSettingsBusy) return;
  state.tablesSettingsOpen = false;
  state.tablesSettingsPreview = '';
  state.tablesSettingsConfirmText = '';
  render();
}

function buildTablesPreview(): string {
  const count = Number.parseInt(state.tablesSettingsGenerateCount || '0', 10);
  const startAt = Number.parseInt(state.tablesSettingsGenerateStartAt || '1', 10);
  const prefix = (state.tablesSettingsGeneratePrefix || 'Mesa').trim() || 'Mesa';
  if (!Number.isInteger(count) || count <= 0 || count > 200) {
    throw new Error('Cantidad invalida para generar mesas (1..200).');
  }
  if (!Number.isInteger(startAt) || startAt <= 0) {
    throw new Error('Inicio invalido para generar mesas.');
  }
  const end = startAt + count - 1;
  return `Vas a crear ${count} mesas: ${prefix} ${startAt}..${prefix} ${end}`;
}

async function previewTablesGeneration(): Promise<void> {
  try {
    state.tablesSettingsPreview = buildTablesPreview();
    state.tablesSettingsConfirmText = '';
    render();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'No se pudo generar preview.', 'error');
  }
}

async function confirmTablesGeneration(): Promise<void> {
  if (!state.tablesSettingsPreview) {
    setStatus('Primero genera el preview.', 'error');
    return;
  }
  if (state.tablesSettingsConfirmText.trim().toUpperCase() !== 'CONFIRMAR') {
    setStatus('Escribe CONFIRMAR para ejecutar la generacion.', 'error');
    return;
  }
  state.tablesSettingsBusy = true;
  render();
  try {
    const count = Number.parseInt(state.tablesSettingsGenerateCount || '0', 10);
    const startAt = Number.parseInt(state.tablesSettingsGenerateStartAt || '1', 10);
    const result = await window.posKiosk.configureOpenTabsTables({
      generate: {
        count,
        prefix: (state.tablesSettingsGeneratePrefix || 'Mesa').trim() || 'Mesa',
        startAt,
        isActive: true,
      },
    });
    if (!result.ok) throw new Error(result.error || 'No se pudieron generar mesas.');
    state.tablesSettingsPreview = '';
    state.tablesSettingsConfirmText = '';
    await loadTablesSettings();
    await refreshOpenTabsSnapshot(false);
    setStatus(`Mesas generadas: ${result.upserted}.`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Error generando mesas.', 'error');
  } finally {
    state.tablesSettingsBusy = false;
    render();
  }
}

async function saveTableName(tableId: string): Promise<void> {
  const input = document.getElementById(`table-name-${tableId}`) as HTMLInputElement | null;
  const name = (input?.value || '').trim();
  if (!name) {
    setStatus('El nombre de mesa no puede estar vacio.', 'error');
    return;
  }
  state.tablesSettingsBusy = true;
  render();
  try {
    const result = await window.posKiosk.updateOpenTabsTable({ tableId, name });
    if (!result.ok) throw new Error(result.error || 'No se pudo actualizar mesa.');
    await loadTablesSettings();
    await refreshOpenTabsSnapshot(false);
    setStatus('Mesa actualizada.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Error actualizando mesa.', 'error');
  } finally {
    state.tablesSettingsBusy = false;
    render();
  }
}

async function toggleTableActive(tableId: string, isActive: boolean): Promise<void> {
  state.tablesSettingsBusy = true;
  render();
  try {
    const result = await window.posKiosk.toggleOpenTabsTable({ tableId, isActive });
    if (!result.ok) throw new Error(result.error || 'No se pudo actualizar estado.');
    await loadTablesSettings();
    await refreshOpenTabsSnapshot(false);
    setStatus('Estado de mesa actualizado.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Error actualizando estado.', 'error');
  } finally {
    state.tablesSettingsBusy = false;
    render();
  }
}

async function deleteTableWithGuardrail(tableId: string): Promise<void> {
  const table = state.tablesSettingsRows.find((row) => row.id === tableId);
  if (!table) return;
  const expected = `ELIMINAR ${table.name}`;
  const typed = window.prompt(`Confirmacion fuerte:\nEscribe exactamente: ${expected}`) || '';
  if (typed.trim() !== expected) {
    setStatus('Eliminacion cancelada: confirmacion invalida.', 'info');
    return;
  }
  state.tablesSettingsBusy = true;
  render();
  try {
    const result = await window.posKiosk.deleteOpenTabsTable(tableId);
    if (!result.ok) throw new Error(result.error || 'No se pudo eliminar mesa.');
    await loadTablesSettings();
    await refreshOpenTabsSnapshot(false);
    setStatus('Mesa eliminada.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Error eliminando mesa.', 'error');
  } finally {
    state.tablesSettingsBusy = false;
    render();
  }
}

async function reorderTable(tableId: string, direction: 'up' | 'down'): Promise<void> {
  state.tablesSettingsBusy = true;
  render();
  try {
    const result = await window.posKiosk.reorderOpenTabsTable({ tableId, direction });
    if (!result.ok) throw new Error(result.error || 'No se pudo reordenar mesa.');
    await loadTablesSettings();
    await refreshOpenTabsSnapshot(false);
    setStatus('Orden de mesas actualizado.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Error reordenando mesas.', 'error');
  } finally {
    state.tablesSettingsBusy = false;
    render();
  }
}

async function loadOrderHistory(): Promise<void> {
  state.ordersHistory = await window.posKiosk.listOrderHistory(80);
}

async function openOrderHistory(): Promise<void> {
  if (state.busy || hasSaleInProgress()) {
    setStatus('Termina o limpia la venta en curso antes de abrir el historial.', 'info');
    return;
  }

  state.ordersHistoryOpen = true;
  state.ordersHistoryLoading = true;
  state.ordersHistoryStatusMessage = 'Cargando historial del dia...';
  state.ordersHistoryStatusKind = 'info';
  void applyScanContext();
  render();

  try {
    await loadOrderHistory();
    state.ordersHistoryStatusMessage = 'Historial actualizado.';
    state.ordersHistoryStatusKind = 'success';
  } catch (error) {
    state.ordersHistoryStatusMessage =
      error instanceof Error ? error.message : 'No se pudo cargar historial.';
    state.ordersHistoryStatusKind = 'error';
  } finally {
    state.ordersHistoryLoading = false;
    render();
  }
}

function closeOrderHistory(): void {
  if (state.ordersHistoryActionBusy) return;
  state.ordersHistoryOpen = false;
  void applyScanContext();
  render();
}

async function refreshOrderHistory(): Promise<void> {
  if (state.ordersHistoryLoading || state.ordersHistoryActionBusy) return;
  state.ordersHistoryLoading = true;
  state.ordersHistoryStatusMessage = 'Refrescando historial...';
  state.ordersHistoryStatusKind = 'info';
  render();
  try {
    await loadOrderHistory();
    state.ordersHistoryStatusMessage = 'Historial actualizado.';
    state.ordersHistoryStatusKind = 'success';
  } catch (error) {
    state.ordersHistoryStatusMessage =
      error instanceof Error ? error.message : 'No se pudo refrescar historial.';
    state.ordersHistoryStatusKind = 'error';
  } finally {
    state.ordersHistoryLoading = false;
    render();
  }
}

async function reprintOrderFromHistory(orderId: string): Promise<void> {
  if (state.ordersHistoryActionBusy) return;
  state.ordersHistoryActionBusy = true;
  state.ordersHistoryStatusMessage = 'Enviando reimpresion...';
  state.ordersHistoryStatusKind = 'info';
  render();

  try {
    const result = await window.posKiosk.reprintOrder(orderId);
    await loadOrderHistory();
    if (!result.ok) {
      state.ordersHistoryStatusMessage = result.error || 'No se pudo reimprimir.';
      state.ordersHistoryStatusKind = 'error';
      setStatus(state.ordersHistoryStatusMessage, 'error');
      return;
    }
    state.ordersHistoryStatusMessage = `Reimpresion enviada. Job: ${result.jobId || 'n/a'}`;
    state.ordersHistoryStatusKind = 'success';
    setStatus('Reimpresion enviada correctamente.', 'success');
    triggerSyncSoon();
  } catch (error) {
    state.ordersHistoryStatusMessage = error instanceof Error ? error.message : 'Error reimprimiendo.';
    state.ordersHistoryStatusKind = 'error';
    setStatus(state.ordersHistoryStatusMessage, 'error');
  } finally {
    state.ordersHistoryActionBusy = false;
    render();
  }
}

async function cancelOrderFromHistory(orderId: string): Promise<void> {
  if (state.ordersHistoryActionBusy) return;
  const accepted = window.confirm('Esta accion cancelara la orden seleccionada. Deseas continuar?');
  if (!accepted) return;

  state.ordersHistoryActionBusy = true;
  state.ordersHistoryStatusMessage = 'Cancelando orden...';
  state.ordersHistoryStatusKind = 'info';
  render();

  try {
    const result = await window.posKiosk.cancelOrder(orderId);
    await loadOrderHistory();
    if (!result.ok) {
      state.ordersHistoryStatusMessage = result.error || 'No se pudo cancelar la orden.';
      state.ordersHistoryStatusKind = 'error';
      setStatus(state.ordersHistoryStatusMessage, 'error');
      return;
    }
    state.ordersHistoryStatusMessage = 'Orden cancelada correctamente.';
    state.ordersHistoryStatusKind = 'success';
    setStatus('Orden cancelada y pendiente de sincronizacion.', 'success');
    triggerSyncSoon();
  } catch (error) {
    state.ordersHistoryStatusMessage = error instanceof Error ? error.message : 'Error cancelando orden.';
    state.ordersHistoryStatusKind = 'error';
    setStatus(state.ordersHistoryStatusMessage, 'error');
  } finally {
    state.ordersHistoryActionBusy = false;
    render();
  }
}

async function openTabKitchenHistory(tabId: string): Promise<void> {
  if (state.tabKitchenHistoryBusy) return;
  state.tabKitchenHistoryOpen = true;
  state.tabKitchenHistoryLoading = true;
  state.tabKitchenHistoryTabId = tabId;
  state.tabKitchenHistoryStatusMessage = 'Cargando comandas...';
  state.tabKitchenHistoryStatusKind = 'info';
  void applyScanContext();
  render();

  try {
    state.tabKitchenHistoryDetail = await window.posKiosk.getOpenTabDetail(tabId);
    state.tabKitchenHistoryStatusMessage = 'Comandas cargadas.';
    state.tabKitchenHistoryStatusKind = 'success';
  } catch (error) {
    state.tabKitchenHistoryStatusMessage = error instanceof Error ? error.message : 'No se pudo cargar comandas.';
    state.tabKitchenHistoryStatusKind = 'error';
  } finally {
    state.tabKitchenHistoryLoading = false;
    render();
  }
}

function closeTabKitchenHistory(): void {
  if (state.tabKitchenHistoryBusy) return;
  state.tabKitchenHistoryOpen = false;
  state.tabKitchenHistoryTabId = '';
  state.tabKitchenHistoryDetail = null;
  void applyScanContext();
  render();
}

async function reprintTabKitchenRound(mutationId: string): Promise<void> {
  if (!state.tabKitchenHistoryTabId || state.tabKitchenHistoryBusy) return;
  state.tabKitchenHistoryBusy = true;
  state.tabKitchenHistoryStatusMessage = 'Reimprimiendo comanda...';
  state.tabKitchenHistoryStatusKind = 'info';
  render();
  try {
    const result = await window.posKiosk.reprintKitchenRound({
      tabId: state.tabKitchenHistoryTabId,
      mutationId,
    });
    if (!result.ok) {
      state.tabKitchenHistoryStatusMessage = result.error || 'No se pudo reimprimir comanda.';
      state.tabKitchenHistoryStatusKind = 'error';
      return;
    }
    state.tabKitchenHistoryStatusMessage = `Comanda reimpresa. Job: ${result.jobId || 'n/a'}`;
    state.tabKitchenHistoryStatusKind = 'success';
  } catch (error) {
    state.tabKitchenHistoryStatusMessage = error instanceof Error ? error.message : 'Error reimprimiendo comanda.';
    state.tabKitchenHistoryStatusKind = 'error';
  } finally {
    state.tabKitchenHistoryBusy = false;
    render();
  }
}

async function cancelTabKitchenRound(mutationId: string): Promise<void> {
  if (!state.tabKitchenHistoryTabId || state.tabKitchenHistoryBusy) return;
  const accepted = window.confirm('Se imprimira una cancelacion de comanda. Deseas continuar?');
  if (!accepted) return;
  state.tabKitchenHistoryBusy = true;
  state.tabKitchenHistoryStatusMessage = 'Cancelando comanda...';
  state.tabKitchenHistoryStatusKind = 'info';
  render();
  try {
    const result = await window.posKiosk.cancelKitchenRound({
      tabId: state.tabKitchenHistoryTabId,
      mutationId,
      reason: 'canceled_from_history',
    });
    if (!result.ok) {
      state.tabKitchenHistoryStatusMessage = result.error || 'No se pudo cancelar comanda.';
      state.tabKitchenHistoryStatusKind = 'error';
      return;
    }
    state.tabKitchenHistoryDetail = await window.posKiosk.getOpenTabDetail(state.tabKitchenHistoryTabId);
    state.tabKitchenHistoryStatusMessage = `Comanda cancelada. Job: ${result.jobId || 'n/a'}`;
    state.tabKitchenHistoryStatusKind = 'success';
  } catch (error) {
    state.tabKitchenHistoryStatusMessage = error instanceof Error ? error.message : 'Error cancelando comanda.';
    state.tabKitchenHistoryStatusKind = 'error';
  } finally {
    state.tabKitchenHistoryBusy = false;
    render();
  }
}

function buildTestPrintRawBase64(): string {
  const encoder = new TextEncoder();
  const ESC = 0x1b;
  const GS = 0x1d;
  const now = new Date().toISOString();
  const rows: number[] = [
    ESC,
    0x40,
    ESC,
    0x61,
    0x01,
    ...Array.from(encoder.encode('POS KIOSK TEST\n')),
    ...Array.from(encoder.encode('PRINT V2 NATIVE\n')),
    ESC,
    0x61,
    0x00,
    ...Array.from(encoder.encode(`Fecha: ${now}\n`)),
    ...Array.from(encoder.encode('------------------------------\n')),
    ...Array.from(encoder.encode('1x Ticket de prueba      $0.00\n')),
    ...Array.from(encoder.encode('------------------------------\n')),
    ...Array.from(encoder.encode('TOTAL:                  $0.00\n')),
    ...Array.from(encoder.encode('\n\n\n')),
    GS,
    0x56,
    0x00,
  ];

  const bytes = new Uint8Array(rows);
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

async function confirmSale(): Promise<void> {
  if (!canConfirmPayment()) return;
  state.enterConfirmArmedAt = null;
  state.statusBar.print.phase = 'working';
  state.statusBar.print.lastErrorShort = '';

  if (state.tableModeEnabled) {
    if (!state.openTabsSelectedTabId) {
      setStatus('Selecciona una tab antes de cerrar cuenta.', 'error');
      return;
    }
    if (hasPendingKitchenDelta()) {
      const accepted = window.confirm(
        'Hay productos pendientes de enviar a cocina. Confirmas cerrar la cuenta de todos modos?',
      );
      if (!accepted) {
        setStatus('Cierre cancelado. Primero envia a cocina o confirma explicitamente.', 'info');
        return;
      }
    }
    state.busy = true;
    render();
    try {
      const totalCents = getActiveTabTotalCents();
      const pagoRecibidoCents =
        state.checkoutPaymentMethod === 'tarjeta' ? totalCents : parseReceivedCents();
      const result = await window.posKiosk.closeTabPaid({
        tabId: state.openTabsSelectedTabId,
        metodoPago: state.checkoutPaymentMethod,
        pagoRecibidoCents,
      });

      if (!result.ok) {
        throw new Error(result.error || 'No se pudo cerrar la cuenta.');
      }

      state.checkoutOpen = false;
      state.receivedInput = '';
      void applyScanContext();
      state.openTabsSelectedTabId = '';
      await refreshOpenTabsSnapshot(false);
      triggerSyncSoon();

      if (result.printStatus === 'FAILED') {
        state.statusBar.print.phase = 'error';
        state.statusBar.print.lastErrorShort = result.error || 'fallo impresion';
        setStatus('Cuenta cerrada, pero fallo la impresion final.', 'error');
      } else {
        state.statusBar.print.phase = 'ok';
        setStatus('Cuenta cerrada e impresa correctamente.', 'success');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error cerrando cuenta de mesa.', 'error');
    } finally {
      state.busy = false;
      render();
    }
    return;
  }

  const lines = getCartLines().map((line) => ({
    catalogItemId: line.item.id,
    name: line.item.name,
    qty: line.qty,
    unitPriceCents: line.item.priceCents,
  }));

  state.busy = true;
  render();

  try {
    const result = await window.posKiosk.createSaleAndPrint({
      lines,
      pagoRecibidoCents: parseReceivedCents(),
      metodoPago: state.checkoutPaymentMethod,
    });

    if (!result.ok) {
      throw new Error(result.error || 'No se pudo confirmar la venta.');
    }

    clearCart();
    state.checkoutOpen = false;
    state.receivedInput = '';
    void applyScanContext();

    if (result.printStatus === 'FAILED') {
      state.statusBar.print.phase = 'error';
      state.statusBar.print.lastErrorShort = result.error || 'fallo impresion';
      setStatus(`Venta ${result.folioText || ''} guardada localmente. Error de impresion: ${result.error || 'sin detalle'}.`, 'error');
    } else if (result.printStatus === 'QUEUED') {
      state.statusBar.print.phase = 'working';
      state.statusBar.print.lastErrorShort = '';
      setStatus(`Venta ${result.folioText || ''} guardada. Impresion en cola.`, 'success');
    } else {
      state.statusBar.print.phase = 'ok';
      setStatus(`Venta ${result.folioText || ''} guardada e impresa.`, 'success');
    }
    triggerSyncSoon();
  } catch (error) {
    state.statusBar.print.phase = 'error';
    state.statusBar.print.lastErrorShort = error instanceof Error ? error.message : 'error impresion';
    setStatus(error instanceof Error ? error.message : 'Error confirmando venta.', 'error');
  } finally {
    state.busy = false;
    render();
  }
}

async function saveSettings(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.settingsPendingAction = 'save';
  state.settingsStatusMessage = 'Guardando ajustes...';
  state.settingsStatusKind = 'info';
  render();

  try {
    if (state.printConfig) {
      state.printConfig = await window.posKiosk.setPrintConfig(state.printConfig);
    }
    if (state.runtimeConfig) {
      state.runtimeConfig = await window.posKiosk.setRuntimeConfig(state.runtimeConfig);
      await window.posScanner.setSettings(runtimeScannerSettingsToInput(state.runtimeConfig));
      await applyScanContext();
    }
    state.settingsStatusMessage = 'Ajustes guardados correctamente.';
    state.settingsStatusKind = 'success';
  } catch (error) {
    state.settingsStatusMessage = error instanceof Error ? error.message : 'No se pudieron guardar ajustes.';
    state.settingsStatusKind = 'error';
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    render();
  }
}

async function refreshPrintJobs(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.settingsPendingAction = 'refresh-jobs';
  state.settingsStatusMessage = 'Refrescando jobs...';
  state.settingsStatusKind = 'info';
  render();

  try {
    state.printJobs = await window.posKiosk.listPrintJobs(20);
    state.settingsStatusMessage = 'Jobs de impresion actualizados.';
    state.settingsStatusKind = 'success';
  } catch (error) {
    state.settingsStatusMessage = error instanceof Error ? error.message : 'No se pudieron cargar jobs.';
    state.settingsStatusKind = 'error';
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    render();
  }
}

async function printTest(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.statusBar.print.phase = 'working';
  state.statusBar.print.lastErrorShort = '';
  state.settingsPendingAction = 'print-test';
  state.settingsStatusMessage = 'Enviando impresion de prueba...';
  state.settingsStatusKind = 'info';
  render();

  try {
    const result = await window.posKiosk.printV2({ rawBase64: buildTestPrintRawBase64(), jobName: 'test_print_v2' });
    if (!result.ok) throw new Error(result.error || 'No se pudo imprimir prueba.');
    await loadSettingsData();
    state.statusBar.print.phase = 'ok';
    state.settingsStatusMessage = `Prueba enviada. Job: ${result.jobId}`;
    state.settingsStatusKind = 'success';
  } catch (error) {
    state.statusBar.print.phase = 'error';
    state.statusBar.print.lastErrorShort = error instanceof Error ? error.message : 'error impresion';
    state.settingsStatusMessage = error instanceof Error ? error.message : 'Error al imprimir prueba.';
    state.settingsStatusKind = 'error';
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    render();
  }
}

async function syncOutbox(manual = false): Promise<void> {
  if (manual) {
    if (state.manualSync.inFlight) return;
    state.manualSync.inFlight = true;
  }
  render();

  try {
    const result = await window.posKiosk.syncOutbox(manual ? 'manual' : 'auto');
    state.syncLastAt = result.lastSyncedAt || state.syncLastAt || new Date().toISOString();
    state.syncPendingLegacy = Number.isFinite(result.pendingLegacy) ? Number(result.pendingLegacy) : state.syncPendingLegacy;
    state.syncPendingTabs = Number.isFinite(result.pendingTabs) ? Number(result.pendingTabs) : state.syncPendingTabs;
    state.syncPendingTotal = Number.isFinite(result.pending) ? Number(result.pending) : state.syncPendingTotal;
    state.syncLastError = result.ok ? '' : result.error || 'Sync parcial/fallida.';
    state.autoSync.pendingTotal = state.syncPendingTotal;
    state.autoSync.lastErrorShort = state.syncLastError;
    if (result.ok) {
      state.autoSync.phase = state.syncPendingTotal > 0 ? 'retrying' : 'ok';
      state.autoSync.lastOkAt = result.lastSyncedAt || new Date().toISOString();
    } else {
      state.autoSync.phase = 'retrying';
    }

    if (manual && !result.ok) {
      setStatus(
        `Sync parcial/fallida. Procesados: ${result.processed}, enviados: ${result.sent}, fallidos: ${result.failed}, pendientes: ${result.pending}. ${result.error || ''}`,
        'error',
      );
      state.manualSync.lastError = result.error || 'Sync parcial/fallida.';
    } else if (manual) {
      setStatus(
        `Sync OK. Procesados: ${result.processed}, enviados: ${result.sent}, pendientes: ${result.pending}.`,
        'success',
      );
      state.manualSync.lastError = '';
      state.manualSync.lastResultAt = new Date().toISOString();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error sincronizando outbox.';
    state.syncLastError = message;
    state.autoSync.lastErrorShort = message;
    state.autoSync.phase = 'retrying';
    if (manual) {
      state.manualSync.lastError = message;
      setStatus(message, 'error');
    }
  } finally {
    if (manual) state.manualSync.inFlight = false;
    await refreshSyncStatus();
    render();
  }
}

async function refreshSyncStatus(): Promise<void> {
  try {
    const status = await window.posKiosk.getSyncStatus();
    state.syncPendingLegacy = status.pendingLegacy;
    state.syncPendingTabs = status.pendingTabs;
    state.syncPendingTotal = status.pendingTotal;
    state.autoSync.pendingTotal = status.pendingTotal;
    if (status.phase) state.autoSync.phase = status.phase;
    if (typeof status.lastErrorShort === 'string') state.autoSync.lastErrorShort = status.lastErrorShort;
    if (typeof status.lastOkAt !== 'undefined') state.autoSync.lastOkAt = status.lastOkAt || null;
  } catch {
    // Ignore status refresh errors to avoid blocking UI.
  }
}

function triggerSyncSoon(): void {
  void syncOutbox(false);
}

async function configureOpenTabsTables(): Promise<void> {
  if (state.openTabsBusy) return;
  const count = Number.parseInt(state.openTabsGenerateCountInput || '0', 10);
  const startAt = Number.parseInt(state.openTabsGenerateStartAtInput || '1', 10);
  if (!Number.isInteger(count) || count <= 0) {
    setOpenTabsStatus('Cantidad de mesas invalida.', 'error');
    render();
    return;
  }

  state.openTabsBusy = true;
  setOpenTabsStatus('Guardando configuracion de mesas...', 'info');
  render();

  try {
    const result = await window.posKiosk.configureOpenTabsTables({
      generate: {
        count,
        prefix: state.openTabsGeneratePrefixInput || 'Mesa',
        startAt,
        isActive: true,
      },
    });
    if (!result.ok) {
      setOpenTabsStatus(result.error || 'No se pudo configurar mesas.', 'error');
      return;
    }
    await refreshOpenTabsSnapshot(false);
    setOpenTabsStatus(`Mesas configuradas (${result.upserted}).`, 'success');
  } catch (error) {
    setOpenTabsStatus(error instanceof Error ? error.message : 'Error configurando mesas.', 'error');
  } finally {
    state.openTabsBusy = false;
    render();
  }
}

async function openTabForSelectedTable(): Promise<void> {
  if (state.openTabsBusy) return;
  state.openTabsBusy = true;
  setOpenTabsStatus('Abriendo mesa...', 'info');
  render();

  try {
    const result = await window.posKiosk.openTab({
      posTableId: state.openTabsSelectedTableId || null,
    });
    if (!result.ok || !result.tabId) {
      setOpenTabsStatus(result.error || 'No se pudo abrir mesa.', 'error');
      return;
    }
    state.openTabsSelectedTabId = result.tabId;
    await refreshOpenTabsSnapshot(true);
    setOpenTabsStatus(`Mesa abierta: ${result.folioText || result.tabId}.`, 'success');
    triggerSyncSoon();
  } catch (error) {
    setOpenTabsStatus(error instanceof Error ? error.message : 'Error abriendo mesa.', 'error');
  } finally {
    state.openTabsBusy = false;
    render();
  }
}

async function addItemToSelectedTab(input?: { productId?: string; qty?: number }): Promise<void> {
  if (state.openTabsBusy) return;
  if (!state.openTabsSelectedTabId) {
    setOpenTabsStatus('Selecciona una tab abierta.', 'error');
    render();
    return;
  }
  const productId = input?.productId || state.openTabsSelectedProductId;
  if (!productId) {
    setOpenTabsStatus('Selecciona un producto.', 'error');
    render();
    return;
  }
  const qty = Number.isInteger(input?.qty) ? Number(input?.qty) : Number.parseInt(state.openTabsQtyInput || '1', 10);
  if (!Number.isInteger(qty) || qty <= 0) {
    setOpenTabsStatus('Cantidad invalida.', 'error');
    render();
    return;
  }

  state.openTabsBusy = true;
  setOpenTabsStatus('Agregando item...', 'info');
  render();

  try {
    const result = await window.posKiosk.addTabItem({
      tabId: state.openTabsSelectedTabId,
      productId,
      qty,
      notes: state.openTabsNotesInput || null,
    });
    if (!result.ok) {
      setOpenTabsStatus(result.error || 'No se pudo agregar item.', 'error');
      return;
    }
    await refreshOpenTabsSnapshot(true);
    setOpenTabsStatus('Item agregado a la tab.', 'success');
    triggerSyncSoon();
  } catch (error) {
    setOpenTabsStatus(error instanceof Error ? error.message : 'Error agregando item.', 'error');
  } finally {
    state.openTabsBusy = false;
    render();
  }
}

async function updateTabLine(lineId: string, qty: number): Promise<void> {
  if (state.openTabsBusy || !state.openTabsSelectedTabId) return;
  state.openTabsBusy = true;
  setOpenTabsStatus('Actualizando cantidad...', 'info');
  render();
  try {
    const result = await window.posKiosk.updateTabLineQty({
      tabId: state.openTabsSelectedTabId,
      lineId,
      qty,
    });
    if (!result.ok) {
      setOpenTabsStatus(result.error || 'No se pudo actualizar cantidad.', 'error');
      return;
    }
    await refreshOpenTabsSnapshot(true);
    setOpenTabsStatus('Cantidad actualizada.', 'success');
    triggerSyncSoon();
  } catch (error) {
    setOpenTabsStatus(error instanceof Error ? error.message : 'Error actualizando cantidad.', 'error');
  } finally {
    state.openTabsBusy = false;
    render();
  }
}

async function removeTabLine(lineId: string): Promise<void> {
  if (state.openTabsBusy || !state.openTabsSelectedTabId) return;
  state.openTabsBusy = true;
  setOpenTabsStatus('Removiendo item...', 'info');
  render();
  try {
    const result = await window.posKiosk.removeTabLine({
      tabId: state.openTabsSelectedTabId,
      lineId,
      reason: 'removed_by_waiter',
    });
    if (!result.ok) {
      setOpenTabsStatus(result.error || 'No se pudo remover item.', 'error');
      return;
    }
    await refreshOpenTabsSnapshot(true);
    setOpenTabsStatus('Item removido.', 'success');
    triggerSyncSoon();
  } catch (error) {
    setOpenTabsStatus(error instanceof Error ? error.message : 'Error removiendo item.', 'error');
  } finally {
    state.openTabsBusy = false;
    render();
  }
}

async function sendSelectedTabToKitchen(): Promise<void> {
  if (state.openTabsBusy || !state.openTabsSelectedTabId) return;
  state.openTabsBusy = true;
  state.statusBar.print.phase = 'working';
  state.statusBar.print.lastErrorShort = '';
  setOpenTabsStatus('Enviando a cocina...', 'info');
  render();
  try {
    const result = await window.posKiosk.sendTabToKitchen({ tabId: state.openTabsSelectedTabId });
    await refreshOpenTabsSnapshot(true);
    if (!result.ok) {
      state.statusBar.print.phase = 'error';
      state.statusBar.print.lastErrorShort = result.error || 'fallo impresion';
      setOpenTabsStatus(
        `Impresion fallida, pero se registro evento de error para sync. ${result.error || ''}`.trim(),
        'error',
      );
      triggerSyncSoon();
      return;
    }
    state.statusBar.print.phase = 'ok';
    setOpenTabsStatus(`Comanda enviada a cocina. Job ${result.jobId || 'n/a'}.`, 'success');
    triggerSyncSoon();
  } catch (error) {
    state.statusBar.print.phase = 'error';
    state.statusBar.print.lastErrorShort = error instanceof Error ? error.message : 'error impresion';
    setOpenTabsStatus(error instanceof Error ? error.message : 'Error enviando a cocina.', 'error');
  } finally {
    state.openTabsBusy = false;
    render();
  }
}

async function closeSelectedTabPaid(): Promise<void> {
  if (state.openTabsBusy || !state.openTabsSelectedTabId) return;
  if (hasPendingKitchenDelta()) {
    const accepted = window.confirm(
      'Hay productos pendientes de enviar a cocina. Confirmas cerrar la cuenta de todos modos?',
    );
    if (!accepted) {
      setOpenTabsStatus('Cierre cancelado por pendientes de cocina.', 'info');
      render();
      return;
    }
  }
  state.openTabsBusy = true;
  setOpenTabsStatus('Cerrando cuenta...', 'info');
  render();
  try {
    const result = await window.posKiosk.closeTabPaid({
      tabId: state.openTabsSelectedTabId,
      metodoPago: state.openTabsPaymentMethod,
    });
    if (!result.ok) {
      setOpenTabsStatus(result.error || 'No se pudo cerrar cuenta.', 'error');
      return;
    }
    state.openTabsSelectedTabId = '';
    await refreshOpenTabsSnapshot(false);
    setOpenTabsStatus(
      result.printStatus === 'FAILED'
        ? `Cuenta cerrada con error de impresion final.${result.error ? ` ${result.error}` : ''}`
        : 'Cuenta cerrada (PAID).',
      result.printStatus === 'FAILED' ? 'error' : 'success',
    );
    triggerSyncSoon();
  } catch (error) {
    setOpenTabsStatus(error instanceof Error ? error.message : 'Error cerrando cuenta.', 'error');
  } finally {
    state.openTabsBusy = false;
    render();
  }
}

async function cancelSelectedTab(): Promise<void> {
  if (state.openTabsBusy || !state.openTabsSelectedTabId) return;
  const accepted = window.confirm('Se cancelara esta tab. Deseas continuar?');
  if (!accepted) return;

  state.openTabsBusy = true;
  setOpenTabsStatus('Cancelando tab...', 'info');
  render();
  try {
    const result = await window.posKiosk.cancelTab(state.openTabsSelectedTabId);
    if (!result.ok) {
      setOpenTabsStatus(result.error || 'No se pudo cancelar tab.', 'error');
      return;
    }
    state.openTabsSelectedTabId = '';
    await refreshOpenTabsSnapshot(false);
    setOpenTabsStatus('Tab cancelada.', 'success');
    triggerSyncSoon();
  } catch (error) {
    setOpenTabsStatus(error instanceof Error ? error.message : 'Error cancelando tab.', 'error');
  } finally {
    state.openTabsBusy = false;
    render();
  }
}

app.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target) return;
  const id = target.id;

  if (id === 'input-received') {
    state.receivedInput = target.value.replace(/\D/g, '');
    state.enterConfirmArmedAt = null;
    queueRender('input-received');
    return;
  }
  if (id === 'binding-search-input') {
    state.barcodeBindingSearch = target.value;
    state.barcodeBindingStatusMessage = 'Selecciona un producto y escanea una etiqueta.';
    state.barcodeBindingStatusKind = 'info';
    queueRender('binding-search');
    return;
  }
  if (id === 'open-tabs-prefix') {
    state.openTabsGeneratePrefixInput = target.value;
    return;
  }
  if (id === 'open-tabs-count') {
    state.openTabsGenerateCountInput = target.value.replace(/\D/g, '');
    return;
  }
  if (id === 'open-tabs-start-at') {
    state.openTabsGenerateStartAtInput = target.value.replace(/\D/g, '');
    return;
  }
  if (id === 'open-tabs-qty') {
    state.openTabsQtyInput = target.value.replace(/\D/g, '');
    return;
  }
  if (id === 'open-tabs-notes') {
    state.openTabsNotesInput = target.value;
    return;
  }
  if (id === 'tables-generate-prefix') {
    state.tablesSettingsGeneratePrefix = target.value;
    return;
  }
  if (id === 'tables-generate-count') {
    state.tablesSettingsGenerateCount = target.value.replace(/\D/g, '');
    return;
  }
  if (id === 'tables-generate-start-at') {
    state.tablesSettingsGenerateStartAt = target.value.replace(/\D/g, '');
    return;
  }
  if (id === 'tables-generate-confirm') {
    state.tablesSettingsConfirmText = target.value;
    return;
  }

  const runtime = ensureRuntimeConfigMutable();
  if (!state.printConfig) state.printConfig = { linuxPrinterName: '', windowsPrinterShare: '' };
  if (id === 'settings-linux-printer') state.printConfig.linuxPrinterName = target.value;
  else if (id === 'settings-windows-printer') state.printConfig.windowsPrinterShare = target.value;
  else if (id === 'settings-tenant-slug') runtime.tenantSlug = target.value || null;
  else if (id === 'settings-device-id') runtime.deviceId = target.value || null;
  else if (id === 'settings-device-secret') runtime.deviceSecret = target.value || null;
  else if (id === 'settings-tenant-id') runtime.tenantId = target.value || null;
  else if (id === 'settings-kiosk-id') runtime.kioskId = target.value || null;
  else if (id === 'settings-kiosk-number') {
    const value = Number.parseInt(target.value.replace(/\D/g, ''), 10);
    runtime.kioskNumber = Number.isFinite(value) ? value : null;
  } else if (id === 'settings-scanner-min-len') runtime.scannerMinCodeLen = Number.parseInt(target.value, 10) || null;
  else if (id === 'settings-scanner-max-len') runtime.scannerMaxCodeLen = Number.parseInt(target.value, 10) || null;
  else if (id === 'settings-scanner-max-interkey') runtime.scannerMaxInterKeyMsScan = Number.parseInt(target.value, 10) || null;
  else if (id === 'settings-scanner-end-gap') runtime.scannerScanEndGapMs = Number.parseInt(target.value, 10) || null;
  else if (id === 'settings-scanner-human-gap') runtime.scannerHumanKeyGapMs = Number.parseInt(target.value, 10) || null;
  else if (id === 'settings-scanner-allowed-pattern') runtime.scannerAllowedCharsPattern = target.value || null;
});

app.addEventListener('change', (event) => {
  const target = event.target as HTMLSelectElement | null;
  if (!target) return;
  const id = target.id;
  if (id === 'checkout-payment-method') {
    state.checkoutPaymentMethod = target.value === 'tarjeta' ? 'tarjeta' : 'efectivo';
    if (state.checkoutPaymentMethod === 'tarjeta') state.receivedInput = '';
    queueRender('checkout-payment-method');
    return;
  }
  if (id === 'open-tabs-product') {
    state.openTabsSelectedProductId = target.value;
    return;
  }
  if (id === 'open-tabs-payment') {
    state.openTabsPaymentMethod = target.value === 'tarjeta' ? 'tarjeta' : 'efectivo';
    return;
  }
  if (id === 'settings-scanner-enter-terminator') {
    ensureRuntimeConfigMutable().scannerAllowEnterTerminator = target.value === '1';
  }
});

app.addEventListener('keydown', async (event) => {
  const target = event.target as HTMLElement | null;
  if (!target || target.id !== 'input-received') return;
  if (event.key !== 'Enter' || event.repeat) return;
  event.preventDefault();

  if (!canConfirmPayment()) {
    state.enterConfirmArmedAt = null;
    setStatus('Pago insuficiente para confirmar la venta.', 'error');
    return;
  }

  const now = Date.now();
  if (state.enterConfirmArmedAt && now - state.enterConfirmArmedAt <= ENTER_CONFIRM_WINDOW_MS) {
    state.enterConfirmArmedAt = null;
    await confirmSale();
    return;
  }

  state.enterConfirmArmedAt = now;
  setStatus('Presiona Enter de nuevo para confirmar e imprimir.', 'info');
});

app.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const actionEl = target.closest('[data-action]') as HTMLElement | null;
  if (!actionEl) return;

  const action = actionEl.dataset.action || '';
  const id = actionEl.dataset.id || '';

  switch (action) {
    case 'toggle-render-metrics':
      renderRuntime.metricsEnabled = !renderRuntime.metricsEnabled;
      setStatus(`Metricas de render ${renderRuntime.metricsEnabled ? 'activadas' : 'desactivadas'}.`, 'info');
      break;
    case 'toggle-table-mode':
      if (state.tableModeEnabled) {
        deactivateTableMode();
      } else {
        await activateTableMode();
      }
      break;
    case 'open-tables-settings':
      await openTablesSettings();
      break;
    case 'close-tables-settings':
      closeTablesSettings();
      break;
    case 'tables-generate-preview':
      await previewTablesGeneration();
      break;
    case 'tables-generate-confirm':
      await confirmTablesGeneration();
      break;
    case 'tables-row-save':
      await saveTableName(id);
      break;
    case 'tables-row-toggle':
      await toggleTableActive(id, actionEl.dataset.active !== '1');
      break;
    case 'tables-row-delete':
      await deleteTableWithGuardrail(id);
      break;
    case 'tables-row-up':
      await reorderTable(id, 'up');
      break;
    case 'tables-row-down':
      await reorderTable(id, 'down');
      break;
    case 'table-select-mesa':
      if (!state.tableModeEnabled) break;
      state.tableSelectorOpen = true;
      state.tableSelectorSelectedTableId =
        state.openTabsSelectedTableId || state.openTabsSnapshot.tables[0]?.id || '';
      render();
      break;
    case 'table-select-option':
      state.tableSelectorSelectedTableId = id;
      render();
      break;
    case 'table-confirm-select':
      await confirmTableSelection();
      break;
    case 'table-cancel-select':
      state.tableSelectorOpen = false;
      if (!state.openTabsSelectedTabId && state.tableModeEnabled) {
        deactivateTableMode();
      } else {
        render();
      }
      break;
    case 'table-refresh-detail':
      if (state.openTabsSelectedTabId) {
        await openTabKitchenHistory(state.openTabsSelectedTabId);
      }
      break;
    case 'open-open-tabs':
      if (SHOW_OPEN_TABS_DEBUG) await openOpenTabsModal();
      break;
    case 'open-tabs-close-modal':
      if (SHOW_OPEN_TABS_DEBUG) closeOpenTabsModal();
      break;
    case 'open-tabs-configure':
      await configureOpenTabsTables();
      break;
    case 'open-tabs-select-table':
      state.openTabsSelectedTableId = id;
      render();
      break;
    case 'open-tabs-open-tab':
      await openTabForSelectedTable();
      break;
    case 'open-tabs-select-tab':
      state.openTabsSelectedTabId = id;
      state.openTabsLoading = true;
      render();
      try {
        await refreshOpenTabsDetail(id);
      } catch (error) {
        setOpenTabsStatus(error instanceof Error ? error.message : 'No se pudo cargar detalle tab.', 'error');
      } finally {
        state.openTabsLoading = false;
        render();
      }
      break;
    case 'open-tabs-add-item':
      await addItemToSelectedTab();
      break;
    case 'open-tabs-line-dec': {
      const line = state.openTabsDetail?.lines.find((row) => row.id === id);
      if (line && line.qty > 1) {
        await updateTabLine(id, line.qty - 1);
      }
      break;
    }
    case 'open-tabs-line-inc': {
      const line = state.openTabsDetail?.lines.find((row) => row.id === id);
      if (line) {
        await updateTabLine(id, line.qty + 1);
      }
      break;
    }
    case 'open-tabs-line-remove':
      await removeTabLine(id);
      break;
    case 'open-tabs-send-kitchen':
      await sendSelectedTabToKitchen();
      break;
    case 'open-tabs-close-paid':
      await closeSelectedTabPaid();
      break;
    case 'open-tabs-cancel-tab':
      await cancelSelectedTab();
      break;
    case 'open-barcode-binding':
      openBarcodeBinding();
      break;
    case 'close-barcode-binding':
      closeBarcodeBinding();
      break;
    case 'binding-filter-category':
      state.barcodeBindingCategoryId = id;
      render();
      break;
    case 'binding-select-item':
      state.barcodeBindingSelectedItemId = id;
      state.barcodeBindingStatusMessage = 'Producto listo. Escanea la etiqueta para guardarla.';
      state.barcodeBindingStatusKind = 'info';
      void applyScanContext();
      render();
      break;
    case 'sync-catalog':
      await syncCatalog();
      break;
    case 'open-settings':
      await openSettings();
      break;
    case 'scanner-debug-open':
      await openScannerDebug();
      break;
    case 'scanner-debug-close':
      closeScannerDebug();
      break;
    case 'scanner-debug-refresh':
      await refreshScannerDebugState();
      break;
    case 'scanner-debug-copy':
      await copyScannerLogs();
      break;
    case 'open-order-history':
      await openOrderHistory();
      break;
    case 'close-order-history':
      closeOrderHistory();
      break;
    case 'tab-kitchen-history':
      await openTabKitchenHistory(id);
      break;
    case 'close-tab-kitchen-history':
      closeTabKitchenHistory();
      break;
    case 'tab-round-reprint':
      await reprintTabKitchenRound(id);
      break;
    case 'tab-round-cancel':
      await cancelTabKitchenRound(id);
      break;
    case 'history-refresh':
      await refreshOrderHistory();
      break;
    case 'order-reprint':
      await reprintOrderFromHistory(id);
      break;
    case 'order-cancel':
      await cancelOrderFromHistory(id);
      break;
    case 'close-settings':
      closeSettings();
      break;
    case 'settings-save-all':
      await saveSettings();
      break;
    case 'settings-refresh-all':
      await openSettings();
      break;
    case 'settings-refresh-jobs':
      await refreshPrintJobs();
      break;
    case 'settings-print-test':
      await printTest();
      break;
    case 'sync-outbox':
      await syncOutbox(true);
      break;
    case 'select-category':
      state.activeCategoryId = id;
      render();
      break;
    case 'add-item':
      if (state.tableModeEnabled) {
        await addItemToSelectedTab({ productId: id, qty: 1 });
      } else {
        adjustQty(id, 1);
      }
      break;
    case 'inc-item':
      adjustQty(id, 1);
      break;
    case 'dec-item':
      adjustQty(id, -1);
      break;
    case 'remove-item':
      state.cartQtyByItemId.delete(id);
      render();
      break;
    case 'clear-cart':
      clearCart();
      setStatus('Carrito limpiado.');
      break;
    case 'open-checkout':
      openCheckout();
      break;
    case 'cancel-checkout':
      closeCheckout();
      setStatus('Cobro cancelado.');
      break;
    case 'quick-amount': {
      const value = Number.parseInt(actionEl.dataset.value || '0', 10);
      state.receivedInput = Number.isFinite(value) ? String(value) : '';
      render();
      break;
    }
    case 'exact-amount':
      state.receivedInput = String(Math.ceil(getCurrentSaleTotalCents() / 100));
      render();
      break;
    case 'confirm-sale':
      await confirmSale();
      break;
    default:
      break;
  }
});

function syncScanSensitiveFocus(): void {
  const active = document.activeElement as HTMLElement | null;
  const hasSensitiveFocus = Boolean(active?.closest('[data-scan-capture="off"]'));
  const next = hasSensitiveFocus ? 1 : 0;
  if (state.scanCaptureSensitiveFocusCount === next) return;
  state.scanCaptureSensitiveFocusCount = next;
  void applyScanContext();
}

document.addEventListener('focusin', () => {
  syncScanSensitiveFocus();
});

document.addEventListener('focusout', () => {
  setTimeout(() => {
    syncScanSensitiveFocus();
  }, 0);
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.altKey && !event.shiftKey && event.code === 'KeyD') {
    event.preventDefault();
    if (state.scannerDebugOpen) {
      closeScannerDebug();
    } else {
      void openScannerDebug();
    }
  }
});

async function bootstrap(): Promise<void> {
  window.posScanner.onScan((reading) => {
    void handleScanReading(reading);
  });
  window.posKiosk.onOutboxStatus((status) => {
    state.syncPendingLegacy = status.pendingLegacy;
    state.syncPendingTabs = status.pendingTabs;
    state.syncPendingTotal = status.pendingTotal;
    state.autoSync.pendingTotal = status.pendingTotal;
    state.autoSync.phase = status.phase || state.autoSync.phase;
    state.autoSync.lastOkAt = typeof status.lastOkAt !== 'undefined' ? status.lastOkAt || null : state.autoSync.lastOkAt;
    state.autoSync.lastErrorShort = status.lastErrorShort || '';
    queueRender('sync-status-push');
  });

  state.busy = true;
  render();

  try {
    await loadCatalogFromLocal();
    await loadSettingsData();
    await window.posScanner.setSettings(runtimeScannerSettingsToInput(state.runtimeConfig));
    await applyScanContext();
    await refreshSyncStatus();
    if (!state.snapshot?.items.length) {
      setStatus('Catalogo local vacio. Presiona "Sincronizar catalogo".', 'info');
    } else {
      setStatus('Catalogo local cargado.', 'success');
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'No se pudo cargar catalogo local.', 'error');
  } finally {
    state.busy = false;
    render();
  }
}

bootstrap().catch((error) => {
  setStatus(error instanceof Error ? error.message : 'Error inicializando kiosk.', 'error');
});
