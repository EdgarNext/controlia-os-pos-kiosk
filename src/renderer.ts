import './index.css';
import { disposeAll, registerCleanup } from './renderer/lifecycle/lifecycle';
import { clearTrackedInterval, clearTrackedTimeout, setIntervalTracked, setTimeoutTracked } from './renderer/lifecycle/timers';
import { mark, measure, reportEvery, trackDuration } from './renderer/perf/marks';
import { dispatchAction } from './renderer/events/dispatch';
import { captureFocusSnapshot, restoreFocusSnapshot } from './renderer/render/focus';
import { getTheme, initTheme, toggleTheme } from './renderer/theme';
import {
  iconBackspace,
  iconBanknote,
  iconClear,
  iconCreditCard,
  iconGear,
  iconHistory,
  iconInspect,
  iconKitchen,
  iconMoon,
  iconPrinter,
  iconReceipt,
  iconScan,
  iconSun,
  iconSync,
  iconTable,
  iconTag,
  iconUser,
} from './renderer/ui/icons';
import { renderCartRegion } from './renderer/render/regions/render-cart';
import { renderCatalogRegion } from './renderer/render/regions/render-catalog';
import { renderGateActivationRegion } from './renderer/render/regions/render-gate-activation';
import { renderGateAuthRegion } from './renderer/render/regions/render-gate-auth';
import { renderModalsRegion } from './renderer/render/regions/render-modals';
import { renderOpenTabsRegion } from './renderer/render/regions/render-open-tabs';
import { renderPrinterDebugRegion } from './renderer/render/regions/render-printer-debug';
import { renderShellRegion, SHELL_LAYOUT_HTML } from './renderer/render/regions/render-shell';
import { renderStatusRegion } from './renderer/render/regions/render-status';
import { createRenderScheduler, type RegionKey } from './renderer/render/scheduler';
import {
  bumpActivationVersion,
  bumpAuthVersion,
  bumpCartVersion,
  bumpCatalogVersion,
  bumpOpenTabsVersion,
  bumpPrinterVersion,
  bumpRuntimeVersion,
  bumpScannerVersion,
  bumpSyncVersion,
  bumpUiVersion,
  state,
} from './renderer/state/app-state';
import { getCartLinesView, type CartLineView } from './renderer/selectors/get-cart-lines';
import { getCatalogView } from './renderer/selectors/get-catalog-view';
import { getOpenTabsView } from './renderer/selectors/get-open-tabs-view';
import { getPrinterDebugView } from './renderer/selectors/get-printer-debug-view';
import { getSyncStatusView } from './renderer/selectors/get-sync-status-view';
import { getTotalsView } from './renderer/selectors/get-totals';
import type { CatalogCategory, CatalogItem } from './shared/catalog';
import type { PosSessionView, RuntimeConfig } from './shared/orders';
import type { HidScannerSettings, ScanContextMode, ScannerReading } from './shared/scanner';

interface CartLine extends CartLineView {
  item: CatalogItem;
  qty: number;
}

interface UiRefs {
  initialized: boolean;
  topbarSubtitle: HTMLElement | null;
  topbarContext: HTMLElement | null;
  headerActions: HTMLElement | null;
  categoriesRegion: HTMLElement | null;
  productsRegion: HTMLElement | null;
  cartRegion: HTMLElement | null;
  modalsRegion: HTMLElement | null;
  openTabsRegion: HTMLElement | null;
  printerDebugRegion: HTMLElement | null;
  gateActivationRegion: HTMLElement | null;
  gateAuthRegion: HTMLElement | null;
  bottomStatusRegion: HTMLElement | null;
}

interface RenderRuntime {
  scheduled: boolean;
  frameId: number | null;
  reasons: Set<string>;
  regionSignature: Record<string, string>;
  metricsEnabled: boolean;
  metrics: Record<string, { count: number; totalMs: number }>;
}

const app = document.getElementById('app');
if (!app) throw new Error('Renderer root #app not found');
initTheme();

const ENTER_CONFIRM_WINDOW_MS = 1500;
const SHOW_OPEN_TABS_DEBUG = false;

const ui: UiRefs = {
  initialized: false,
  topbarSubtitle: null,
  topbarContext: null,
  headerActions: null,
  categoriesRegion: null,
  productsRegion: null,
  cartRegion: null,
  modalsRegion: null,
  openTabsRegion: null,
  printerDebugRegion: null,
  gateActivationRegion: null,
  gateAuthRegion: null,
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
    openTabs: '',
    printerDebug: '',
    gateActivation: '',
    gateAuth: '',
    statusbar: '',
  },
  metricsEnabled: false,
  metrics: {
    shell: { count: 0, totalMs: 0 },
    header: { count: 0, totalMs: 0 },
    categories: { count: 0, totalMs: 0 },
    products: { count: 0, totalMs: 0 },
    cart: { count: 0, totalMs: 0 },
    modals: { count: 0, totalMs: 0 },
    openTabs: { count: 0, totalMs: 0 },
    printerDebug: { count: 0, totalMs: 0 },
    gateActivation: { count: 0, totalMs: 0 },
    gateAuth: { count: 0, totalMs: 0 },
    statusbar: { count: 0, totalMs: 0 },
  },
};

const renderScheduler = createRenderScheduler();
let lastSliceVersions = {
  activation: state.activation.version,
  auth: state.auth.version,
  catalog: state.catalog.version,
  cart: state.cart.version,
  openTabs: state.openTabs.version,
  printer: state.printer.version,
  runtime: state.runtime.version,
  scanner: state.scanner.version,
  sync: state.sync.version,
  ui: state.ui.version,
};

let printStatusPollTimer: number | null = null;
let printStatusPollInFlight = false;
let bootSession = 0;

const RENDER_PROFILE_REPORT_EVERY = 50;
const RENDER_PROFILE_WARN_MS = 16;
const RENDER_PROFILE_SLOW_MS = 33;

