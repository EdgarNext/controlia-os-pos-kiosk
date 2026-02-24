import './index.css';
import type { CatalogCategory, CatalogItem, CatalogSnapshot } from './shared/catalog';
import type { OrderHistoryRecord, RuntimeConfig } from './shared/orders';
import type { PrintConfig, PrintJobRecord } from './shared/print-v2';
import type { ScannerReading } from './shared/scanner';
import type { OpenTabsSnapshot, TabDetailView } from './shared/open-tabs';

interface CartLine {
  item: CatalogItem;
  qty: number;
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
  scannerReading: null as ScannerReading | null,
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
  syncAutoTimer: null as ReturnType<typeof setTimeout> | null,
  syncAutoBackoffMs: 15000,
  syncInFlight: false,
};

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

function setStatus(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  state.status = message;
  state.statusKind = kind;
  render();
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
  const items = getItems();
  if (!state.activeCategoryId) return items;
  return items.filter((row) => row.categoryId === state.activeCategoryId);
}

function getBarcodeBindingItems(): CatalogItem[] {
  const categoryId = state.barcodeBindingCategoryId;
  const search = state.barcodeBindingSearch.trim().toLowerCase();

  return getItems().filter((item) => {
    const categoryMatch = !categoryId || item.categoryId === categoryId;
    const searchMatch =
      !search ||
      item.name.toLowerCase().includes(search) ||
      (item.barcode || '').toLowerCase().includes(search);
    return categoryMatch && searchMatch;
  });
}

function getCartLines(): CartLine[] {
  const byId = new Map(getItems().map((item) => [item.id, item]));
  const lines: CartLine[] = [];
  state.cartQtyByItemId.forEach((qty, itemId) => {
    const item = byId.get(itemId);
    if (item && qty > 0) lines.push({ item, qty });
  });
  return lines.sort((a, b) => a.item.name.localeCompare(b.item.name));
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
  render();
}

