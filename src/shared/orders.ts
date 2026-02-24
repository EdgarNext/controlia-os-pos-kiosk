export interface SaleLineInput {
  catalogItemId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
}

export interface CreateSaleInput {
  lines: SaleLineInput[];
  pagoRecibidoCents: number;
  metodoPago: 'efectivo' | string;
}

export interface CreateSaleResult {
  ok: boolean;
  orderId?: string;
  folioText?: string;
  totalCents?: number;
  cambioCents?: number;
  printStatus?: 'SENT' | 'FAILED';
  error?: string;
}

export interface OutboxSyncResult {
  ok: boolean;
  processed: number;
  sent: number;
  failed: number;
  pending: number;
  processedLegacy?: number;
  sentLegacy?: number;
  failedLegacy?: number;
  pendingLegacy?: number;
  processedTabs?: number;
  sentTabs?: number;
  failedTabs?: number;
  conflictsTabs?: number;
  pendingTabs?: number;
  lastSyncedAt?: string;
  error?: string;
}

export interface OutboxSyncStatus {
  pendingLegacy: number;
  pendingTabs: number;
  pendingTotal: number;
}

export type OrderStatus = 'OPEN' | 'PAID' | 'CANCELED';

export interface OrderHistoryRecord {
  id: string;
  createdAt: string;
  folioText: string;
  totalCents: number;
  status: OrderStatus;
  printStatus: 'OPEN' | 'SENT' | 'FAILED' | 'UNKNOWN';
  source?: 'sale' | 'tab';
  canceledAt: string | null;
  cancelReason: string | null;
  printAttempts: number;
  lastPrintAt: string | null;
  lastError: string | null;
}

export interface ReprintOrderResult {
  ok: boolean;
  orderId: string;
  printStatus?: 'SENT' | 'FAILED';
  jobId?: string;
  error?: string;
}

export interface CancelOrderResult {
  ok: boolean;
  orderId: string;
  canceledAt?: string;
  error?: string;
}

export interface RuntimeConfig {
  tenantId: string | null;
  kioskId: string | null;
  kioskNumber: number | null;
  tenantSlug: string | null;
  deviceId: string | null;
  deviceSecret: string | null;
}