function isRenderProfilingEnabled(): boolean {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  if (viteEnv && (viteEnv.PROFILE_RENDER === '1' || viteEnv.PROFILE_RENDER === 'true')) return true;

  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (processEnv?.PROFILE_RENDER === '1' || processEnv?.PROFILE_RENDER === 'true') return true;

  try {
    const fromStorage = window.localStorage.getItem('profile_render');
    return fromStorage === '1' || fromStorage === 'true' || fromStorage === 'on';
  } catch {
    return false;
  }
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

function focusCheckoutReceivedInput(): void {
  requestAnimationFrame(() => {
    const input = document.getElementById('input-received') as HTMLInputElement | null;
    if (!input || input.disabled) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  });
}

function getCategoryImageUrl(category: CatalogCategory): string | null {
  const candidate = category as CatalogCategory & {
    imagePath?: string | null;
    imageUrl?: string | null;
    image_url?: string | null;
  };
  const raw = candidate.imagePath ?? candidate.imageUrl ?? candidate.image_url ?? null;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim();
  return normalized.length ? normalized : null;
}

function hasBlockingGate(): boolean {
  if (state.activation.required || state.activation.blocked) return true;
  if (!hasIdentityConfig(state.runtimeConfig)) return false;
  return !hasActivePosSession();
}

function invalidateFromVersionDeltas(): void {
  const next = {
    activation: state.activation.version,
    auth: state.auth.version,
    catalog: state.catalog.version,
    cart: state.cart.version,
    openTabs: state.openTabs.version,
    printer: state.printer.version,
    runtime: state.runtime.version,
    scanner: state.scanner.version,
    sync: state.sync.version,
    ui: state.ui.version,
  };

  const invalidate = (regions: RegionKey[]): void => renderScheduler.invalidateMany(regions);

  if (next.activation !== lastSliceVersions.activation) {
    invalidate([
      'gate:activation',
      'gate:auth',
      'shell',
      'catalog',
      'cart',
      'open-tabs',
      'status',
      'printer-debug',
      'modals',
    ]);
  }
  if (next.auth !== lastSliceVersions.auth) {
    invalidate(['gate:auth', 'shell', 'status', 'modals']);
  }
  if (next.catalog !== lastSliceVersions.catalog) {
    invalidate(['catalog', 'cart', 'open-tabs', 'modals', 'status']);
  }
  if (next.cart !== lastSliceVersions.cart) {
    invalidate(['cart', 'modals', 'status']);
  }
  if (next.openTabs !== lastSliceVersions.openTabs) {
    invalidate(['open-tabs', 'cart', 'modals', 'status']);
  }
  if (next.printer !== lastSliceVersions.printer) {
    invalidate(['printer-debug', 'status', 'modals']);
  }
  if (next.runtime !== lastSliceVersions.runtime) {
    invalidate(['shell', 'status', 'modals', 'gate:activation']);
  }
  if (next.scanner !== lastSliceVersions.scanner) {
    invalidate(['status', 'modals']);
  }
  if (next.sync !== lastSliceVersions.sync) {
    invalidate(['status']);
  }
  if (next.ui !== lastSliceVersions.ui) {
    invalidate(['shell', 'catalog', 'cart', 'open-tabs', 'status', 'printer-debug', 'modals']);
  }

  lastSliceVersions = next;
}

function queueRender(reason = 'state-change', regionsToInvalidate?: RegionKey[]): void {
  if (regionsToInvalidate?.length) renderScheduler.invalidateMany(regionsToInvalidate);
  invalidateFromVersionDeltas();
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

function renderRegion(name: string, fn: () => void): void {
  if (!renderRuntime.metrics[name]) {
    renderRuntime.metrics[name] = { count: 0, totalMs: 0 };
  }
  const shouldProfile = isRenderProfilingEnabled();
  const t0 = shouldProfile || renderRuntime.metricsEnabled ? performance.now() : 0;
  fn();
  if (!shouldProfile && !renderRuntime.metricsEnabled) return;
  const elapsed = performance.now() - t0;
  if (shouldProfile) {
    trackDuration(`render:region:${name}`, elapsed);
  }
  if (!renderRuntime.metricsEnabled) return;
  renderRuntime.metrics[name].count += 1;
  renderRuntime.metrics[name].totalMs += elapsed;
}

function setStatus(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  state.status = message;
  state.statusKind = kind;
  bumpUiVersion();
  queueRender('status-update');
}

function hasIdentityConfig(runtime: RuntimeConfig | null): boolean {
  if (!runtime) return false;
  return Boolean(
    runtime.tenantId &&
      runtime.kioskId &&
      Number.isInteger(runtime.kioskNumber) &&
      runtime.tenantSlug &&
      runtime.deviceId &&
      runtime.deviceSecret,
  );
}

function isTouchScreenEnabled(runtime: RuntimeConfig | null): boolean {
  return runtime?.touchScreenEnabled !== false;
}

function isSupervisorRole(role: string | null | undefined): boolean {
  const normalized = String(role || '').toLowerCase();
  return normalized === 'supervisor' || normalized === 'admin';
}

function canUseToolsMenuRole(role: string | null | undefined): boolean {
  const normalized = String(role || '').toLowerCase();
  return ['admin', 'supervisor'].includes(normalized);
}

function isSessionExpired(session: PosSessionView | null): boolean {
  if (!session) return true;
  const timeoutMs = Math.max(1, Number(session.timeoutMinutes || 0)) * 60 * 1000;
  const lastAt = new Date(session.lastActivityAt || session.startedAt).getTime();
  if (!Number.isFinite(lastAt)) return true;
  return Date.now() - lastAt > timeoutMs;
}

function hasActivePosSession(): boolean {
  return Boolean(state.auth.session && !isSessionExpired(state.auth.session));
}

function isDeviceInactiveError(messageRaw: string | null | undefined): boolean {
  const message = String(messageRaw || '').toLowerCase();
  return (
    message.includes('not active') ||
    message.includes('revoked') ||
    message.includes('disabled') ||
    message.includes('device is not active')
  );
}

function lockAppForDeviceRevoked(message = 'Dispositivo revocado o deshabilitado. Contacta al administrador.'): void {
  state.activation.required = false;
  state.activation.blocked = true;
  state.activation.kind = 'error';
  state.activation.message = message;
  bumpActivationVersion();
  setStatus(message, 'error');
}

function getScanModeByUiState(): ScanContextMode {
  if (state.activation.required || state.activation.blocked || !hasActivePosSession()) return 'disabled';
  if (state.barcodeBindingOpen) return 'assign';
  if (
    state.deviceBindingOpen ||
    state.settingsOpen ||
    state.ordersHistoryOpen ||
    state.tabKitchenHistoryOpen ||
    state.checkoutOpen ||
    state.scannerDebugOpen ||
    state.printerDebugOpen
  ) {
    return 'disabled';
  }
  return 'sale';
}

function resolveRuntimeConfigDefaults(): RuntimeConfig {
  return {
    tenantId: null,
    kioskId: null,
    kioskNumber: null,
    kioskDisplayName: null,
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
    touchScreenEnabled: true,
    posSessionTimeoutMinutes: 30,
    posSessionUserId: null,
    posSessionUserName: null,
    posSessionRole: null,
    posSessionStartedAt: null,
    posSessionLastActivityAt: null,
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
  bumpScannerVersion();
  await window.posScanner.setContext({
    enabled,
    mode,
    selectedProductId: state.barcodeBindingSelectedItemId || null,
  });
}

async function refreshScannerDebugState(): Promise<void> {
  state.scannerDebugLoading = true;
  bumpScannerVersion();
  render();
  try {
    state.scannerDebugState = await window.posScanner.getDebugState();
    bumpScannerVersion();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'No se pudo cargar scanner debug.', 'error');
  } finally {
    state.scannerDebugLoading = false;
    bumpScannerVersion();
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
  return getCatalogView(state).categories;
}

function getItems(): CatalogItem[] {
  return getCatalogView(state).items;
}

function findItemByBarcode(barcodeRaw: string): CatalogItem | null {
  const normalized = String(barcodeRaw || '').replace(/[\r\n\t]+/g, '').trim();
  if (!normalized) return null;
  return getItems().find((item) => (item.barcode || '').trim() === normalized) || null;
}

function getVisibleItems(): CatalogItem[] {
  return getCatalogView(state).visibleItems;
}

function getBarcodeBindingItems(): CatalogItem[] {
  return getCatalogView(state).barcodeBindingItems;
}

function getCartLines(): CartLine[] {
  return getCartLinesView(state);
}

function getActiveTabTotalCents(): number {
  return getTotalsView(state, getCartLines()).activeTabTotalCents;
}

function hasPendingKitchenDelta(): boolean {
  return Boolean(state.openTabsDetail && state.openTabsDetail.pendingKitchenCount > 0);
}

function getCurrentSaleTotalCents(): number {
  return getTotalsView(state, getCartLines()).currentSaleTotalCents;
}

function parseReceivedCents(): number {
  const raw = Number.parseInt(state.receivedInput || '0', 10);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw * 100;
}

function canConfirmPayment(): boolean {
  const total = getCurrentSaleTotalCents();
  if (state.checkoutPaymentMethod === 'tarjeta') {
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
  bumpCartVersion();
  render();
}

function clearCart(): void {
  state.cartQtyByItemId.clear();
  state.checkoutNumpadOpen = false;
  state.receivedInput = '';
  state.enterConfirmArmedAt = null;
  bumpCartVersion();
  render();
}

function setCheckoutPaymentMethod(methodRaw: string): void {
  state.checkoutPaymentMethod = methodRaw === 'tarjeta' ? 'tarjeta' : 'efectivo';
  if (state.checkoutPaymentMethod === 'tarjeta') {
    state.receivedInput = '';
    state.checkoutNumpadOpen = false;
  } else {
    state.checkoutNumpadOpen = isTouchScreenEnabled(state.runtimeConfig);
  }
  state.enterConfirmArmedAt = null;
  bumpCartVersion();
  queueRender('checkout-payment-method');
  if (state.checkoutPaymentMethod !== 'tarjeta') {
    focusCheckoutReceivedInput();
  }
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
  state.checkoutNumpadOpen = state.checkoutPaymentMethod !== 'tarjeta' && isTouchScreenEnabled(state.runtimeConfig);
  state.enterConfirmArmedAt = null;
  void applyScanContext();
  render();
  if (state.checkoutPaymentMethod !== 'tarjeta') {
    focusCheckoutReceivedInput();
  }
}

function closeCheckout(): void {
  if (state.busy) return;
  state.checkoutOpen = false;
  state.checkoutNumpadOpen = false;
  state.receivedInput = '';
  state.enterConfirmArmedAt = null;
  void applyScanContext();
  render();
}

function schedulePrintStatusPoll(delayMs = 800): void {
  if (printStatusPollTimer !== null) {
    clearTrackedTimeout(printStatusPollTimer);
  }
  printStatusPollTimer = setTimeoutTracked(() => {
    printStatusPollTimer = null;
    void refreshPrintStatusFromJobs(true);
  }, delayMs, 'print-status-poll');
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

function getKitchenPrintLabel(ok: boolean): string {
  return ok ? 'Impresa' : 'Error impresion';
}

function getKitchenSyncLabel(status: 'PENDING' | 'SENT' | 'ACKED' | 'FAILED' | 'CONFLICT'): string {
  if (status === 'ACKED') return 'Sync OK';
  if (status === 'CONFLICT') return 'Sync conflicto';
  if (status === 'FAILED') return 'Sync error';
  if (status === 'SENT') return 'Sync enviado';
  return 'Sync pendiente';
}

function openTabsStatusClass(): string {
  return state.openTabsStatusKind === 'error' ? 'error' : state.openTabsStatusKind === 'success' ? 'success' : '';
}

function setOpenTabsStatus(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  state.openTabsStatusMessage = message;
  state.openTabsStatusKind = kind;
  bumpOpenTabsVersion();
}

function ensureOpenTabsSelections(): void {
  let changed = false;
  if (
    state.openTabsSelectedTableId &&
    !state.openTabsSnapshot.tables.some((table) => table.id === state.openTabsSelectedTableId)
  ) {
    state.openTabsSelectedTableId = '';
    changed = true;
  }

  if (!state.openTabsSelectedTableId && state.openTabsSnapshot.tables.length > 0) {
    state.openTabsSelectedTableId = state.openTabsSnapshot.tables[0].id;
    changed = true;
  }

  if (
    state.openTabsSelectedTabId &&
    !state.openTabsSnapshot.tabs.some((tab) => tab.id === state.openTabsSelectedTabId)
  ) {
    state.openTabsSelectedTabId = '';
    state.openTabsDetail = null;
    changed = true;
  }
  if (changed) bumpOpenTabsVersion();
}

async function refreshOpenTabsSnapshot(loadDetail = true): Promise<void> {
  const snapshot = await window.posKiosk.getOpenTabsSnapshot(null);
  state.openTabsSnapshot = snapshot;
  bumpOpenTabsVersion();
  ensureOpenTabsSelections();

  if (loadDetail && state.openTabsSelectedTabId) {
    state.openTabsDetail = await window.posKiosk.getOpenTabDetail(state.openTabsSelectedTabId);
    bumpOpenTabsVersion();
  } else if (!state.openTabsSelectedTabId) {
    state.openTabsDetail = null;
    bumpOpenTabsVersion();
  }
}

async function refreshOpenTabsDetail(tabId: string): Promise<void> {
  state.openTabsDetail = await window.posKiosk.getOpenTabDetail(tabId);
  bumpOpenTabsVersion();
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
  bumpOpenTabsVersion();
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

function renderActivationGate(): string {
  if (!state.activation.required && !state.activation.blocked) return '';

  const statusClass =
    state.activation.kind === 'error'
      ? 'error'
      : state.activation.kind === 'success'
        ? 'success'
        : '';

  if (state.activation.blocked) {
    return `
      <div class="modal-overlay activation-overlay">
        <div class="modal activation-modal">
          <h2>Dispositivo bloqueado</h2>
          <div class="status ${statusClass}">${escapeHtml(state.activation.message)}</div>
          <div class="cart-sub">Este POS no puede operar hasta ser reactivado por un administrador.</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="modal-overlay activation-overlay">
      <div class="modal activation-modal">
        <h2>Activar dispositivo</h2>
        <div class="status ${statusClass}">${escapeHtml(state.activation.message)}</div>
        <label class="field">
          <span>Tenant Slug</span>
          <input id="activation-tenant-slug" data-scan-capture="off" class="input" value="${escapeHtml(
            state.activation.tenantSlugInput,
          )}" ${state.activation.inFlight ? 'disabled' : ''} />
        </label>
        <label class="field">
          <span>Claim Code</span>
          <input id="activation-claim-code" data-scan-capture="off" class="input" value="${escapeHtml(
            state.activation.claimCodeInput,
          )}" ${state.activation.inFlight ? 'disabled' : ''} />
        </label>
        <div class="modal-actions">
          <button class="button" data-action="activate-device-claim" ${state.activation.inFlight ? 'disabled' : ''}>
            ${state.activation.inFlight ? 'Activando...' : 'Activar'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderPosAuthGate(): string {
  if (!hasIdentityConfig(state.runtimeConfig) || state.activation.required || state.activation.blocked) return '';
  if (hasActivePosSession()) return '';

  const usersOptions = state.auth.users.length
    ? state.auth.users
        .map(
          (user) => `
            <option value="${user.id}" ${user.id === state.auth.selectedUserId ? 'selected' : ''}>
              ${escapeHtml(user.name)} (${escapeHtml(user.role)})
            </option>
          `,
        )
        .join('')
    : '<option value="">Sin usuarios sincronizados</option>';

  const statusClass = state.auth.kind === 'error' ? 'error' : state.auth.kind === 'success' ? 'success' : '';

  return `
    <div class="modal-overlay activation-overlay">
      <div class="modal activation-modal">
        <h2>Login POS</h2>
        <div class="status ${statusClass}">${escapeHtml(state.auth.message)}</div>
        <label class="field">
          <span>Usuario</span>
          <select id="pos-login-user" class="input" ${state.auth.inFlight ? 'disabled' : ''}>
            ${usersOptions}
          </select>
        </label>
        <label class="field">
          <span>PIN</span>
          <input id="pos-login-pin" data-scan-capture="off" class="input" type="password" value="${escapeHtml(
            state.auth.pinInput,
          )}" ${state.auth.inFlight ? 'disabled' : ''} />
        </label>
        <div class="modal-actions">
          <button class="button secondary" data-action="sync-catalog" ${state.auth.inFlight ? 'disabled' : ''}>
            Sincronizar catalogo
          </button>
          <button class="button" data-action="pos-login-submit" ${state.auth.inFlight ? 'disabled' : ''}>
            ${state.auth.inFlight ? 'Validando...' : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  `;
}

async function refreshPosSessionFromMain(): Promise<void> {
  state.auth.session = await window.posKiosk.getPosSession();
  bumpAuthVersion();
  if (!hasActivePosSession()) {
    state.auth.session = null;
    if (!state.auth.inFlight) {
      state.auth.kind = 'info';
      state.auth.message = 'Login requerido para operar ventas.';
      bumpAuthVersion();
    }
  }
}

async function refreshPosUsersFromCatalog(): Promise<void> {
  state.auth.users = await window.posKiosk.listPosUsers();
  if (!state.auth.selectedUserId || !state.auth.users.some((row) => row.id === state.auth.selectedUserId)) {
    state.auth.selectedUserId = state.auth.users[0]?.id || '';
  }
  if (!state.auth.users.length) {
    state.auth.kind = 'error';
    state.auth.message = 'No hay usuarios POS sincronizados. Sincroniza catalogo.';
  }
  bumpAuthVersion();
}

async function touchPosSessionActivity(): Promise<void> {
  if (!hasActivePosSession()) return;
  state.auth.session = await window.posKiosk.touchPosSession();
  bumpAuthVersion();
}

async function loginPosUser(): Promise<void> {
  if (state.auth.inFlight) return;
  if (!state.auth.selectedUserId) {
    state.auth.kind = 'error';
    state.auth.message = 'Selecciona un usuario.';
    render();
    return;
  }
  const pin = state.auth.pinInput.trim();
  if (!pin) {
    state.auth.kind = 'error';
    state.auth.message = 'PIN requerido.';
    render();
    return;
  }

  state.auth.inFlight = true;
  state.auth.kind = 'info';
  state.auth.message = 'Validando credenciales...';
  bumpAuthVersion();
  render();
  try {
    const result = await window.posKiosk.loginPosUser({
      userId: state.auth.selectedUserId,
      pin,
    });
    if (!result.ok || !result.session) {
      state.auth.kind = 'error';
      state.auth.message = result.error || 'No se pudo iniciar sesion.';
      return;
    }
    state.auth.pinInput = '';
    state.auth.session = result.session;
    state.auth.kind = 'success';
    state.auth.message = `Sesion activa: ${result.session.userName}.`;
    bumpAuthVersion();
    setStatus(`Sesion iniciada por ${result.session.userName}.`, 'success');
    await applyScanContext();
  } catch (error) {
    state.auth.kind = 'error';
    state.auth.message = error instanceof Error ? error.message : 'Error iniciando sesion.';
    bumpAuthVersion();
  } finally {
    state.auth.inFlight = false;
    bumpAuthVersion();
    render();
  }
}

async function logoutPosUser(): Promise<void> {
  await window.posKiosk.logoutPosUser();
  state.auth.session = null;
  state.auth.pinInput = '';
  state.auth.kind = 'info';
  state.auth.message = 'Sesion cerrada.';
  bumpAuthVersion();
  await applyScanContext();
  setStatus('Sesion cerrada. Login requerido para vender.', 'info');
  render();
}

async function ensureSupervisorOverrideIfNeeded(reason: string): Promise<boolean> {
  const role = state.auth.session?.role || null;
  if (isSupervisorRole(role)) return true;

  const pin = window.prompt(`Override supervisor requerido (${reason}). Ingresa PIN supervisor:`) || '';
  if (!pin.trim()) return false;
  const result = await window.posKiosk.supervisorOverride({ pin });
  if (!result.ok) {
    setStatus(result.error || 'Override supervisor denegado.', 'error');
    return false;
  }
  setStatus(`Override autorizado por ${result.supervisor?.name || 'supervisor'}.`, 'success');
  return true;
}

async function ensurePosSessionOrBlock(): Promise<boolean> {
  await refreshPosSessionFromMain();
  if (hasActivePosSession()) return true;
  state.auth.kind = 'info';
  state.auth.message = 'Login requerido para continuar.';
  await applyScanContext();
  render();
  return false;
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
    state.openTabsShowSentLines = false;
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
  state.openTabsShowSentLines = false;
  state.openTabsDetail = null;
  state.checkoutOpen = false;
  state.checkoutNumpadOpen = false;
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
    state.openTabsShowSentLines = false;
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
  app.innerHTML = SHELL_LAYOUT_HTML;

  ui.topbarSubtitle = app.querySelector('#topbar-subtitle');
  ui.topbarContext = app.querySelector('#topbar-context');
  ui.headerActions = app.querySelector('[data-region="header-actions"]');
  ui.categoriesRegion = app.querySelector('[data-region="categories"]');
  ui.productsRegion = app.querySelector('[data-region="products"]');
  ui.cartRegion = document.getElementById('region-cart');
  ui.bottomStatusRegion = document.getElementById('region-status');
  ui.openTabsRegion = document.getElementById('region-open-tabs');
  ui.printerDebugRegion = document.getElementById('region-printer-debug');
  ui.modalsRegion = document.getElementById('region-modals');
  ui.gateAuthRegion = document.getElementById('region-gate-auth');
  ui.gateActivationRegion = document.getElementById('region-gate-activation');
  ui.initialized = true;
}

function renderBottomStatusRegion(): void {
  if (!ui.bottomStatusRegion) return;
  const sync = state.statusBar.sync;
  const scanner = state.statusBar.scanner;
  const print = state.statusBar.print;
  const runtime = state.statusBar.runtime;
  const syncStatusView = getSyncStatusView(state);

  const syncValue = syncStatusView.syncValue;
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
  state.statusBar.runtime.kioskLabel =
    state.runtimeConfig?.kioskDisplayName ||
    (state.runtimeConfig?.kioskNumber ? `Kiosko ${state.runtimeConfig.kioskNumber}` : state.runtimeConfig?.kioskId || '');
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
  const profileRender = isRenderProfilingEnabled();
  const flushStart = profileRender ? mark('render:flush:start') : 0;
  const deriveStart = profileRender ? performance.now() : 0;

  initUI();
  app.classList.toggle('activation-mode', state.activation.required || state.activation.blocked);
  const focusSnapshot = captureFocusSnapshot();

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
  const tablePendingLines = tableLines.filter((line) => line.kitchenStatus === 'PENDING');
  const tableSentLines = tableLines.filter((line) => line.kitchenStatus === 'SENT');
  const tableVisibleLines = state.openTabsShowSentLines ? tableLines : tablePendingLines;
  const totalCents = getCurrentSaleTotalCents();
  const receivedCents = parseReceivedCents();
  const missingCents = Math.max(totalCents - receivedCents, 0);
  const changeCents = Math.max(receivedCents - totalCents, 0);
  if (profileRender) {
    measure('render:derive-state', deriveStart, performance.now());
  }

  const categoryHtml = categories.length
    ? categories
        .map(
          (category) => {
            const imageUrl = getCategoryImageUrl(category);
            return `
      <button class="category-btn ${category.id === state.activeCategoryId ? 'active' : ''}" data-action="select-category" data-id="${category.id}">
        <span class="category-btn-content">
          ${
            imageUrl
              ? `<span class="category-thumb"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(category.name)}" loading="lazy" /></span>`
              : ''
          }
          <span class="category-label">${escapeHtml(category.name)}</span>
        </span>
      </button>
    `;
          },
        )
        .join('')
    : '<div class="empty">Sin categorias locales.</div>';

  const productsHtml = items.length
    ? items
        .map(
          (item) => `
      <button class="product-card" data-action="add-to-cart" data-id="${item.id}">
        <div class="product-image-wrapper ${item.imagePath ? '' : 'is-placeholder'}">
          ${
            item.imagePath
              ? `<img src="${escapeHtml(item.imagePath)}" alt="${escapeHtml(item.name)}" loading="lazy" />`
              : '<div class="product-image-placeholder">Sin imagen</div>'
          }
          <div class="product-image-overlay"></div>
          <div class="product-price-badge">${formatMoney(item.priceCents)}</div>
        </div>
        <div class="product-body">
          <div class="product-name">${escapeHtml(item.name)}</div>
        </div>
      </button>
    `,
        )
        .join('')
    : '<div class="empty">Sin productos en esta categoria.</div>';

  const openTabsView = getOpenTabsView(state);
  const { itemNameById } = openTabsView;
  const cartHtml = state.tableModeEnabled
    ? tableVisibleLines.length
      ? tableVisibleLines
          .map(
            (line) => `
        <div class="cart-line">
          <div>
            <div class="cart-name">${escapeHtml(itemNameById.get(line.productId) || line.productId)}</div>
            <div class="cart-sub">${line.qty} x ${formatMoney(line.unitPriceCents)} · ${line.kitchenStatus === 'PENDING' ? 'Por enviar' : 'Enviado a cocina'}</div>
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
      : state.openTabsShowSentLines
        ? '<div class="empty">No hay productos en esta mesa.</div>'
        : '<div class="empty">Sin productos por enviar a cocina.</div>'
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
          <button class="qty-btn" data-action="cart:decrease-qty" data-id="${line.item.id}">-</button>
          <span class="qty-value">${line.qty}</span>
          <button class="qty-btn" data-action="cart:increase-qty" data-id="${line.item.id}">+</button>
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
            (round, idx) => `
      <div class="cart-sub">Comanda ${idx + 1} · ${round.linesCount} productos · ${getKitchenPrintLabel(round.ok)} · ${getKitchenSyncLabel(round.status)} · ${formatDate(round.createdAt)}</div>
    `,
          )
          .join('')
      : '<div class="cart-sub">Sin rondas de cocina registradas.</div>';
  const selectedTableId = state.openTabsDetail?.tab.posTableId || state.openTabsSelectedTableId || null;
  const selectedTableName =
    (selectedTableId && state.openTabsSnapshot.tables.find((table) => table.id === selectedTableId)?.name) || 'Sin mesa';
  const selectedTableOpenTabsCount = selectedTableId
    ? state.openTabsSnapshot.tabs.filter((tab) => tab.posTableId === selectedTableId && tab.status === 'OPEN').length
    : 0;
  const lastKitchenRound = state.openTabsDetail?.kitchenRounds?.[0] || null;
  const tableLinesToggleHtml =
    state.tableModeEnabled && state.openTabsDetail
      ? `<button class="button ghost-link" data-action="open-tabs-toggle-line-visibility" ${
          state.busy || !state.openTabsSelectedTabId ? 'disabled' : ''
        }>${state.openTabsShowSentLines ? 'Ver solo por enviar' : 'Ver enviados'}</button>`
      : '';
  const tableContextPill = state.tableModeEnabled
    ? `<div class="cart-context-pill">Mesa ${escapeHtml(selectedTableName)} · ${selectedTableOpenTabsCount} cuentas abiertas</div>`
    : '';
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

        <div class="field">
          <span class="checkout-method-label">Metodo de pago</span>
          <div class="payment-method-group" role="radiogroup" aria-label="Metodo de pago">
            <button
              class="payment-method-btn ${state.checkoutPaymentMethod === 'efectivo' ? 'is-active' : ''}"
              type="button"
              role="radio"
              aria-checked="${state.checkoutPaymentMethod === 'efectivo' ? 'true' : 'false'}"
              aria-label="Efectivo"
              data-action="set-checkout-payment"
              data-value="efectivo"
            >
              <span class="payment-method-icon">${iconBanknote()}</span>
              <span class="payment-method-text">Efectivo</span>
            </button>
            <button
              class="payment-method-btn ${state.checkoutPaymentMethod === 'tarjeta' ? 'is-active' : ''}"
              type="button"
              role="radio"
              aria-checked="${state.checkoutPaymentMethod === 'tarjeta' ? 'true' : 'false'}"
              aria-label="Tarjeta"
              data-action="set-checkout-payment"
              data-value="tarjeta"
            >
              <span class="payment-method-icon">${iconCreditCard()}</span>
              <span class="payment-method-text">Tarjeta</span>
            </button>
          </div>
        </div>

        <div class="checkout-cash-wrap ${state.checkoutPaymentMethod === 'tarjeta' ? 'is-collapsed' : ''}">
          <label class="field">
            <span>Pago recibido</span>
            <div class="checkout-received-row">
              <input id="input-received" data-scan-capture="off" class="input" inputmode="numeric" value="${escapeHtml(state.receivedInput)}" placeholder="0" />
            </div>
          </label>

          ${
            state.checkoutPaymentMethod !== 'tarjeta' && isTouchScreenEnabled(state.runtimeConfig)
              ? `
        <div class="checkout-numpad" data-scan-capture="off">
          <button class="button secondary checkout-numpad-key" data-action="checkout-numpad-input" data-value="1">1</button>
          <button class="button secondary checkout-numpad-key" data-action="checkout-numpad-input" data-value="2">2</button>
          <button class="button secondary checkout-numpad-key" data-action="checkout-numpad-input" data-value="3">3</button>

          <button class="button secondary checkout-numpad-key" data-action="checkout-numpad-input" data-value="4">4</button>
          <button class="button secondary checkout-numpad-key" data-action="checkout-numpad-input" data-value="5">5</button>
          <button class="button secondary checkout-numpad-key" data-action="checkout-numpad-input" data-value="6">6</button>

          <button class="button secondary checkout-numpad-key" data-action="checkout-numpad-input" data-value="7">7</button>
          <button class="button secondary checkout-numpad-key" data-action="checkout-numpad-input" data-value="8">8</button>
          <button class="button secondary checkout-numpad-key" data-action="checkout-numpad-input" data-value="9">9</button>

          <button class="button secondary checkout-numpad-key checkout-numpad-fn checkout-numpad-icon" data-action="checkout-numpad-clear" aria-label="Limpiar pago recibido">${iconClear()}</button>
          <button class="button secondary checkout-numpad-key" data-action="checkout-numpad-input" data-value="0">0</button>
          <button class="button secondary checkout-numpad-key checkout-numpad-fn checkout-numpad-icon" data-action="checkout-numpad-backspace" aria-label="Borrar ultimo digito">${iconBackspace()}</button>
        </div>
              `
              : ''
          }

          <div class="quick-amounts">
            <button class="button secondary" data-action="quick-amount" data-value="50">$50</button>
            <button class="button secondary" data-action="quick-amount" data-value="100">$100</button>
            <button class="button secondary" data-action="quick-amount" data-value="200">$200</button>
            <button class="button secondary" data-action="quick-amount" data-value="500">$500</button>
            <button class="button secondary" data-action="exact-amount">EXACTO</button>
          </div>

          <div class="checkout-result ${missingCents > 0 ? 'danger' : 'ok'}">
            ${missingCents > 0 ? `Faltan ${formatMoney(missingCents)}` : `Cambio ${formatMoney(changeCents)}`}
          </div>
        </div>

        <div class="checkout-card-note ${state.checkoutPaymentMethod === 'tarjeta' ? 'is-visible' : ''}" aria-hidden="${
          state.checkoutPaymentMethod === 'tarjeta' ? 'false' : 'true'
        }">
          El monto se cargara directamente por terminal.
        </div>

        <div class="modal-actions">
          <button class="button secondary" data-action="cancel-checkout" ${state.busy ? 'disabled' : ''}>Cancelar</button>
          <button class="button" data-action="confirm-sale" ${canConfirmPayment() ? '' : 'disabled'}>${state.busy ? 'Procesando...' : 'Confirmar e imprimir'}</button>
        </div>
      </div>
    </div>
  `
    : '';

  const settingsConfig = state.printConfig || { linuxPrinterDevicePath: '/dev/pos58', windowsPrinterShare: '' };
  const runtime = state.runtimeConfig || resolveRuntimeConfigDefaults();

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
            <div class="status">
              Identidad del dispositivo bloqueada (activacion por Claim Code).<br/>
              Tenant: ${escapeHtml(runtime.tenantSlug || 'n/a')} · Device: ${escapeHtml(runtime.deviceId || 'n/a')} · Kiosk: ${escapeHtml(runtime.kioskId || 'n/a')}
            </div>
            <label class="field">
              <span>Timeout sesion POS (minutos)</span>
              <input id="settings-pos-session-timeout" class="input" inputmode="numeric" value="${escapeHtml(
                String(runtime.posSessionTimeoutMinutes || 30),
              )}" />
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
        </div>

        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="printer-debug-open" ${state.busy ? 'disabled' : ''}>Printer Debug</button>
          <button class="button secondary" data-action="close-settings" ${state.busy ? 'disabled' : ''}>Cerrar</button>
        </div>
      </div>
    </div>
  `
    : '';

  const deviceBindingStatusClass =
    state.deviceBindingStatusKind === 'error'
      ? 'error'
      : state.deviceBindingStatusKind === 'success'
        ? 'success'
        : '';
  const maskedDeviceSecret = runtime.deviceSecret
    ? `••••${escapeHtml(runtime.deviceSecret.slice(-6))}`
    : 'n/a';
  const deviceBindingHtml = state.deviceBindingOpen
    ? `
    <div class="modal-overlay">
      <div class="modal settings-modal">
        <div class="settings-header">
          <h2>Configuracion del dispositivo</h2>
          <div class="settings-inline-status ${deviceBindingStatusClass}">
            ${
              state.deviceBindingBusy
                ? 'Procesando...'
                : escapeHtml(state.deviceBindingStatusMessage || 'Consulta la vinculacion activa del dispositivo.')
            }
          </div>
        </div>

        <div class="settings-body">
          <section class="settings-column settings-column-config device-config-panel">
            <div class="settings-section-title">Desvinculacion</div>
            <div class="status">
              URL Hub/API: ${escapeHtml(state.deviceBindingApiBaseUrl || 'n/a')}<br/>
              Tenant slug: ${escapeHtml(runtime.tenantSlug || 'n/a')} · Tenant ID: ${escapeHtml(runtime.tenantId || 'n/a')}<br/>
              Kiosk ID: ${escapeHtml(runtime.kioskId || 'n/a')} · Kiosk numero: ${Number.isInteger(runtime.kioskNumber) ? String(runtime.kioskNumber) : 'n/a'}<br/>
              Kiosk nombre: ${escapeHtml(runtime.kioskDisplayName || 'n/a')}<br/>
              Device ID: ${escapeHtml(runtime.deviceId || 'n/a')}<br/>
              Device secret: ${maskedDeviceSecret}
            </div>

            <div class="settings-actions">
              <button class="button danger" data-action="reset-device-binding" ${state.deviceBindingBusy ? 'disabled' : ''}>
                ${state.deviceBindingConfirmReset ? 'Confirmar desvinculacion' : 'Desvincular dispositivo'}
              </button>
            </div>
            <div class="cart-sub">Al desvincular, el POS quedara en modo activacion para asociarse a otro tenant mediante Claim Code.</div>
          </section>
          <section class="settings-column settings-column-config device-config-panel">
            <div class="settings-section-title">Parametros del dispositivo</div>
            <div class="status">
              Ajustes locales del dispositivo. Los cambios se guardan automaticamente.
            </div>
            <label class="touch-toggle-row" for="device-touch-screen-enabled">
              <span class="touch-toggle-copy">
                <strong>Teclado touch en cobro</strong>
                <small>${isTouchScreenEnabled(runtime) ? 'Activo' : 'Inactivo'}</small>
              </span>
              <input
                id="device-touch-screen-enabled"
                type="checkbox"
                class="touch-toggle-input"
                ${isTouchScreenEnabled(runtime) ? 'checked' : ''}
                ${state.deviceBindingBusy ? 'disabled' : ''}
              />
            </label>
          </section>
        </div>

        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="close-device-binding" ${state.deviceBindingBusy ? 'disabled' : ''}>Cerrar</button>
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
            (round, idx) => {
              const tabClosed = state.tabKitchenHistoryDetail?.tab.status !== 'OPEN';
              const lineDetails = round.lines?.length
                ? `<ul class="history-lines-list">${round.lines
                    .map(
                      (line) =>
                        `<li>${line.qty}x ${escapeHtml(line.name)}${
                          line.notes ? ` <span class="history-note">(${escapeHtml(line.notes)})</span>` : ''
                        }</li>`,
                    )
                    .join('')}</ul>`
                : '<span class="muted">Sin detalle de productos.</span>';
              return `
      <tr>
        <td>Comanda ${idx + 1}</td>
        <td>${formatDate(round.createdAt)}</td>
        <td>${round.linesCount}</td>
        <td>${getKitchenPrintLabel(round.ok)}</td>
        <td>${getKitchenSyncLabel(round.status)}${round.canceled ? ' (CANCELADA)' : ''}</td>
        <td>${lineDetails}</td>
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
      : '<tr><td colspan="8">Sin comandas registradas.</td></tr>';
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
                <th>Comanda</th>
                <th>Fecha</th>
                <th>Productos</th>
                <th>Impresion</th>
                <th>Sync</th>
                <th>Detalle</th>
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
  const selectedTab = openTabsView.selectedTab;
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
      <div class="modal history-modal scanner-debug-modal">
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
        <div class="scanner-debug-body">
        <div class="settings-section-title" style="margin-top: 10px;">Configuracion Scanner</div>
        <div class="scanner-debug-config-grid">
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
            <span>Enter termina scan</span>
            <select id="settings-scanner-enter-terminator" class="input">
              <option value="1" ${runtime.scannerAllowEnterTerminator !== false ? 'selected' : ''}>Si</option>
              <option value="0" ${runtime.scannerAllowEnterTerminator === false ? 'selected' : ''}>No</option>
            </select>
          </label>
          <label class="field scanner-debug-pattern-field">
            <span>Pattern caracteres permitidos</span>
            <input id="settings-scanner-allowed-pattern" class="input" value="${escapeHtml(runtime.scannerAllowedCharsPattern || '[0-9A-Za-z\\-_.]')}" />
          </label>
        </div>
        <div class="settings-actions" style="margin-top: 8px;">
          <button class="button secondary" data-action="scanner-debug-save-settings" ${state.busy ? 'disabled' : ''}>
            ${state.settingsPendingAction === 'scanner-debug-save-settings' ? 'Guardando...' : 'Guardar y aplicar scanner'}
          </button>
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
        </div>
        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="scanner-debug-refresh" ${state.scannerDebugLoading ? 'disabled' : ''}>Refrescar</button>
          <button class="button secondary" data-action="scanner-debug-copy">Copiar logs</button>
          <button class="button secondary" data-action="scanner-debug-close">Cerrar</button>
        </div>
      </div>
    </div>
  `
    : '';

  const printerDiag = state.printerDiagnostics;
  const linuxStateSummary = printerDiag
    ? `configured=${printerDiag.configuredDevicePath} · resolved=${printerDiag.resolvedDevicePath || 'none'}`
    : 'Sin diagnostico cargado.';
  const printerUsbRows = printerDiag?.usbLpDevices?.length
    ? printerDiag.usbLpDevices
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.path)}</td>
        <td>${row.exists ? 'si' : 'no'}</td>
        <td>${row.writable ? 'si' : 'no'}</td>
        <td>${escapeHtml(row.owner || '-')}</td>
        <td>${escapeHtml(row.group || '-')}</td>
        <td>${escapeHtml(row.mode || '-')}</td>
      </tr>
    `,
        )
        .join('')
    : '<tr><td colspan="6">No se detectaron /dev/usb/lp*</td></tr>';
  const printerNotes = printerDiag?.notes?.length ? printerDiag.notes.map((note) => `- ${note}`).join('\n') : 'Sin notas.';
  const printerDebugView = getPrinterDebugView(state);
  const printerLogs = printerDebugView.logsJoined;
  const printerJobsHtml = state.printJobs.length
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
  const printerDebugHtml = state.printerDebugOpen
    ? `
    <div class="modal-overlay">
      <div class="modal history-modal printer-debug-modal">
        <div class="settings-header">
          <h2>Printer Debug / Testing</h2>
          <div class="settings-inline-status ${state.printerDebugLoading ? '' : 'success'}">
            ${
              state.printerDebugLoading
                ? 'Cargando diagnostico...'
                : escapeHtml(linuxStateSummary)
            }
          </div>
        </div>
        <div class="printer-debug-layout">
        <div class="printer-debug-body">
        <div class="settings-section-title">Printer settings</div>
        <div class="printer-debug-settings-grid">
          <label class="field">
            <span>Linux printer device path</span>
            <input id="printer-debug-device-path" class="input" value="${escapeHtml(
              state.printConfig?.linuxPrinterDevicePath || '/dev/pos58',
            )}" />
          </label>
          <label class="field">
            <span>Windows printer share</span>
            <input id="printer-debug-windows-printer" class="input" value="${escapeHtml(settingsConfig.windowsPrinterShare)}" />
          </label>
        </div>
        <div class="settings-actions">
          <button class="button secondary" data-action="printer-debug-save-config" ${state.busy ? 'disabled' : ''}>Guardar settings</button>
        </div>
        <div class="jobs-table-wrap history-table-wrap">
          <table class="jobs-table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Existe</th>
                <th>Writable</th>
                <th>Owner</th>
                <th>Group</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${escapeHtml(printerDiag?.pos58.path || '/dev/pos58')}</td>
                <td>${printerDiag?.pos58.exists ? 'si' : 'no'}</td>
                <td>${printerDiag?.pos58.writable ? 'si' : 'no'}</td>
                <td>${escapeHtml(printerDiag?.pos58.owner || '-')}</td>
                <td>${escapeHtml(printerDiag?.pos58.group || '-')}</td>
                <td>${escapeHtml(printerDiag?.pos58.mode || '-')}</td>
              </tr>
              ${printerUsbRows}
            </tbody>
          </table>
        </div>
        <label class="field">
          <span>Current user/groups</span>
          <textarea class="input scanner-debug-logs" rows="3" readonly>${escapeHtml(
            printerDiag
              ? `user=${printerDiag.currentUser} uid=${String(printerDiag.currentUid)} gid=${String(printerDiag.currentGid)} groups=${printerDiag.currentGroups.join(', ')}`
              : 'n/a',
          )}</textarea>
        </label>
        <label class="field">
          <span>Notas diagnostico</span>
          <textarea class="input scanner-debug-logs" rows="4" readonly>${escapeHtml(printerNotes)}</textarea>
        </label>
        <label class="field">
          <span>Print custom text</span>
          <textarea id="printer-debug-custom-text" class="input scanner-debug-logs" rows="4" placeholder="Texto personalizado para imprimir">${escapeHtml(
            state.printerDebugCustomText,
          )}</textarea>
        </label>
        <label class="field">
          <span style="display:flex; align-items:center; gap:8px;">
            <input id="printer-debug-include-footer" type="checkbox" ${state.printerDebugIncludeFooter ? 'checked' : ''} />
            Include debug footer (timestamp, app version, device path)
          </span>
        </label>
        <label class="field">
          <span>Logs</span>
          <textarea id="printer-debug-logs" class="input scanner-debug-logs" rows="6" readonly>${escapeHtml(printerLogs)}</textarea>
        </label>
        </div>
        <aside class="settings-column printer-debug-side">
          <div class="settings-section-title">Print jobs</div>
          <div class="settings-actions" style="margin-top: 0;">
            <button class="button secondary" data-action="printer-debug-refresh-jobs" ${state.busy ? 'disabled' : ''}>
              ${state.settingsPendingAction === 'refresh-jobs' ? 'Refrescando...' : 'Refrescar jobs'}
            </button>
          </div>
          <div class="jobs-table-wrap">
            <table class="jobs-table printer-jobs-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Intentos</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>${printerJobsHtml}</tbody>
            </table>
          </div>
        </aside>
        </div>
        <div class="modal-actions settings-footer">
          <button class="button secondary" data-action="printer-debug-refresh" ${state.printerDebugLoading ? 'disabled' : ''}>Refrescar</button>
          <button class="button secondary" data-action="printer-debug-self-test" ${state.busy ? 'disabled' : ''}>Print Self-Test</button>
          <button class="button secondary" data-action="printer-debug-print-text" ${state.busy ? 'disabled' : ''}>Print custom text</button>
          <button class="button secondary" data-action="printer-debug-copy-logs">Copiar logs</button>
          <button class="button secondary" data-action="printer-debug-close">Cerrar</button>
        </div>
      </div>
    </div>
  `
    : '';

  const canSeeTools = canUseToolsMenuRole(state.auth.session?.role);
  const normalizedRole = String(state.auth.session?.role || '').toLowerCase();
  const canSeeDebugTools = ['admin', 'supervisor'].includes(normalizedRole);
  const kioskLabel = state.runtimeConfig?.kioskDisplayName
    ? state.runtimeConfig.kioskDisplayName
    : state.runtimeConfig?.kioskNumber
      ? `Kiosko ${state.runtimeConfig.kioskNumber}`
      : state.runtimeConfig?.kioskId || 'Kiosko n/a';
  const userLabel = state.auth.session?.userName || 'Sin sesion';
  const roleLabel = state.auth.session?.role || 'Invitado';
  const topbarContextHtml = `
    <span class="pill"><span class="pill-icon">${iconUser()}</span><span class="pill-text">${escapeHtml(userLabel)}</span></span>
    <span class="pill"><span class="pill-text">${escapeHtml(roleLabel)}</span></span>
    <span class="pill"><span class="pill-text">${escapeHtml(kioskLabel)}</span></span>
  `;
  const currentTheme = getTheme();
  const themeIcon = currentTheme === 'dark' ? iconSun() : iconMoon();
  const themeLabel = currentTheme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';

  const headerActionsHtml = state.activation.required || state.activation.blocked
    ? ''
    : `
    <div class="action-group action-group-operation">
      <span class="action-group-label">Operacion</span>
      <div class="action-group-row">
        ${
          canSeeTools
            ? `
        <button class="button ghost tools-item tools-standalone" data-action="open-order-history" ${
          state.busy || hasSaleInProgress() ? 'disabled' : ''
        }>
          <span class="tools-item-icon">${iconHistory()}</span>
          <span class="tools-item-label">Historial del dia</span>
        </button>
        `
            : ''
        }
        <button class="button secondary mode-toggle ${state.tableModeEnabled ? 'active' : ''}" data-action="toggle-table-mode" ${state.busy ? 'disabled' : ''}>
          <span class="btn-icon">${iconTable()}</span>
          <span>${state.tableModeEnabled ? 'Modo mesa ON' : 'Modo mesa OFF'}</span>
        </button>
        <button class="button secondary sync-button ${state.manualSync.inFlight ? 'is-loading' : ''}" data-action="sync-outbox" ${state.manualSync.inFlight ? 'disabled' : ''}>
          <span class="btn-icon sync-icon">${iconSync()}</span>
          <span>Sincronizar</span>
        </button>
      </div>
    </div>
    ${
      canSeeTools
        ? `
    <div class="action-group action-group-management">
      <span class="action-group-label">Gestion</span>
      <div class="action-group-row">
        <details class="tools-menu">
          <summary class="icon-btn tools-trigger" aria-label="Herramientas">${iconGear()}</summary>
          <div class="tools-popover">
            <button class="button secondary tools-item" data-action="printer-debug-open" ${state.busy ? 'disabled' : ''}>
              <span class="tools-item-icon">${iconPrinter()}</span>
              <span class="tools-item-label">Ajustes impresora</span>
            </button>
            <button class="button secondary tools-item" data-action="open-barcode-binding" ${state.busy ? 'disabled' : ''}>
              <span class="tools-item-icon">${iconTag()}</span>
              <span class="tools-item-label">Vincular etiquetas</span>
            </button>
            <button class="button secondary tools-item" data-action="open-device-binding" ${state.busy ? 'disabled' : ''}>
              <span class="tools-item-icon">${iconInspect()}</span>
              <span class="tools-item-label">Configuracion dispositivo</span>
            </button>
            ${canSeeDebugTools
              ? `
            <button class="button secondary tools-item" data-action="scanner-debug-open" ${state.busy ? 'disabled' : ''}>
              <span class="tools-item-icon">${iconScan()}</span>
              <span class="tools-item-label">Scanner debug</span>
            </button>
            <button class="button secondary tools-item" data-action="printer-debug-open" ${state.busy ? 'disabled' : ''}>
              <span class="tools-item-icon">${iconPrinter()}</span>
              <span class="tools-item-label">Printer debug</span>
            </button>
            `
              : ''
            }
            <button class="button secondary tools-item" data-action="sync-catalog" ${state.busy ? 'disabled' : ''}>
              <span class="tools-item-icon">${iconSync()}</span>
              <span class="tools-item-label">Sincronizar catalogo</span>
            </button>
          </div>
        </details>
      </div>
    </div>
    `
        : ''
    }
    <div class="action-group action-group-user">
      <span class="action-group-label">Usuario</span>
      <div class="action-group-row">
        ${
          hasActivePosSession()
            ? `
        <button class="button ghost tools-item tools-standalone" data-action="pos-logout" ${state.busy ? 'disabled' : ''}>
          <span class="tools-item-icon">${iconUser()}</span>
          <span class="tools-item-label">Cerrar sesion</span>
        </button>
        `
            : ''
        }
        <button class="icon-btn theme-toggle ${currentTheme === 'dark' ? 'dark' : 'light'}" data-action="toggle-theme" title="${themeLabel}" aria-label="${themeLabel}">
          ${themeIcon}
        </button>
      </div>
    </div>
  `;
  const subtitleText = 'Offline-first';

  const cartPanelHtml = `
    <div class="cart-head">
      <h2 class="cart-title">${state.tableModeEnabled ? 'Mesa activa' : 'Carrito'}</h2>
      ${tableContextPill}
    </div>
    ${
      state.tableModeEnabled
        ? `<div class="cart-sub">${
            state.openTabsDetail?.tab
              ? `Cuenta ${escapeHtml(state.openTabsDetail.tab.folioText)} · Por enviar: ${state.openTabsDetail.pendingKitchenCount} · Enviados: ${tableSentLines.length} · Ultimo envio: ${
                  lastKitchenRound ? formatDate(lastKitchenRound.createdAt) : 'Sin envios'
                }`
              : 'Selecciona mesa/tab para operar.'
          }</div><div class="cart-sub">${tableLinesToggleHtml}</div>`
        : ''
    }
    ${
      state.tableModeEnabled && state.openTabsDetail
        ? `<div class="cart-sub cart-rounds"><strong>Rondas cocina recientes</strong></div>${kitchenRoundsHtml}`
        : ''
    }
    <div class="cart-list">${cartHtml}</div>
    <div class="cart-footer">
      <div class="total-row ${state.tableModeEnabled ? 'mesa-total' : ''}">
        <span>Total</span>
        <strong>${formatMoney(totalCents)}</strong>
      </div>
      <div class="cart-actions">
        ${
          state.tableModeEnabled
            ? `
          <section class="mesa-block mesa-block-operativo">
            <div class="mesa-block-title">Operativo</div>
            <button class="button primary mesa-primary-action kitchen-primary" data-action="open-tabs-send-kitchen" ${
              state.busy || !state.openTabsSelectedTabId ? 'disabled' : ''
            }>
              <span class="btn-icon">${iconKitchen()}</span>
              <span>Enviar a cocina</span>
            </button>
          </section>
          <section class="mesa-block mesa-block-final">
            <div class="mesa-block-title">Final</div>
            <div class="mesa-inline-actions">
              <button class="button secondary mesa-close-action" data-action="open-checkout" ${
                state.busy || !state.openTabsSelectedTabId || !tableLines.length ? 'disabled' : ''
              }>
                <span class="btn-icon">${iconReceipt()}</span>
                <span>Cerrar cuenta</span>
              </button>
              <button class="button ghost-link" data-action="table-refresh-detail" ${
                state.busy || !state.openTabsSelectedTabId ? 'disabled' : ''
              }>
                <span class="btn-icon">${iconInspect()}</span>
                <span>Ver detalle</span>
              </button>
            </div>
          </section>
          <section class="mesa-block mesa-block-critical">
            <div class="mesa-block-title">Critico</div>
            <div class="mesa-danger-row">
              <button class="button wine-danger" data-action="open-tabs-cancel-tab" ${
                state.busy || !state.openTabsSelectedTabId ? 'disabled' : ''
              }>Cancelar mesa</button>
            </div>
          </section>
        `
            : `
          <button class="button primary" data-action="open-checkout" ${cartLines.length ? '' : 'disabled'}>Confirmar pedido</button>
          <button class="button secondary" data-action="clear-cart" ${cartLines.length ? '' : 'disabled'}>Limpiar</button>
        `
        }
      </div>
    </div>
  `;

  const modalsHtml = `
    ${checkoutHtml}
    ${settingsHtml}
    ${deviceBindingHtml}
    ${barcodeBindingHtml}
    ${historyHtml}
    ${tabKitchenHistoryHtml}
    ${scannerDebugHtml}
    ${renderTableSelectorModal()}
    ${renderTablesSettingsModal()}
  `;
  const openTabsRegionHtml = SHOW_OPEN_TABS_DEBUG ? openTabsHtml : '';
  const gateActivationHtml = renderActivationGate();
  const gateAuthHtml = renderPosAuthGate();

  updateStatusBarState();
  renderScheduler.ensureShellRenderedOnce();
  const flushResult = renderScheduler.flush({
    shouldBlockAfterGates: hasBlockingGate,
    renderers: {
      'gate:activation': () => {
        renderRegion('gateActivation', () => {
          renderGateActivationRegion({
            html: gateActivationHtml,
            signatureStore: renderRuntime.regionSignature,
          });
        });
      },
      'gate:auth': () => {
        renderRegion('gateAuth', () => {
          renderGateAuthRegion({
            html: gateAuthHtml,
            signatureStore: renderRuntime.regionSignature,
          });
        });
      },
      shell: () => {
        renderRegion('shell', () => {
          renderShellRegion({
            html: headerActionsHtml,
            signatureStore: renderRuntime.regionSignature,
            apply: () => {
              if (ui.headerActions) ui.headerActions.innerHTML = headerActionsHtml;
            },
          });
          if (ui.topbarSubtitle) {
            ui.topbarSubtitle.textContent = subtitleText;
            ui.topbarSubtitle.title = state.status;
          }
          if (ui.topbarContext) {
            ui.topbarContext.innerHTML = topbarContextHtml;
            ui.topbarContext.title = state.status;
          }
        });
      },
      catalog: () => {
        renderCatalogRegion({
          categoriesHtml: categoryHtml,
          productsHtml: productsHtml,
          signatureStore: renderRuntime.regionSignature,
          applyCategories: () =>
            renderRegion('categories', () => {
              if (ui.categoriesRegion) ui.categoriesRegion.innerHTML = categoryHtml;
            }),
          applyProducts: () =>
            renderRegion('products', () => {
              if (ui.productsRegion) ui.productsRegion.innerHTML = productsHtml;
            }),
        });
      },
      cart: () => {
        renderRegion('cart', () => {
          renderCartRegion({
            html: cartPanelHtml,
            signatureStore: renderRuntime.regionSignature,
            apply: () => {
              if (ui.cartRegion) ui.cartRegion.innerHTML = cartPanelHtml;
            },
          });
        });
      },
      'open-tabs': () => {
        renderRegion('openTabs', () => {
          renderOpenTabsRegion({
            html: openTabsRegionHtml,
            signatureStore: renderRuntime.regionSignature,
          });
        });
      },
      status: () => {
        renderRegion('statusbar', () => {
          renderStatusRegion({
            apply: () => {
              renderBottomStatusRegion();
            },
          });
        });
      },
      'printer-debug': () => {
        renderRegion('printerDebug', () => {
          renderPrinterDebugRegion({
            html: printerDebugHtml,
            signatureStore: renderRuntime.regionSignature,
          });
        });
      },
      modals: () => {
        renderRegion('modals', () => {
          renderModalsRegion({
            html: modalsHtml,
            signatureStore: renderRuntime.regionSignature,
          });
        });
      },
    },
  });

  if (flushResult.blockedByGate) {
    renderScheduler.invalidateMany(['shell', 'status']);
  }

  restoreFocusSnapshot(focusSnapshot);

  if (profileRender) {
    const flushElapsed = measure('render:flush-total', flushStart, performance.now());
    if (flushElapsed > RENDER_PROFILE_WARN_MS) {
      const level = flushElapsed > RENDER_PROFILE_SLOW_MS ? 'warn' : 'info';
      // eslint-disable-next-line no-console
      console[level](`[render-profiler] slow-render duration=${flushElapsed.toFixed(2)}ms`);
    }
    const summary = reportEvery('render:flush-total', RENDER_PROFILE_REPORT_EVERY);
    if (summary) {
      // eslint-disable-next-line no-console
      console.info(`[render-profiler] ${summary}`);
    }
  }
}

function openBarcodeBinding(): void {
  state.barcodeBindingOpen = true;
  state.barcodeBindingStatusMessage = 'Selecciona un producto y escanea una etiqueta.';
  state.barcodeBindingStatusKind = 'info';
  bumpCatalogVersion();
  ensureBarcodeBindingCategory();
  ensureBarcodeBindingSelection(getBarcodeBindingItems());
  void applyScanContext();
  render();
}

function closeBarcodeBinding(): void {
  if (state.barcodeBindingBusy) return;
  state.barcodeBindingOpen = false;
  bumpCatalogVersion();
  void applyScanContext();
  render();
}

async function openDeviceBinding(): Promise<void> {
  if (state.deviceBindingBusy) return;
  state.deviceBindingOpen = true;
  state.deviceBindingBusy = true;
  state.deviceBindingConfirmReset = false;
  state.deviceBindingStatusMessage = 'Cargando vinculacion del dispositivo...';
  state.deviceBindingStatusKind = 'info';
  bumpRuntimeVersion();
  void applyScanContext();
  render();

  try {
    const binding = await window.posKiosk.getDeviceBindingInfo();
    state.runtimeConfig = binding.runtime;
    state.deviceBindingApiBaseUrl = binding.apiBaseUrl;
    state.deviceBindingStatusMessage = binding.hasBinding
      ? 'Dispositivo vinculado. Puedes desvincular para asociarlo a otro tenant.'
      : 'Este dispositivo no tiene una vinculacion activa.';
    state.deviceBindingStatusKind = 'success';
  } catch (error) {
    state.deviceBindingStatusMessage =
      error instanceof Error ? error.message : 'No se pudo cargar la vinculacion del dispositivo.';
    state.deviceBindingStatusKind = 'error';
  } finally {
    state.deviceBindingBusy = false;
    bumpRuntimeVersion();
    render();
  }
}

function closeDeviceBinding(): void {
  if (state.deviceBindingBusy) return;
  state.deviceBindingOpen = false;
  state.deviceBindingConfirmReset = false;
  bumpRuntimeVersion();
  void applyScanContext();
  render();
}

function checkoutNumpadInput(value: string): void {
  if (!state.checkoutOpen || state.checkoutPaymentMethod === 'tarjeta' || !isTouchScreenEnabled(state.runtimeConfig))
    return;
  if (!/^\d$/.test(value)) return;
  state.receivedInput = `${state.receivedInput}${value}`.replace(/^0+(?=\d)/, '');
  state.enterConfirmArmedAt = null;
  bumpCartVersion();
  render();
}

function checkoutNumpadBackspace(): void {
  if (!state.checkoutOpen || state.checkoutPaymentMethod === 'tarjeta' || !isTouchScreenEnabled(state.runtimeConfig))
    return;
  state.receivedInput = state.receivedInput.slice(0, -1);
  state.enterConfirmArmedAt = null;
  bumpCartVersion();
  render();
}

function checkoutNumpadClear(): void {
  if (!state.checkoutOpen || state.checkoutPaymentMethod === 'tarjeta' || !isTouchScreenEnabled(state.runtimeConfig))
    return;
  state.receivedInput = '';
  state.enterConfirmArmedAt = null;
  bumpCartVersion();
  render();
}

async function resetDeviceBinding(): Promise<void> {
  if (state.deviceBindingBusy) return;

  if (!state.deviceBindingConfirmReset) {
    state.deviceBindingConfirmReset = true;
    state.deviceBindingStatusMessage = 'Confirma la accion para eliminar la vinculacion actual.';
    state.deviceBindingStatusKind = 'info';
    bumpRuntimeVersion();
    render();
    return;
  }

  state.deviceBindingBusy = true;
  state.deviceBindingStatusMessage = 'Eliminando vinculacion del dispositivo...';
  state.deviceBindingStatusKind = 'info';
  bumpRuntimeVersion();
  render();

  try {
    const result = await window.posKiosk.resetDeviceBinding();
    if (!result.ok) {
      state.deviceBindingStatusMessage = result.error || 'No se pudo eliminar la vinculacion.';
      state.deviceBindingStatusKind = 'error';
      return;
    }

    state.runtimeConfig = await window.posKiosk.getRuntimeConfig();
    state.auth.session = null;
    state.auth.selectedUserId = '';
    state.auth.pinInput = '';
    state.auth.message = 'Inicia sesion para operar ventas.';
    state.auth.kind = 'info';
    state.auth.users = [];
    clearCart();
    state.deviceBindingOpen = false;
    state.deviceBindingConfirmReset = false;
    state.activation.tenantSlugInput = state.runtimeConfig?.tenantSlug || '';
    await refreshDeviceActivationState();
    await applyScanContext();
    bumpAuthVersion();
    bumpRuntimeVersion();
    setStatus('Vinculacion eliminada. Ingresa nuevo Tenant Slug y Claim Code para activar.', 'success');
  } catch (error) {
    state.deviceBindingStatusMessage =
      error instanceof Error ? error.message : 'No se pudo eliminar la vinculacion del dispositivo.';
    state.deviceBindingStatusKind = 'error';
  } finally {
    state.deviceBindingBusy = false;
    bumpRuntimeVersion();
    render();
  }
}

async function saveTouchScreenSetting(): Promise<void> {
  if (state.deviceBindingBusy) return;
  const runtime = ensureRuntimeConfigMutable();
  state.deviceBindingBusy = true;
  state.deviceBindingStatusMessage = 'Guardando configuracion touch...';
  state.deviceBindingStatusKind = 'info';
  bumpRuntimeVersion();
  render();

  try {
    await window.posKiosk.setRuntimeConfig({
      touchScreenEnabled: isTouchScreenEnabled(runtime),
    });
    state.runtimeConfig = await window.posKiosk.getRuntimeConfig();
    if (!isTouchScreenEnabled(state.runtimeConfig)) {
      state.checkoutNumpadOpen = false;
      bumpCartVersion();
    }
    state.deviceBindingStatusMessage = 'Configuracion touch guardada.';
    state.deviceBindingStatusKind = 'success';
  } catch (error) {
    state.deviceBindingStatusMessage =
      error instanceof Error ? error.message : 'No se pudo guardar la configuracion touch.';
    state.deviceBindingStatusKind = 'error';
  } finally {
    state.deviceBindingBusy = false;
    bumpRuntimeVersion();
    render();
  }
}

async function openScannerDebug(): Promise<void> {
  state.scannerDebugOpen = true;
  bumpScannerVersion();
  await refreshScannerDebugState();
}

function closeScannerDebug(): void {
  state.scannerDebugOpen = false;
  bumpScannerVersion();
  render();
}

function pushPrinterDebugLog(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  state.printerDebugLogs = [...state.printerDebugLogs, line].slice(-120);
  bumpPrinterVersion();
}

async function refreshPrinterDiagnostics(): Promise<void> {
  state.printerDebugLoading = true;
  state.settingsPendingAction = 'printer-debug-diag';
  bumpPrinterVersion();
  bumpUiVersion();
  render();
  try {
    state.printerDiagnostics = await window.posKiosk.printerGetDiagnostics();
    bumpPrinterVersion();
    pushPrinterDebugLog('Diagnostics refreshed');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo cargar Printer Debug.';
    pushPrinterDebugLog(`Diagnostics failed: ${message}`);
    setStatus(message, 'error');
  } finally {
    state.printerDebugLoading = false;
    state.settingsPendingAction = null;
    bumpPrinterVersion();
    bumpUiVersion();
    render();
  }
}

async function openPrinterDebug(): Promise<void> {
  state.printerDebugOpen = true;
  bumpPrinterVersion();
  void applyScanContext();
  try {
    if (!state.printConfig) {
      await loadSettingsData();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo cargar configuracion de impresora.';
    pushPrinterDebugLog(`Open debug warning: ${message}`);
  }
  await refreshPrinterDiagnostics();
}

function closePrinterDebug(): void {
  state.printerDebugOpen = false;
  bumpPrinterVersion();
  void applyScanContext();
  render();
}

async function printerSelfTest(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.settingsPendingAction = 'printer-debug-self-test';
  state.statusBar.print.phase = 'working';
  state.statusBar.print.lastErrorShort = '';
  bumpUiVersion();
  bumpPrinterVersion();
  render();
  try {
    const result = await window.posKiosk.printerPrintSelfTest({
      includeDebugFooter: state.printerDebugIncludeFooter,
    });
    pushPrinterDebugLog(`Self-test result: ${result.status}${result.error ? ` (${result.error})` : ''}`);
    state.statusBar.print.phase = result.ok ? 'ok' : 'error';
    bumpUiVersion();
    if (!result.ok) {
      state.statusBar.print.lastErrorShort = result.error || 'self-test failed';
      setStatus(result.error || 'Self-test failed.', 'error');
    } else {
      setStatus(`Self-test enviado. Job ${result.jobId}`, 'success');
    }
    await loadSettingsData();
    await refreshPrinterDiagnostics();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error en self-test.';
    state.statusBar.print.phase = 'error';
    state.statusBar.print.lastErrorShort = message;
    bumpUiVersion();
    pushPrinterDebugLog(`Self-test failed: ${message}`);
    setStatus(message, 'error');
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    bumpUiVersion();
    bumpPrinterVersion();
    render();
  }
}

async function savePrinterDebugConfig(): Promise<void> {
  if (!state.printConfig || state.busy) return;
  state.busy = true;
  state.settingsPendingAction = 'save';
  bumpUiVersion();
  render();
  try {
    state.printConfig = await window.posKiosk.setPrintConfig(state.printConfig);
    bumpPrinterVersion();
    pushPrinterDebugLog(`Saved linux_printer_device_path=${state.printConfig.linuxPrinterDevicePath}`);
    setStatus('Printer device path guardado.', 'success');
    await refreshPrinterDiagnostics();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo guardar printer device path.';
    pushPrinterDebugLog(`Save config failed: ${message}`);
    setStatus(message, 'error');
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    bumpUiVersion();
    render();
  }
}

async function printerPrintCustomText(): Promise<void> {
  const text = state.printerDebugCustomText.trim();
  if (!text) {
    setStatus('Escribe texto para imprimir.', 'info');
    return;
  }
  if (state.busy) return;
  state.busy = true;
  state.settingsPendingAction = 'printer-debug-text';
  state.statusBar.print.phase = 'working';
  state.statusBar.print.lastErrorShort = '';
  bumpUiVersion();
  bumpPrinterVersion();
  render();
  try {
    const result = await window.posKiosk.printerPrintText(text, {
      includeDebugFooter: state.printerDebugIncludeFooter,
    });
    pushPrinterDebugLog(`Custom text result: ${result.status}${result.error ? ` (${result.error})` : ''}`);
    state.statusBar.print.phase = result.ok ? 'ok' : 'error';
    bumpUiVersion();
    if (!result.ok) {
      state.statusBar.print.lastErrorShort = result.error || 'print failed';
      setStatus(result.error || 'No se pudo imprimir texto.', 'error');
    } else {
      setStatus(`Texto enviado. Job ${result.jobId}`, 'success');
    }
    await loadSettingsData();
    await refreshPrinterDiagnostics();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error imprimiendo texto.';
    state.statusBar.print.phase = 'error';
    state.statusBar.print.lastErrorShort = message;
    bumpUiVersion();
    pushPrinterDebugLog(`Custom text failed: ${message}`);
    setStatus(message, 'error');
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    bumpUiVersion();
    bumpPrinterVersion();
    render();
  }
}

async function copyPrinterDebugLogs(): Promise<void> {
  const content = state.printerDebugLogs.join('\n');
  if (!content) {
    setStatus('No hay logs para copiar.', 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(content);
    setStatus('Logs de impresora copiados.', 'success');
  } catch {
    const area = document.getElementById('printer-debug-logs') as HTMLTextAreaElement | null;
    area?.focus();
    area?.select();
    const ok = document.execCommand('copy');
    setStatus(ok ? 'Logs de impresora copiados.' : 'No se pudo copiar logs.', ok ? 'success' : 'error');
  }
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

async function saveScannerDebugSettings(): Promise<void> {
  if (state.busy) return;
  const runtime = ensureRuntimeConfigMutable();
  state.busy = true;
  state.settingsPendingAction = 'scanner-debug-save-settings';
  bumpUiVersion();
  render();
  try {
    state.runtimeConfig = await window.posKiosk.setRuntimeConfig({
      scannerMinCodeLen: runtime.scannerMinCodeLen,
      scannerMaxCodeLen: runtime.scannerMaxCodeLen,
      scannerMaxInterKeyMsScan: runtime.scannerMaxInterKeyMsScan,
      scannerScanEndGapMs: runtime.scannerScanEndGapMs,
      scannerHumanKeyGapMs: runtime.scannerHumanKeyGapMs,
      scannerAllowEnterTerminator: runtime.scannerAllowEnterTerminator,
      scannerAllowedCharsPattern: runtime.scannerAllowedCharsPattern,
    });
    await window.posScanner.setSettings(runtimeScannerSettingsToInput(state.runtimeConfig));
    await applyScanContext();
    await refreshScannerDebugState();
    bumpRuntimeVersion();
    setStatus('Configuracion de scanner guardada y aplicada.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'No se pudo guardar configuracion de scanner.', 'error');
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    bumpUiVersion();
    render();
  }
}

function ensureRuntimeConfigMutable(): RuntimeConfig {
  if (!state.runtimeConfig) {
    state.runtimeConfig = resolveRuntimeConfigDefaults();
    bumpRuntimeVersion();
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
    bumpCatalogVersion();
    render();
    return;
  }

  if (state.barcodeBindingBusy) return;

  state.barcodeBindingBusy = true;
  state.barcodeBindingStatusMessage = `Asignando etiqueta ${barcode}...`;
  state.barcodeBindingStatusKind = 'info';
  bumpCatalogVersion();
  render();

  try {
    const result = await window.posKiosk.assignProductBarcode({ itemId, barcode });
    if (!result.ok) {
      state.barcodeBindingStatusMessage = result.error || 'No se pudo asignar la etiqueta.';
      state.barcodeBindingStatusKind = 'error';
      bumpCatalogVersion();
      return;
    }

    if (state.snapshot) {
      state.snapshot.items = state.snapshot.items.map((item) =>
        item.id === itemId ? { ...item, barcode } : item,
      );
      bumpCatalogVersion();
    }

    state.barcodeBindingStatusMessage = `Etiqueta ${barcode} asignada correctamente.`;
    state.barcodeBindingStatusKind = 'success';
    bumpCatalogVersion();
  } catch (error) {
    state.barcodeBindingStatusMessage =
      error instanceof Error ? error.message : 'Error al guardar etiqueta.';
    state.barcodeBindingStatusKind = 'error';
    bumpCatalogVersion();
  } finally {
    state.barcodeBindingBusy = false;
    bumpCatalogVersion();
    render();
  }
}

function addScannedProductToCart(barcodeRaw: string): void {
  if (state.busy || state.checkoutOpen || state.settingsOpen || state.ordersHistoryOpen)
    return;
  if (!hasActivePosSession()) return;
  void touchPosSessionActivity();

  const product = findItemByBarcode(barcodeRaw);
  if (!product) {
    state.statusBar.scanner.phase = 'warn';
    state.statusBar.scanner.lastCode = barcodeRaw;
    state.statusBar.scanner.lastAt = new Date().toISOString();
    bumpScannerVersion();
    bumpUiVersion();
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
  bumpScannerVersion();
  bumpUiVersion();
  setStatus(`Escaneado: ${product.name} agregado al carrito.`, 'success');
}

async function handleScanReading(reading: ScannerReading): Promise<void> {
  state.statusBar.scanner.lastCode = reading.code;
  state.statusBar.scanner.lastAt = reading.receivedAt || new Date().toISOString();
  bumpScannerVersion();
  bumpUiVersion();
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
  bumpCatalogVersion();
  ensureActiveCategory();
}

async function syncCatalog(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  bumpUiVersion();
  setStatus('Sincronizando catalogo...');
  try {
    const result = await window.posKiosk.syncCatalog();
    if (!result.ok) {
      setStatus(result.error || 'No se pudo sincronizar.', 'error');
      return;
    }
    await loadCatalogFromLocal();
    await refreshPosUsersFromCatalog();
    setStatus(`Sync completada: ${result.categoriesCount} categorias y ${result.itemsCount} productos.`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Error al sincronizar catalogo.', 'error');
  } finally {
    state.busy = false;
    bumpUiVersion();
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
  bumpPrinterVersion();
  bumpRuntimeVersion();
  bumpOpenTabsVersion();
}

async function refreshDeviceActivationState(): Promise<void> {
  const activation = await window.posKiosk.getDeviceActivationState();
  if (activation.state === 'unclaimed') {
    state.activation.required = true;
    state.activation.blocked = false;
    state.activation.kind = 'info';
    state.activation.message = activation.message || 'Dispositivo sin activar.';
    bumpActivationVersion();
    return;
  }
  if (activation.state === 'revoked') {
    lockAppForDeviceRevoked(activation.message || 'Dispositivo revocado o deshabilitado.');
    return;
  }
  state.activation.required = false;
  state.activation.blocked = false;
  bumpActivationVersion();
}

async function activateDeviceClaimFlow(): Promise<void> {
  if (state.activation.inFlight) return;
  const tenantSlug = state.activation.tenantSlugInput.trim().toLowerCase();
  const claimCode = state.activation.claimCodeInput.trim().toUpperCase();
  if (!tenantSlug) {
    state.activation.kind = 'error';
    state.activation.message = 'Tenant Slug es requerido.';
    bumpActivationVersion();
    render();
    return;
  }
  if (!claimCode) {
    state.activation.kind = 'error';
    state.activation.message = 'Claim Code es requerido.';
    bumpActivationVersion();
    render();
    return;
  }

  state.activation.inFlight = true;
  state.activation.kind = 'info';
  state.activation.message = 'Activando dispositivo...';
  bumpActivationVersion();
  render();

  try {
    const result = await window.posKiosk.activateDeviceClaim({
      tenantSlug,
      claimCode,
    });
    if (!result.ok) {
      state.activation.kind = 'error';
      state.activation.message = result.error || 'No se pudo activar dispositivo.';
      bumpActivationVersion();
      return;
    }

    state.runtimeConfig = await window.posKiosk.getRuntimeConfig();
    bumpRuntimeVersion();
    await refreshDeviceActivationState();
    if (state.activation.required || state.activation.blocked) {
      return;
    }

    await window.posScanner.setSettings(runtimeScannerSettingsToInput(state.runtimeConfig));
    await applyScanContext();
    await loadCatalogFromLocal();
    await refreshPosUsersFromCatalog();
    await refreshPrintStatusFromJobs(false);
    await refreshSyncStatus();

    state.activation.kind = 'success';
    state.activation.message = 'Dispositivo activado correctamente.';
    bumpActivationVersion();
    setStatus('Dispositivo activado. Operacion habilitada.', 'success');
  } catch (error) {
    state.activation.kind = 'error';
    state.activation.message = error instanceof Error ? error.message : 'Error activando dispositivo.';
    bumpActivationVersion();
  } finally {
    state.activation.inFlight = false;
    bumpActivationVersion();
    render();
  }
}

async function openSettings(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.settingsOpen = true;
  state.settingsPendingAction = 'load';
  state.settingsStatusMessage = 'Cargando ajustes...';
  state.settingsStatusKind = 'info';
  bumpUiVersion();
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
    bumpUiVersion();
    render();
  }
}

function closeSettings(): void {
  if (state.busy) return;
  state.settingsOpen = false;
  bumpUiVersion();
  void applyScanContext();
  render();
}

async function loadTablesSettings(): Promise<void> {
  state.tablesSettingsRows = await window.posKiosk.listOpenTabsTables(null);
  bumpOpenTabsVersion();
}

async function openTablesSettings(): Promise<void> {
  if (state.tablesSettingsBusy || !state.openTabsIsPosMaster) return;
  state.tablesSettingsOpen = true;
  state.tablesSettingsLoading = true;
  bumpOpenTabsVersion();
  render();
  try {
    await loadTablesSettings();
  } finally {
    state.tablesSettingsLoading = false;
    bumpOpenTabsVersion();
    render();
  }
}

function closeTablesSettings(): void {
  if (state.tablesSettingsBusy) return;
  state.tablesSettingsOpen = false;
  state.tablesSettingsPreview = '';
  state.tablesSettingsConfirmText = '';
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
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
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    await loadTablesSettings();
    await refreshOpenTabsSnapshot(false);
    setStatus(`Mesas generadas: ${result.upserted}.`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Error generando mesas.', 'error');
  } finally {
    state.tablesSettingsBusy = false;
    bumpOpenTabsVersion();
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
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    render();
  }
}

async function toggleTableActive(tableId: string, isActive: boolean): Promise<void> {
  state.tablesSettingsBusy = true;
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
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
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    render();
  }
}

async function reorderTable(tableId: string, direction: 'up' | 'down'): Promise<void> {
  state.tablesSettingsBusy = true;
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    render();
  }
}

async function loadOrderHistory(): Promise<void> {
  state.ordersHistory = await window.posKiosk.listOrderHistory(80);
  bumpUiVersion();
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
  bumpUiVersion();
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
    bumpUiVersion();
    render();
  }
}

function closeOrderHistory(): void {
  if (state.ordersHistoryActionBusy) return;
  state.ordersHistoryOpen = false;
  bumpUiVersion();
  void applyScanContext();
  render();
}

async function refreshOrderHistory(): Promise<void> {
  if (state.ordersHistoryLoading || state.ordersHistoryActionBusy) return;
  state.ordersHistoryLoading = true;
  state.ordersHistoryStatusMessage = 'Refrescando historial...';
  state.ordersHistoryStatusKind = 'info';
  bumpUiVersion();
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
    bumpUiVersion();
    render();
  }
}

async function reprintOrderFromHistory(orderId: string): Promise<void> {
  if (!(await ensurePosSessionOrBlock())) return;
  if (!(await ensureSupervisorOverrideIfNeeded('reimprimir orden'))) return;
  if (state.ordersHistoryActionBusy) return;
  state.ordersHistoryActionBusy = true;
  state.ordersHistoryStatusMessage = 'Enviando reimpresion...';
  state.ordersHistoryStatusKind = 'info';
  bumpUiVersion();
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
    bumpUiVersion();
    render();
  }
}

async function cancelOrderFromHistory(orderId: string): Promise<void> {
  if (!(await ensurePosSessionOrBlock())) return;
  if (!(await ensureSupervisorOverrideIfNeeded('cancelar orden'))) return;
  if (state.ordersHistoryActionBusy) return;
  const accepted = window.confirm('Esta accion cancelara la orden seleccionada. Deseas continuar?');
  if (!accepted) return;

  state.ordersHistoryActionBusy = true;
  state.ordersHistoryStatusMessage = 'Cancelando orden...';
  state.ordersHistoryStatusKind = 'info';
  bumpUiVersion();
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
    bumpUiVersion();
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
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    render();
  }
}

function closeTabKitchenHistory(): void {
  if (state.tabKitchenHistoryBusy) return;
  state.tabKitchenHistoryOpen = false;
  state.tabKitchenHistoryTabId = '';
  state.tabKitchenHistoryDetail = null;
  bumpOpenTabsVersion();
  void applyScanContext();
  render();
}

async function reprintTabKitchenRound(mutationId: string): Promise<void> {
  if (!state.tabKitchenHistoryTabId || state.tabKitchenHistoryBusy) return;
  state.tabKitchenHistoryBusy = true;
  state.tabKitchenHistoryStatusMessage = 'Reimprimiendo comanda...';
  state.tabKitchenHistoryStatusKind = 'info';
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
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
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    render();
  }
}

async function confirmSale(): Promise<void> {
  if (!(await ensurePosSessionOrBlock())) return;
  if (!canConfirmPayment()) return;
  state.enterConfirmArmedAt = null;
  state.statusBar.print.phase = 'working';
  state.statusBar.print.lastErrorShort = '';
  bumpCartVersion();
  bumpUiVersion();

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
    bumpUiVersion();
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
      state.checkoutNumpadOpen = false;
      state.receivedInput = '';
      bumpCartVersion();
      void applyScanContext();
      state.openTabsSelectedTabId = '';
      bumpOpenTabsVersion();
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
      bumpUiVersion();
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
  bumpUiVersion();
  render();

  try {
    const totalCents = getCurrentSaleTotalCents();
    const result = await window.posKiosk.createSaleAndPrint({
      lines,
      pagoRecibidoCents: state.checkoutPaymentMethod === 'tarjeta' ? totalCents : parseReceivedCents(),
      metodoPago: state.checkoutPaymentMethod,
    });

    if (!result.ok) {
      throw new Error(result.error || 'No se pudo confirmar la venta.');
    }

    clearCart();
    state.checkoutOpen = false;
    state.checkoutNumpadOpen = false;
    state.receivedInput = '';
    bumpCartVersion();
    void applyScanContext();

    if (result.printStatus === 'FAILED') {
      state.statusBar.print.phase = 'error';
      state.statusBar.print.lastErrorShort = result.error || 'fallo impresion';
      setStatus(`Venta ${result.folioText || ''} guardada localmente. Error de impresion: ${result.error || 'sin detalle'}.`, 'error');
    } else if (result.printStatus === 'QUEUED') {
      state.statusBar.print.phase = 'working';
      state.statusBar.print.lastErrorShort = '';
      schedulePrintStatusPoll();
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
    bumpUiVersion();
    render();
  }
}

async function saveSettings(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.settingsPendingAction = 'save';
  state.settingsStatusMessage = 'Guardando ajustes...';
  state.settingsStatusKind = 'info';
  bumpUiVersion();
  render();

  try {
    if (state.printConfig) {
      state.printConfig = await window.posKiosk.setPrintConfig(state.printConfig);
      bumpPrinterVersion();
    }
    if (state.runtimeConfig) {
      state.runtimeConfig = await window.posKiosk.setRuntimeConfig(state.runtimeConfig);
      bumpRuntimeVersion();
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
    bumpUiVersion();
    render();
  }
}

async function refreshPrintJobs(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.settingsPendingAction = 'refresh-jobs';
  state.settingsStatusMessage = 'Refrescando jobs...';
  state.settingsStatusKind = 'info';
  bumpUiVersion();
  render();

  try {
    state.printJobs = await window.posKiosk.listPrintJobs(20);
    bumpPrinterVersion();
    state.settingsStatusMessage = 'Jobs de impresion actualizados.';
    state.settingsStatusKind = 'success';
  } catch (error) {
    state.settingsStatusMessage = error instanceof Error ? error.message : 'No se pudieron cargar jobs.';
    state.settingsStatusKind = 'error';
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    bumpUiVersion();
    render();
  }
}

async function refreshPrintStatusFromJobs(scheduleIfQueued = false): Promise<void> {
  if (printStatusPollInFlight) return;
  printStatusPollInFlight = true;
  try {
    const jobs = await window.posKiosk.listPrintJobs(20);
    state.printJobs = jobs;
    bumpPrinterVersion();
    const latest = jobs[0];
    if (latest?.status === 'FAILED') {
      state.statusBar.print.phase = 'error';
      state.statusBar.print.lastErrorShort = latest.lastError || 'fallo impresion';
    } else if (latest?.status === 'SENT') {
      state.statusBar.print.phase = 'ok';
      state.statusBar.print.lastErrorShort = '';
    } else if (latest?.status === 'QUEUED') {
      state.statusBar.print.phase = 'working';
      if (scheduleIfQueued) {
        schedulePrintStatusPoll(900);
      }
    } else if (state.statusBar.print.phase === 'working') {
      state.statusBar.print.phase = 'idle';
      state.statusBar.print.lastErrorShort = '';
    }
    render();
  } catch {
    // best effort; keep current status bar state
  } finally {
    printStatusPollInFlight = false;
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
  bumpUiVersion();
  bumpPrinterVersion();
  render();

  try {
    const result = await window.posKiosk.printerPrintSelfTest({
      includeDebugFooter: state.printerDebugIncludeFooter,
    });
    if (!result.ok) throw new Error(result.error || 'No se pudo imprimir prueba.');
    await loadSettingsData();
    state.statusBar.print.phase = 'ok';
    bumpUiVersion();
    state.settingsStatusMessage = `Prueba enviada. Job: ${result.jobId}`;
    state.settingsStatusKind = 'success';
  } catch (error) {
    state.statusBar.print.phase = 'error';
    state.statusBar.print.lastErrorShort = error instanceof Error ? error.message : 'error impresion';
    bumpUiVersion();
    state.settingsStatusMessage = error instanceof Error ? error.message : 'Error al imprimir prueba.';
    state.settingsStatusKind = 'error';
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    bumpUiVersion();
    bumpPrinterVersion();
    render();
  }
}

async function syncOutbox(manual = false): Promise<void> {
  if (manual) {
    if (state.manualSync.inFlight) return;
    state.manualSync.inFlight = true;
    bumpSyncVersion();
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
    bumpSyncVersion();

    if (manual && !result.ok) {
      setStatus(
        `Sync parcial/fallida. Procesados: ${result.processed}, enviados: ${result.sent}, fallidos: ${result.failed}, pendientes: ${result.pending}. ${result.error || ''}`,
        'error',
      );
      state.manualSync.lastError = result.error || 'Sync parcial/fallida.';
      bumpSyncVersion();
    } else if (manual) {
      setStatus(
        `Sync OK. Procesados: ${result.processed}, enviados: ${result.sent}, pendientes: ${result.pending}.`,
        'success',
      );
      state.manualSync.lastError = '';
      state.manualSync.lastResultAt = new Date().toISOString();
      bumpSyncVersion();
    }
    if (isDeviceInactiveError(result.error)) {
      lockAppForDeviceRevoked('Dispositivo revocado o deshabilitado. Operacion bloqueada.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error sincronizando outbox.';
    state.syncLastError = message;
    state.autoSync.lastErrorShort = message;
    state.autoSync.phase = 'retrying';
    bumpSyncVersion();
    if (manual) {
      state.manualSync.lastError = message;
      bumpSyncVersion();
      setStatus(message, 'error');
    }
    if (isDeviceInactiveError(message)) {
      lockAppForDeviceRevoked('Dispositivo revocado o deshabilitado. Operacion bloqueada.');
    }
  } finally {
    if (manual) {
      state.manualSync.inFlight = false;
      bumpSyncVersion();
    }
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
    bumpSyncVersion();
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
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    render();
  }
}

async function openTabForSelectedTable(): Promise<void> {
  if (state.openTabsBusy) return;
  state.openTabsBusy = true;
  setOpenTabsStatus('Abriendo mesa...', 'info');
  bumpOpenTabsVersion();
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
    state.openTabsShowSentLines = false;
    bumpOpenTabsVersion();
    await refreshOpenTabsSnapshot(true);
    setOpenTabsStatus(`Mesa abierta: ${result.folioText || result.tabId}.`, 'success');
    triggerSyncSoon();
  } catch (error) {
    setOpenTabsStatus(error instanceof Error ? error.message : 'Error abriendo mesa.', 'error');
  } finally {
    state.openTabsBusy = false;
    bumpOpenTabsVersion();
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
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    render();
  }
}

async function updateTabLine(lineId: string, qty: number): Promise<void> {
  if (state.openTabsBusy || !state.openTabsSelectedTabId) return;
  state.openTabsBusy = true;
  setOpenTabsStatus('Actualizando cantidad...', 'info');
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    render();
  }
}

async function removeTabLine(lineId: string): Promise<void> {
  if (state.openTabsBusy || !state.openTabsSelectedTabId) return;
  state.openTabsBusy = true;
  setOpenTabsStatus('Removiendo item...', 'info');
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    render();
  }
}

async function sendSelectedTabToKitchen(): Promise<void> {
  if (state.openTabsBusy || !state.openTabsSelectedTabId) return;
  state.openTabsBusy = true;
  state.statusBar.print.phase = 'working';
  state.statusBar.print.lastErrorShort = '';
  bumpPrinterVersion();
  bumpOpenTabsVersion();
  setOpenTabsStatus('Enviando a cocina...', 'info');
  render();
  try {
    const result = await window.posKiosk.sendTabToKitchen({ tabId: state.openTabsSelectedTabId });
    await refreshOpenTabsSnapshot(true);
    state.openTabsShowSentLines = false;
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
    bumpOpenTabsVersion();
    render();
  }
}

async function closeSelectedTabPaid(): Promise<void> {
  if (!(await ensurePosSessionOrBlock())) return;
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
  bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
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
    bumpOpenTabsVersion();
    render();
  }
}

async function cancelSelectedTab(): Promise<void> {
  if (state.openTabsBusy || !state.openTabsSelectedTabId) return;
  const accepted = window.confirm('Se cancelara esta tab. Deseas continuar?');
  if (!accepted) return;

  state.openTabsBusy = true;
  setOpenTabsStatus('Cancelando tab...', 'info');
  bumpOpenTabsVersion();
  render();
  try {
    const result = await window.posKiosk.cancelTab(state.openTabsSelectedTabId);
    if (!result.ok) {
      setOpenTabsStatus(result.error || 'No se pudo cancelar tab.', 'error');
      return;
    }
    state.openTabsSelectedTabId = '';
    bumpOpenTabsVersion();
    await refreshOpenTabsSnapshot(false);
    setOpenTabsStatus('Tab cancelada.', 'success');
    triggerSyncSoon();
  } catch (error) {
    setOpenTabsStatus(error instanceof Error ? error.message : 'Error cancelando tab.', 'error');
  } finally {
    state.openTabsBusy = false;
    bumpOpenTabsVersion();
    render();
  }
}

const handleAppInput = (event: Event): void => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target) return;
  const id = target.id;

  if (id === 'input-received') {
    state.receivedInput = target.value.replace(/\D/g, '');
    state.enterConfirmArmedAt = null;
    bumpCartVersion();
    queueRender('input-received');
    return;
  }
  if (id === 'binding-search-input') {
    state.barcodeBindingSearch = target.value;
    state.barcodeBindingStatusMessage = 'Selecciona un producto y escanea una etiqueta.';
    state.barcodeBindingStatusKind = 'info';
    bumpCatalogVersion();
    queueRender('binding-search');
    return;
  }
  if (id === 'open-tabs-prefix') {
    state.openTabsGeneratePrefixInput = target.value;
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'open-tabs-count') {
    state.openTabsGenerateCountInput = target.value.replace(/\D/g, '');
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'open-tabs-start-at') {
    state.openTabsGenerateStartAtInput = target.value.replace(/\D/g, '');
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'open-tabs-qty') {
    state.openTabsQtyInput = target.value.replace(/\D/g, '');
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'open-tabs-notes') {
    state.openTabsNotesInput = target.value;
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'tables-generate-prefix') {
    state.tablesSettingsGeneratePrefix = target.value;
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'tables-generate-count') {
    state.tablesSettingsGenerateCount = target.value.replace(/\D/g, '');
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'tables-generate-start-at') {
    state.tablesSettingsGenerateStartAt = target.value.replace(/\D/g, '');
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'tables-generate-confirm') {
    state.tablesSettingsConfirmText = target.value;
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'printer-debug-custom-text') {
    state.printerDebugCustomText = target.value;
    bumpPrinterVersion();
    return;
  }
  if (id === 'activation-tenant-slug') {
    state.activation.tenantSlugInput = target.value;
    bumpActivationVersion();
    return;
  }
  if (id === 'activation-claim-code') {
    state.activation.claimCodeInput = target.value.toUpperCase();
    bumpActivationVersion();
    return;
  }
  if (id === 'pos-login-pin') {
    state.auth.pinInput = target.value.replace(/\s+/g, '');
    bumpAuthVersion();
    return;
  }

  const runtime = ensureRuntimeConfigMutable();
  if (!state.printConfig) state.printConfig = { linuxPrinterDevicePath: '/dev/pos58', windowsPrinterShare: '' };
  if (id === 'settings-linux-printer-device-path' || id === 'printer-debug-device-path') {
    state.printConfig.linuxPrinterDevicePath = target.value;
    bumpPrinterVersion();
  }
  else if (id === 'settings-windows-printer' || id === 'printer-debug-windows-printer') {
    state.printConfig.windowsPrinterShare = target.value;
    bumpPrinterVersion();
  }
  else if (id === 'settings-scanner-min-len') {
    runtime.scannerMinCodeLen = Number.parseInt(target.value, 10) || null;
    bumpRuntimeVersion();
  }
  else if (id === 'settings-scanner-max-len') {
    runtime.scannerMaxCodeLen = Number.parseInt(target.value, 10) || null;
    bumpRuntimeVersion();
  }
  else if (id === 'settings-scanner-max-interkey') {
    runtime.scannerMaxInterKeyMsScan = Number.parseInt(target.value, 10) || null;
    bumpRuntimeVersion();
  }
  else if (id === 'settings-scanner-end-gap') {
    runtime.scannerScanEndGapMs = Number.parseInt(target.value, 10) || null;
    bumpRuntimeVersion();
  }
  else if (id === 'settings-scanner-human-gap') {
    runtime.scannerHumanKeyGapMs = Number.parseInt(target.value, 10) || null;
    bumpRuntimeVersion();
  }
  else if (id === 'settings-pos-session-timeout') {
    runtime.posSessionTimeoutMinutes = Number.parseInt(target.value, 10) || null;
    bumpRuntimeVersion();
  }
  else if (id === 'settings-scanner-allowed-pattern') {
    runtime.scannerAllowedCharsPattern = target.value || null;
    bumpRuntimeVersion();
  }
};

const handleAppChange = (event: Event): void => {
  const target = event.target as HTMLSelectElement | HTMLInputElement | null;
  if (!target) return;
  const id = target.id;
  if (id === 'open-tabs-product') {
    state.openTabsSelectedProductId = target.value;
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'open-tabs-payment') {
    state.openTabsPaymentMethod = target.value === 'tarjeta' ? 'tarjeta' : 'efectivo';
    bumpOpenTabsVersion();
    return;
  }
  if (id === 'pos-login-user') {
    state.auth.selectedUserId = target.value;
    bumpAuthVersion();
    return;
  }
  if (id === 'settings-scanner-enter-terminator') {
    ensureRuntimeConfigMutable().scannerAllowEnterTerminator = target.value === '1';
    bumpRuntimeVersion();
    return;
  }
  if (id === 'device-touch-screen-enabled' && target instanceof HTMLInputElement) {
    const runtime = ensureRuntimeConfigMutable();
    runtime.touchScreenEnabled = target.checked;
    if (!runtime.touchScreenEnabled) {
      state.checkoutNumpadOpen = false;
      bumpCartVersion();
    }
    bumpRuntimeVersion();
    queueRender('device-touch-screen-enabled');
    void saveTouchScreenSetting();
    return;
  }
  if (id === 'printer-debug-include-footer' && target instanceof HTMLInputElement) {
    state.printerDebugIncludeFooter = target.checked;
    bumpPrinterVersion();
  }
};

const handleAppKeydown = async (event: Event): Promise<void> => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const paymentMethodBtn = target.closest('.payment-method-btn') as HTMLElement | null;
  if (paymentMethodBtn && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.repeat) {
    event.preventDefault();
    const next = event.key === 'ArrowLeft' ? 'efectivo' : 'tarjeta';
    setCheckoutPaymentMethod(next);
    requestAnimationFrame(() => {
      const nextBtn = document.querySelector(
        `.payment-method-btn[data-value="${next}"]`,
      ) as HTMLButtonElement | null;
      nextBtn?.focus();
    });
    return;
  }
  if (target.id === 'pos-login-pin' && event.key === 'Enter' && !event.repeat) {
    event.preventDefault();
    await loginPosUser();
    return;
  }
  if (target.id !== 'input-received') return;
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
};

