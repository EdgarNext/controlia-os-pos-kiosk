import type { ScannerMode } from './scanner';

export interface SaleLineInput {
  catalogItemId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  itemType?: string | null;
}

export interface CreateSaleInput {
  lines: SaleLineInput[];
  pagoRecibidoCents: number;
  metodoPago: 'efectivo' | 'tarjeta' | 'employee' | string;
}

export interface CreateSaleResult {
  ok: boolean;
  orderId?: string;
  folioText?: string;
  totalCents?: number;
  cambioCents?: number;
  printStatus?: 'QUEUED' | 'SENT' | 'FAILED';
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
  phase?: 'idle' | 'syncing' | 'retrying' | 'error' | 'ok';
  lastOkAt?: string | null;
  lastErrorShort?: string;
  autoInFlight?: boolean;
  manualInFlight?: boolean;
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
  kioskDisplayName: string | null;
  tenantSlug: string | null;
  deviceId: string | null;
  deviceSecret: string | null;
  scannerMode: ScannerMode;
  scannerMinCodeLen: number | null;
  scannerMaxCodeLen: number | null;
  scannerMaxInterKeyMsScan: number | null;
  scannerScanEndGapMs: number | null;
  scannerHumanKeyGapMs: number | null;
  scannerAllowEnterTerminator: boolean | null;
  scannerAllowedCharsPattern: string | null;
  touchScreenEnabled: boolean | null;
  employeePaymentsEnabled: boolean | null;
  splitFoodAndDrinksOnTicket: boolean | null;
  posSessionTimeoutMinutes: number | null;
  posSessionUserId: string | null;
  posSessionUserName: string | null;
  posSessionRole: string | null;
  posSessionStartedAt: string | null;
  posSessionLastActivityAt: string | null;
}

export interface PosUserView {
  id: string;
  name: string;
  role: string;
}

export interface PosSessionView {
  userId: string;
  userName: string;
  role: string;
  startedAt: string;
  lastActivityAt: string;
  timeoutMinutes: number;
}

export interface PosLoginResult {
  ok: boolean;
  error?: string;
  session?: PosSessionView;
}

export interface PosLoginInput {
  userId: string;
  pin: string;
}

export interface SupervisorOverrideInput {
  pin: string;
}

export interface SupervisorOverrideResult {
  ok: boolean;
  error?: string;
  supervisor?: PosUserView;
}

export interface DeviceClaimActivateInput {
  tenantSlug: string;
  claimCode: string;
}

export interface DeviceClaimActivateResult {
  ok: boolean;
  error?: string;
  tenantId?: string;
  kioskId?: string;
  kioskNumber?: number;
  kioskDisplayName?: string;
  deviceId?: string;
}

export interface DeviceActivationState {
  state: 'unclaimed' | 'active' | 'revoked';
  message: string;
}

export interface DeviceBindingInfo {
  apiBaseUrl: string;
  runtime: RuntimeConfig;
  hasBinding: boolean;
}

export interface DeviceBindingResetResult {
  ok: boolean;
  error?: string;
}