function closeCheckout(): void {
  if (state.busy) return;
  state.checkoutOpen = false;
  state.receivedInput = '';
  state.enterConfirmArmedAt = null;
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

function render(): void {
  const activeElement = document.activeElement as HTMLElement | null;
  const shouldRefocusReceivedInput = activeElement?.id === 'input-received';
  const prevSelectionStart =
    shouldRefocusReceivedInput && activeElement instanceof HTMLInputElement
      ? activeElement.selectionStart
      : null;
  const prevSelectionEnd =
    shouldRefocusReceivedInput && activeElement instanceof HTMLInputElement
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

  const statusClass = state.statusKind === 'error' ? 'error' : state.statusKind === 'success' ? 'success' : '';
  const scannerValue = state.scannerReading?.code || 'Esperando lectura...';
  const scannerTimestamp = state.scannerReading?.receivedAt
    ? `Ultimo escaneo: ${formatDate(state.scannerReading.receivedAt)}`
    : 'Escanea un codigo para validar conectividad.';
  const scannerClass = state.scannerReading ? 'has-reading' : '';
  const syncIndicator = `Sync: pendientes ${state.syncPendingTotal} (legacy ${state.syncPendingLegacy} | tabs ${state.syncPendingTabs}) · ultimo ${formatDate(
    state.syncLastAt,
  )}${state.syncLastError ? ` · error: ${state.syncLastError}` : ''}`;
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
                <input id="binding-search-input" class="input barcode-search-input" value="${escapeHtml(state.barcodeBindingSearch)}" placeholder="Ej: Coca o 75010..." />
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
          <input id="input-received" class="input" inputmode="numeric" value="${escapeHtml(state.receivedInput)}" placeholder="0" ${
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
  const runtime = state.runtimeConfig || {
    tenantId: '',
    kioskId: '',
    kioskNumber: null,
    tenantSlug: '',
    deviceId: '',
    deviceSecret: '',
  };

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
                <input id="open-tabs-notes" class="input" value="${escapeHtml(state.openTabsNotesInput)}" />
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

  app.innerHTML = `
    <main class="kiosk-shell">
      <header class="topbar">
        <div>
          <h1>Kiosk POS</h1>
          <p>Ultima sync catalogo: ${formatDate(state.snapshot?.lastSyncedAt)}</p>
          <p>${escapeHtml(syncIndicator)}</p>
        </div>
        <div class="topbar-right">
          <div class="topbar-actions">
            <button class="button secondary" data-action="open-barcode-binding" ${state.busy ? 'disabled' : ''}>Vincular etiquetas</button>
            <button class="button secondary" data-action="open-settings" ${state.busy ? 'disabled' : ''}>Ajustes impresora</button>
            <button class="button secondary" data-action="open-order-history" ${
              state.busy || hasSaleInProgress() ? 'disabled' : ''
            }>Historial del dia</button>
            <button class="button secondary" data-action="toggle-table-mode" ${state.busy ? 'disabled' : ''}>
              ${state.tableModeEnabled ? 'Modo mesa: ON' : 'Modo mesa: OFF'}
            </button>
            <button class="button secondary" data-action="sync-outbox" ${state.syncInFlight ? 'disabled' : ''}>
              ${state.syncInFlight ? 'Sincronizando ordenes...' : 'Sincronizar ordenes'}
            </button>
            <button class="button secondary" data-action="sync-catalog" ${state.busy ? 'disabled' : ''}>Sincronizar catalogo</button>
          </div>
          <div class="scanner-pill ${scannerClass}">
            <div class="scanner-pill-head">
              <span class="scanner-dot" aria-hidden="true"></span>
              <span class="scanner-label">Scanner</span>
            </div>
            <div class="scanner-code">${escapeHtml(scannerValue)}</div>
            <div class="scanner-meta">${escapeHtml(scannerTimestamp)}</div>
          </div>
        </div>
      </header>

      <div class="status ${statusClass}">${escapeHtml(state.status)}</div>

      <section class="layout">
        <aside class="panel categories">
          <h2>Categorias</h2>
          <div class="stack">${categoryHtml}</div>
        </aside>

        <section class="panel products">
          <h2>Productos</h2>
          <div class="products-grid">${productsHtml}</div>
        </section>

        <aside class="panel cart">
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
        </aside>
      </section>

      ${checkoutHtml}
      ${settingsHtml}
      ${barcodeBindingHtml}
      ${historyHtml}
      ${tabKitchenHistoryHtml}
      ${SHOW_OPEN_TABS_DEBUG ? openTabsHtml : ''}
      ${renderTableSelectorModal()}
      ${renderTablesSettingsModal()}
    </main>
  `;

  const inputReceived = document.getElementById('input-received') as HTMLInputElement | null;
  const checkoutPaymentMethod = document.getElementById('checkout-payment-method') as HTMLSelectElement | null;
  if (checkoutPaymentMethod) {
    checkoutPaymentMethod.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      state.checkoutPaymentMethod = value === 'tarjeta' ? 'tarjeta' : 'efectivo';
      if (state.checkoutPaymentMethod === 'tarjeta') {
        state.receivedInput = '';
      }
      render();
    });
  }

  if (inputReceived) {
    inputReceived.addEventListener('input', (event) => {
      state.receivedInput = (event.target as HTMLInputElement).value.replace(/\D/g, '');
      state.enterConfirmArmedAt = null;
      render();
    });

    inputReceived.addEventListener('keydown', async (event) => {
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

    if (shouldRefocusReceivedInput) {
      inputReceived.focus();
      if (prevSelectionStart !== null && prevSelectionEnd !== null) {
        inputReceived.setSelectionRange(prevSelectionStart, prevSelectionEnd);
      }
    }
  }

  attachSettingsInputs();
  attachBarcodeBindingInputs();
  attachOpenTabsInputs();
  attachTablesSettingsInputs();
}

function attachSettingsInputs(): void {
  const settingsLinuxInput = document.getElementById('settings-linux-printer') as HTMLInputElement | null;
  if (settingsLinuxInput) {
    settingsLinuxInput.addEventListener('input', (event) => {
      if (!state.printConfig) state.printConfig = { linuxPrinterName: '', windowsPrinterShare: '' };
      state.printConfig.linuxPrinterName = (event.target as HTMLInputElement).value;
    });
  }

  const settingsWindowsInput = document.getElementById('settings-windows-printer') as HTMLInputElement | null;
  if (settingsWindowsInput) {
    settingsWindowsInput.addEventListener('input', (event) => {
      if (!state.printConfig) state.printConfig = { linuxPrinterName: '', windowsPrinterShare: '' };
      state.printConfig.windowsPrinterShare = (event.target as HTMLInputElement).value;
    });
  }

  const tenantSlugInput = document.getElementById('settings-tenant-slug') as HTMLInputElement | null;
  if (tenantSlugInput) {
    tenantSlugInput.addEventListener('input', (event) => {
      if (!state.runtimeConfig) {
        state.runtimeConfig = {
          tenantId: null,
          kioskId: null,
          kioskNumber: null,
          tenantSlug: null,
          deviceId: null,
          deviceSecret: null,
        };
      }
      state.runtimeConfig.tenantSlug = (event.target as HTMLInputElement).value || null;
    });
  }

  const deviceIdInput = document.getElementById('settings-device-id') as HTMLInputElement | null;
  if (deviceIdInput) {
    deviceIdInput.addEventListener('input', (event) => {
      if (!state.runtimeConfig) {
        state.runtimeConfig = {
          tenantId: null,
          kioskId: null,
          kioskNumber: null,
          tenantSlug: null,
          deviceId: null,
          deviceSecret: null,
        };
      }
      state.runtimeConfig.deviceId = (event.target as HTMLInputElement).value || null;
    });
  }

  const deviceSecretInput = document.getElementById('settings-device-secret') as HTMLInputElement | null;
  if (deviceSecretInput) {
    deviceSecretInput.addEventListener('input', (event) => {
      if (!state.runtimeConfig) {
        state.runtimeConfig = {
          tenantId: null,
          kioskId: null,
          kioskNumber: null,
          tenantSlug: null,
          deviceId: null,
          deviceSecret: null,
        };
      }
      state.runtimeConfig.deviceSecret = (event.target as HTMLInputElement).value || null;
    });
  }

  const tenantInput = document.getElementById('settings-tenant-id') as HTMLInputElement | null;
  if (tenantInput) {
    tenantInput.addEventListener('input', (event) => {
      if (!state.runtimeConfig) {
        state.runtimeConfig = {
          tenantId: null,
          kioskId: null,
          kioskNumber: null,
          tenantSlug: null,
          deviceId: null,
          deviceSecret: null,
        };
      }
      state.runtimeConfig.tenantId = (event.target as HTMLInputElement).value || null;
    });
  }

  const kioskIdInput = document.getElementById('settings-kiosk-id') as HTMLInputElement | null;
  if (kioskIdInput) {
    kioskIdInput.addEventListener('input', (event) => {
      if (!state.runtimeConfig) {
        state.runtimeConfig = {
          tenantId: null,
          kioskId: null,
          kioskNumber: null,
          tenantSlug: null,
          deviceId: null,
          deviceSecret: null,
        };
      }
      state.runtimeConfig.kioskId = (event.target as HTMLInputElement).value || null;
    });
  }

  const kioskNumberInput = document.getElementById('settings-kiosk-number') as HTMLInputElement | null;
  if (kioskNumberInput) {
    kioskNumberInput.addEventListener('input', (event) => {
      const value = Number.parseInt((event.target as HTMLInputElement).value.replace(/\D/g, ''), 10);
      if (!state.runtimeConfig) {
        state.runtimeConfig = {
          tenantId: null,
          kioskId: null,
          kioskNumber: null,
          tenantSlug: null,
          deviceId: null,
          deviceSecret: null,
        };
      }
      state.runtimeConfig.kioskNumber = Number.isFinite(value) ? value : null;
    });
  }
}

function openBarcodeBinding(): void {
  state.barcodeBindingOpen = true;
  state.barcodeBindingStatusMessage = 'Selecciona un producto y escanea una etiqueta.';
  state.barcodeBindingStatusKind = 'info';
  ensureBarcodeBindingCategory();
  ensureBarcodeBindingSelection(getBarcodeBindingItems());
  render();
}

function closeBarcodeBinding(): void {
  if (state.barcodeBindingBusy) return;
  state.barcodeBindingOpen = false;
  render();
}

function attachBarcodeBindingInputs(): void {
  const searchInput = document.getElementById('binding-search-input') as HTMLInputElement | null;
  if (!searchInput) return;
  searchInput.addEventListener('input', (event) => {
    state.barcodeBindingSearch = (event.target as HTMLInputElement).value;
    state.barcodeBindingStatusMessage = 'Selecciona un producto y escanea una etiqueta.';
    state.barcodeBindingStatusKind = 'info';
    render();
  });
}

function attachOpenTabsInputs(): void {
  const prefixInput = document.getElementById('open-tabs-prefix') as HTMLInputElement | null;
  if (prefixInput) {
    prefixInput.addEventListener('input', (event) => {
      state.openTabsGeneratePrefixInput = (event.target as HTMLInputElement).value;
    });
  }

  const countInput = document.getElementById('open-tabs-count') as HTMLInputElement | null;
  if (countInput) {
    countInput.addEventListener('input', (event) => {
      state.openTabsGenerateCountInput = (event.target as HTMLInputElement).value.replace(/\\D/g, '');
    });
  }

  const startAtInput = document.getElementById('open-tabs-start-at') as HTMLInputElement | null;
  if (startAtInput) {
    startAtInput.addEventListener('input', (event) => {
      state.openTabsGenerateStartAtInput = (event.target as HTMLInputElement).value.replace(/\\D/g, '');
    });
  }

  const productInput = document.getElementById('open-tabs-product') as HTMLSelectElement | null;
  if (productInput) {
    productInput.addEventListener('change', (event) => {
      state.openTabsSelectedProductId = (event.target as HTMLSelectElement).value;
    });
  }

  const qtyInput = document.getElementById('open-tabs-qty') as HTMLInputElement | null;
  if (qtyInput) {
    qtyInput.addEventListener('input', (event) => {
      state.openTabsQtyInput = (event.target as HTMLInputElement).value.replace(/\\D/g, '');
    });
  }

  const notesInput = document.getElementById('open-tabs-notes') as HTMLInputElement | null;
  if (notesInput) {
    notesInput.addEventListener('input', (event) => {
      state.openTabsNotesInput = (event.target as HTMLInputElement).value;
    });
  }

  const paymentInput = document.getElementById('open-tabs-payment') as HTMLSelectElement | null;
  if (paymentInput) {
    paymentInput.addEventListener('change', (event) => {
      const next = (event.target as HTMLSelectElement).value;
      state.openTabsPaymentMethod = next === 'tarjeta' ? 'tarjeta' : 'efectivo';
    });
  }
}

function attachTablesSettingsInputs(): void {
  const prefixInput = document.getElementById('tables-generate-prefix') as HTMLInputElement | null;
  if (prefixInput) {
    prefixInput.addEventListener('input', (event) => {
      state.tablesSettingsGeneratePrefix = (event.target as HTMLInputElement).value;
    });
  }

  const countInput = document.getElementById('tables-generate-count') as HTMLInputElement | null;
  if (countInput) {
    countInput.addEventListener('input', (event) => {
      state.tablesSettingsGenerateCount = (event.target as HTMLInputElement).value.replace(/\D/g, '');
    });
  }

  const startAtInput = document.getElementById('tables-generate-start-at') as HTMLInputElement | null;
  if (startAtInput) {
    startAtInput.addEventListener('input', (event) => {
      state.tablesSettingsGenerateStartAt = (event.target as HTMLInputElement).value.replace(/\D/g, '');
    });
  }

  const confirmInput = document.getElementById('tables-generate-confirm') as HTMLInputElement | null;
  if (confirmInput) {
    confirmInput.addEventListener('input', (event) => {
      state.tablesSettingsConfirmText = (event.target as HTMLInputElement).value;
    });
  }
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
  if (
    state.busy ||
    state.checkoutOpen ||
    state.settingsOpen ||
    state.barcodeBindingOpen ||
    state.ordersHistoryOpen
  )
    return;

  const product = findItemByBarcode(barcodeRaw);
  if (!product) {
    setStatus(`No existe producto con etiqueta: ${barcodeRaw}`, 'error');
    return;
  }

  if (state.tableModeEnabled && state.openTabsSelectedTabId) {
    void addItemToSelectedTab({ productId: product.id, qty: 1 });
    return;
  }

  adjustQty(product.id, 1);
  setStatus(`Escaneado: ${product.name} agregado al carrito.`, 'success');
}

async function loadCatalogFromLocal(): Promise<void> {
  state.snapshot = await window.posKiosk.getCatalog();
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
      state.openTabsSelectedTabId = '';
      await refreshOpenTabsSnapshot(false);
      triggerSyncSoon();

      if (result.printStatus === 'FAILED') {
        setStatus('Cuenta cerrada, pero fallo la impresion final.', 'error');
      } else {
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

    if (result.printStatus === 'FAILED') {
      setStatus(`Venta ${result.folioText || ''} guardada localmente. Error de impresion: ${result.error || 'sin detalle'}.`, 'error');
    } else {
      setStatus(`Venta ${result.folioText || ''} guardada e impresa.`, 'success');
    }
    triggerSyncSoon();
  } catch (error) {
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
  state.settingsPendingAction = 'print-test';
  state.settingsStatusMessage = 'Enviando impresion de prueba...';
  state.settingsStatusKind = 'info';
  render();

  try {
    const result = await window.posKiosk.printV2({ rawBase64: buildTestPrintRawBase64(), jobName: 'test_print_v2' });
    if (!result.ok) throw new Error(result.error || 'No se pudo imprimir prueba.');
    await loadSettingsData();
    state.settingsStatusMessage = `Prueba enviada. Job: ${result.jobId}`;
    state.settingsStatusKind = 'success';
  } catch (error) {
    state.settingsStatusMessage = error instanceof Error ? error.message : 'Error al imprimir prueba.';
    state.settingsStatusKind = 'error';
  } finally {
    state.busy = false;
    state.settingsPendingAction = null;
    render();
  }
}

async function syncOutbox(manual = false): Promise<void> {
  if (state.syncInFlight) return;
  state.syncInFlight = true;
  if (manual) state.busy = true;
  render();

  try {
    const result = await window.posKiosk.syncOutbox();
    state.syncLastAt = result.lastSyncedAt || new Date().toISOString();
    state.syncPendingLegacy = Number.isFinite(result.pendingLegacy) ? Number(result.pendingLegacy) : state.syncPendingLegacy;
    state.syncPendingTabs = Number.isFinite(result.pendingTabs) ? Number(result.pendingTabs) : state.syncPendingTabs;
    state.syncPendingTotal = Number.isFinite(result.pending) ? Number(result.pending) : state.syncPendingTotal;
    state.syncLastError = result.ok ? '' : result.error || 'Sync parcial/fallida.';

    if (!result.ok) {
      setStatus(
        `Sync parcial/fallida. Procesados: ${result.processed}, enviados: ${result.sent}, fallidos: ${result.failed}, pendientes: ${result.pending}. ${result.error || ''}`,
        'error',
      );
      state.syncAutoBackoffMs = Math.min(state.syncAutoBackoffMs * 2, 120000);
    } else {
      setStatus(
        `Sync OK. Procesados: ${result.processed}, enviados: ${result.sent}, pendientes: ${result.pending}.`,
        'success',
      );
      state.syncAutoBackoffMs = 15000;
    }
  } catch (error) {
    state.syncLastError = error instanceof Error ? error.message : 'Error sincronizando outbox.';
    setStatus(state.syncLastError, 'error');
    state.syncAutoBackoffMs = Math.min(state.syncAutoBackoffMs * 2, 120000);
  } finally {
    state.syncInFlight = false;
    if (manual) state.busy = false;
    await refreshSyncStatus();
    scheduleAutoSync();
    render();
  }
}

async function refreshSyncStatus(): Promise<void> {
  try {
    const status = await window.posKiosk.getSyncStatus();
    state.syncPendingLegacy = status.pendingLegacy;
    state.syncPendingTabs = status.pendingTabs;
    state.syncPendingTotal = status.pendingTotal;
  } catch {
    // Ignore status refresh errors to avoid blocking UI.
  }
}

function scheduleAutoSync(): void {
  if (state.syncAutoTimer) {
    clearTimeout(state.syncAutoTimer);
  }
  state.syncAutoTimer = setTimeout(() => {
    void syncOutbox(false);
  }, state.syncAutoBackoffMs);
}

function triggerSyncSoon(): void {
  state.syncAutoBackoffMs = Math.min(state.syncAutoBackoffMs, 2000);
  scheduleAutoSync();
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
  setOpenTabsStatus('Enviando a cocina...', 'info');
  render();
  try {
    const result = await window.posKiosk.sendTabToKitchen({ tabId: state.openTabsSelectedTabId });
    await refreshOpenTabsSnapshot(true);
    if (!result.ok) {
      setOpenTabsStatus(
        `Impresion fallida, pero se registro evento de error para sync. ${result.error || ''}`.trim(),
        'error',
      );
      triggerSyncSoon();
      return;
    }
    setOpenTabsStatus(`Comanda enviada a cocina. Job ${result.jobId || 'n/a'}.`, 'success');
    triggerSyncSoon();
  } catch (error) {
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

app.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const actionEl = target.closest('[data-action]') as HTMLElement | null;
  if (!actionEl) return;

  const action = actionEl.dataset.action || '';
  const id = actionEl.dataset.id || '';

  switch (action) {
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
      render();
      break;
    case 'sync-catalog':
      await syncCatalog();
      break;
    case 'open-settings':
      await openSettings();
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

async function bootstrap(): Promise<void> {
  window.posKiosk.onScannerData((reading) => {
    state.scannerReading = reading;
    if (state.barcodeBindingOpen) {
      void assignBarcodeToSelectedProduct(reading.code);
      return;
    }
    addScannedProductToCart(reading.code);
    render();
  });

  state.busy = true;
  render();

  try {
    await loadCatalogFromLocal();
    await refreshSyncStatus();
    scheduleAutoSync();
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