const handleAppClick = async (event: Event): Promise<void> => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const actionEl = target.closest('[data-action]') as HTMLElement | null;
  if (!actionEl) return;
  const toolsMenu = actionEl.closest('.tools-menu') as HTMLDetailsElement | null;
  if (toolsMenu) {
    toolsMenu.open = false;
  }

  const action = actionEl.dataset.action || '';

  if ((state.activation.required || state.activation.blocked) && action !== 'activate-device-claim') {
    return;
  }
  if (hasActivePosSession() && action !== 'pos-logout') {
    void touchPosSessionActivity();
  }

  const handledByActionMap = await dispatchAction(event, ({ actionKey, id, actionElement }) => ({
    state,
    event,
    actionKey,
    id,
    target: actionElement,
    invalidate: (region) => renderScheduler.invalidate(region),
    invalidateMany: (regions) => renderScheduler.invalidateMany(regions),
    queueRender,
    posKiosk: window.posKiosk,
    posScanner: window.posScanner,
    handlers: {
      activateDeviceClaimFlow,
      loginPosUser,
      logoutPosUser,
      toggleRenderMetrics: () => {
        renderRuntime.metricsEnabled = !renderRuntime.metricsEnabled;
        setStatus(`Metricas de render ${renderRuntime.metricsEnabled ? 'activadas' : 'desactivadas'}.`, 'info');
      },
      activateTableMode,
      deactivateTableMode,
      openTablesSettings,
      closeTablesSettings,
      previewTablesGeneration,
      confirmTablesGeneration,
      saveTableName,
      toggleTableActive,
      deleteTableWithGuardrail,
      reorderTable,
      tableSelectMesa: () => {
        if (!state.tableModeEnabled) return;
        state.tableSelectorOpen = true;
        state.tableSelectorSelectedTableId =
          state.openTabsSelectedTableId || state.openTabsSnapshot.tables[0]?.id || '';
        bumpOpenTabsVersion();
        render();
      },
      tableSelectOption: (tableId: string) => {
        state.tableSelectorSelectedTableId = tableId;
        bumpOpenTabsVersion();
        render();
      },
      confirmTableSelection,
      tableCancelSelect: () => {
        state.tableSelectorOpen = false;
        bumpOpenTabsVersion();
        if (!state.openTabsSelectedTabId && state.tableModeEnabled) {
          deactivateTableMode();
        } else {
          render();
        }
      },
      tableRefreshDetail: async () => {
        if (state.openTabsSelectedTabId) {
          await openTabKitchenHistory(state.openTabsSelectedTabId);
        }
      },
      addItemToSelectedTab,
      adjustQty,
      confirmSale,
      openOpenTabsModal,
      closeOpenTabsModal,
      configureOpenTabsTables,
      openTabsSelectTable: (tableId: string) => {
        state.openTabsSelectedTableId = tableId;
        bumpOpenTabsVersion();
        render();
      },
      openTabForSelectedTable,
      openTabsSelectTab: async (tabId: string) => {
        state.openTabsSelectedTabId = tabId;
        state.openTabsShowSentLines = false;
        state.openTabsLoading = true;
        bumpOpenTabsVersion();
        render();
        try {
          await refreshOpenTabsDetail(tabId);
        } catch (error) {
          setOpenTabsStatus(error instanceof Error ? error.message : 'No se pudo cargar detalle tab.', 'error');
        } finally {
          state.openTabsLoading = false;
          bumpOpenTabsVersion();
          render();
        }
      },
      toggleOpenTabsSentLines: () => {
        if (!state.tableModeEnabled) return;
        state.openTabsShowSentLines = !state.openTabsShowSentLines;
        bumpOpenTabsVersion();
        render();
      },
      openTabsLineDec: async (lineId: string) => {
        const line = state.openTabsDetail?.lines.find((row) => row.id === lineId);
        if (line && line.qty > 1) await updateTabLine(lineId, line.qty - 1);
      },
      openTabsLineInc: async (lineId: string) => {
        const line = state.openTabsDetail?.lines.find((row) => row.id === lineId);
        if (line) await updateTabLine(lineId, line.qty + 1);
      },
      removeTabLine,
      sendSelectedTabToKitchen,
      closeSelectedTabPaid,
      cancelSelectedTab,
      openBarcodeBinding,
      closeBarcodeBinding,
      openDeviceBinding,
      closeDeviceBinding,
      resetDeviceBinding,
      saveTouchScreenSetting,
      bindingFilterCategory: (categoryId: string) => {
        state.barcodeBindingCategoryId = categoryId;
        bumpCatalogVersion();
        render();
      },
      bindingSelectItem: (itemId: string) => {
        state.barcodeBindingSelectedItemId = itemId;
        state.barcodeBindingStatusMessage = 'Producto listo. Escanea la etiqueta para guardarla.';
        state.barcodeBindingStatusKind = 'info';
        bumpCatalogVersion();
        void applyScanContext();
        render();
      },
      syncCatalog,
      openSettings,
      openScannerDebug,
      closeScannerDebug,
      refreshScannerDebugState,
      copyScannerLogs,
      saveScannerDebugSettings,
      openPrinterDebug,
      closePrinterDebug,
      refreshPrinterDiagnostics,
      savePrinterDebugConfig,
      refreshPrintJobs,
      printTest,
      printerSelfTest,
      printerPrintCustomText,
      copyPrinterDebugLogs,
      openOrderHistory,
      closeOrderHistory,
      openTabKitchenHistory,
      closeTabKitchenHistory,
      reprintTabKitchenRound,
      cancelTabKitchenRound,
      refreshOrderHistory,
      reprintOrderFromHistory,
      cancelOrderFromHistory,
      closeSettings,
      saveSettings,
      selectCategory: (categoryId: string) => {
        state.activeCategoryId = categoryId;
        bumpCatalogVersion();
        render();
      },
      addToCart: async (itemId: string) => {
        if (state.tableModeEnabled) {
          await addItemToSelectedTab({ productId: itemId, qty: 1 });
        } else {
          adjustQty(itemId, 1);
        }
      },
      increaseCartQty: (itemId: string) => {
        adjustQty(itemId, 1);
      },
      decreaseCartQty: (itemId: string) => {
        adjustQty(itemId, -1);
      },
      removeItem: (itemId: string) => {
        state.cartQtyByItemId.delete(itemId);
        bumpCartVersion();
        render();
      },
      clearCart: () => {
        clearCart();
        setStatus('Carrito limpiado.');
      },
      openCheckout,
      setCheckoutPaymentMethod,
      checkoutNumpadInput,
      checkoutNumpadBackspace,
      checkoutNumpadClear,
      closeCheckout: () => {
        closeCheckout();
        setStatus('Cobro cancelado.');
      },
      quickAmount: (valueRaw: string | undefined) => {
        const value = Number.parseInt(valueRaw || '0', 10);
        state.receivedInput = Number.isFinite(value) ? String(value) : '';
        bumpCartVersion();
        render();
      },
      exactAmount: () => {
        state.receivedInput = String(Math.ceil(getCurrentSaleTotalCents() / 100));
        bumpCartVersion();
        render();
      },
      toggleTheme: () => {
        toggleTheme();
        render();
      },
      syncOutbox,
    },
    flags: {
      showOpenTabsDebug: SHOW_OPEN_TABS_DEBUG,
    },
  }));
  if (!handledByActionMap) return;
};

