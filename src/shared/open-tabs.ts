export type OpenTabStatus = 'OPEN' | 'PAID' | 'CANCELED';

export interface PosTableView {
  id: string;
  name: string;
  eventId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface TabView {
  id: string;
  folioText: string;
  folioNumber: number;
  status: OpenTabStatus;
  posTableId: string | null;
  totalCents: number;
  tabVersionLocal: number;
  kitchenLastPrintedVersion: number;
  kitchenLastPrintAt?: string | null;
  openedAt: string | null;
  updatedAt: string;
}

export interface TabLineView {
  id: string;
  productId: string;
  productName?: string;
  qty: number;
  unitPriceCents: number;
  notes: string | null;
  lineTotalCents: number;
  updatedAt: string;
  kitchenStatus: 'PENDING' | 'SENT';
}

export interface KitchenRoundView {
  mutationId: string;
  printedVersion: number;
  fromVersion: number;
  ok: boolean;
  linesCount: number;
  createdAt: string;
  status: 'PENDING' | 'SENT' | 'ACKED' | 'FAILED' | 'CONFLICT';
  error: string | null;
  canceled: boolean;
  canceledAt: string | null;
  cancelReason: string | null;
}

export interface TabDetailView {
  tab: TabView;
  lines: TabLineView[];
  pendingKitchenCount: number;
  kitchenRounds: KitchenRoundView[];
}

export interface OpenTabsSnapshot {
  tables: PosTableView[];
  tabs: TabView[];
}

export interface ConfigureOpenTabsTablesInput {
  eventId?: string | null;
  tables?: Array<{
    id?: string;
    name: string;
    isActive?: boolean;
    sortOrder?: number;
  }>;
  generate?: {
    count: number;
    prefix?: string;
    startAt?: number;
    isActive?: boolean;
  };
}

export interface ConfigureOpenTabsTablesResult {
  ok: boolean;
  upserted: number;
  generated: number;
  error?: string;
}

export interface OpenTabInput {
  posTableId?: string | null;
}

export interface OpenTabResult {
  ok: boolean;
  tabId?: string;
  mutationId?: string;
  folioText?: string;
  error?: string;
}

export interface AddTabItemInput {
  tabId: string;
  productId: string;
  qty: number;
  notes?: string | null;
}

export interface UpdateTabLineQtyInput {
  tabId: string;
  lineId: string;
  qty: number;
  notes?: string | null;
}

export interface RemoveTabLineInput {
  tabId: string;
  lineId: string;
  reason?: string | null;
}

export interface TabMutationResult {
  ok: boolean;
  mutationId?: string;
  tabVersionLocal?: number;
  error?: string;
}

export interface KitchenSendInput {
  tabId: string;
}

export interface KitchenSendResult {
  ok: boolean;
  printOk: boolean;
  mutationId?: string;
  jobId?: string;
  printedVersion?: number;
  skipped?: boolean;
  error?: string;
}

export interface TabKitchenRoundActionInput {
  tabId: string;
  mutationId: string;
}

export interface TabKitchenRoundCancelInput extends TabKitchenRoundActionInput {
  reason?: string | null;
}

export interface TabKitchenRoundActionResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

export interface CloseTabPaidInput {
  tabId: string;
  metodoPago: 'efectivo' | 'tarjeta';
  pagoRecibidoCents?: number;
}

export interface SyncMutationsResult {
  ok: boolean;
  processed: number;
  acked: number;
  failed: number;
  conflicts: number;
  pending: number;
  forceRefresh: boolean;
  error?: string;
}

export interface TabCloseResult extends TabMutationResult {
  totalCents?: number;
  cambioCents?: number;
  printStatus?: 'SENT' | 'FAILED';
  printJobId?: string;
}

export interface PosTableCrudResult {
  ok: boolean;
  error?: string;
}

export interface UpdatePosTableInput {
  tableId: string;
  name: string;
}

export interface TogglePosTableInput {
  tableId: string;
  isActive: boolean;
}

export interface DeletePosTableInput {
  tableId: string;
}

export interface ReorderPosTableInput {
  tableId: string;
  direction: 'up' | 'down';
}