function syncScanSensitiveFocus(): void {
  const active = document.activeElement as HTMLElement | null;
  const hasSensitiveFocus = Boolean(active?.closest('[data-scan-capture="off"]'));
  const next = hasSensitiveFocus ? 1 : 0;
  if (state.scanCaptureSensitiveFocusCount === next) return;
  state.scanCaptureSensitiveFocusCount = next;
  bumpScannerVersion();
  void applyScanContext();
}

const handleDocumentFocusIn = (): void => {
  syncScanSensitiveFocus();
};

const handleDocumentFocusOut = (): void => {
  setTimeoutTracked(() => {
    syncScanSensitiveFocus();
  }, 0, 'scan-sensitive-focusout');
};

const handleDocumentKeydown = (event: KeyboardEvent): void => {
  if (event.ctrlKey && event.altKey && !event.shiftKey && event.code === 'KeyD') {
    event.preventDefault();
    if (state.scannerDebugOpen) {
      closeScannerDebug();
    } else {
      void openScannerDebug();
    }
  }
};

function bindDomEventListeners(): void {
  app.addEventListener('input', handleAppInput);
  registerCleanup(() => app.removeEventListener('input', handleAppInput));

  app.addEventListener('change', handleAppChange);
  registerCleanup(() => app.removeEventListener('change', handleAppChange));

  app.addEventListener('keydown', handleAppKeydown);
  registerCleanup(() => app.removeEventListener('keydown', handleAppKeydown));

  app.addEventListener('click', handleAppClick);
  registerCleanup(() => app.removeEventListener('click', handleAppClick));

  document.addEventListener('focusin', handleDocumentFocusIn);
  registerCleanup(() => document.removeEventListener('focusin', handleDocumentFocusIn));

  document.addEventListener('focusout', handleDocumentFocusOut);
  registerCleanup(() => document.removeEventListener('focusout', handleDocumentFocusOut));

  document.addEventListener('keydown', handleDocumentKeydown);
  registerCleanup(() => document.removeEventListener('keydown', handleDocumentKeydown));
}

async function bootstrap(): Promise<void> {
  disposeAll();
  bootSession += 1;
  const activeSession = bootSession;
  let disposed = false;
  registerCleanup(() => {
    disposed = true;
  });

  if (renderRuntime.frameId !== null) {
    cancelAnimationFrame(renderRuntime.frameId);
    renderRuntime.frameId = null;
    renderRuntime.scheduled = false;
  }
  registerCleanup(() => {
    if (renderRuntime.frameId === null) return;
    cancelAnimationFrame(renderRuntime.frameId);
    renderRuntime.frameId = null;
    renderRuntime.scheduled = false;
  });

  if (printStatusPollTimer !== null) {
    clearTrackedTimeout(printStatusPollTimer);
    printStatusPollTimer = null;
  }
  registerCleanup(() => {
    if (printStatusPollTimer === null) return;
    clearTrackedTimeout(printStatusPollTimer);
    printStatusPollTimer = null;
  });

  bindDomEventListeners();

  const unsubscribeScan = window.posScanner.onScan((reading) => {
    if (disposed || activeSession !== bootSession) return;
    void handleScanReading(reading);
  });
  registerCleanup(unsubscribeScan);

  const unsubscribeOutbox = window.posKiosk.onOutboxStatus((status) => {
    if (disposed || activeSession !== bootSession) return;
    state.syncPendingLegacy = status.pendingLegacy;
    state.syncPendingTabs = status.pendingTabs;
    state.syncPendingTotal = status.pendingTotal;
    state.autoSync.pendingTotal = status.pendingTotal;
    state.autoSync.phase = status.phase || state.autoSync.phase;
    state.autoSync.lastOkAt = typeof status.lastOkAt !== 'undefined' ? status.lastOkAt || null : state.autoSync.lastOkAt;
    state.autoSync.lastErrorShort = status.lastErrorShort || '';
    bumpSyncVersion();
    if (isDeviceInactiveError(status.lastErrorShort)) {
      lockAppForDeviceRevoked('Dispositivo revocado o deshabilitado. Operacion bloqueada.');
    }
    queueRender('sync-status-push');
  });
  registerCleanup(unsubscribeOutbox);

  const heartbeatId = setIntervalTracked(() => {
    if (disposed || activeSession !== bootSession) return;
    void refreshPosSessionFromMain()
      .then(() => applyScanContext())
      .then(() => queueRender('session-heartbeat'))
      .catch(() => undefined);
  }, 30000, 'session-heartbeat');
  registerCleanup(() => clearTrackedInterval(heartbeatId));

  state.busy = true;
  bumpUiVersion();
  render();

  try {
    await loadSettingsData();
    await refreshPosSessionFromMain();
    state.activation.tenantSlugInput = state.runtimeConfig?.tenantSlug || '';
    bumpActivationVersion();
    await refreshDeviceActivationState();

    if (!hasIdentityConfig(state.runtimeConfig) || state.activation.required || state.activation.blocked) {
      if (state.activation.required) {
        setStatus('Dispositivo sin activar. Ingresa Tenant Slug y Claim Code.', 'info');
      }
      return;
    }

    await loadCatalogFromLocal();
    await refreshPosUsersFromCatalog();
    await refreshPrintStatusFromJobs(false);
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
    bumpUiVersion();
    render();
  }
}

bootstrap().catch((error) => {
  setStatus(error instanceof Error ? error.message : 'Error inicializando kiosk.', 'error');
});
