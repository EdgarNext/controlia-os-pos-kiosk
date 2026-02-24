import { fallbackEntityId, stableMutationId } from './mutation-id';
import {
  OutboxRepo,
  type OutboxMutationRecord,
  type OutboxMutationType,
} from '../../outboxRepo';
import { PosTablesRepo, type UpsertPosTableInput } from '../../posTablesRepo';
import { TabLinesRepo, type TabLineLocal } from '../../tabLinesRepo';
import { TabsRepo, type TabLocal } from '../../tabsRepo';

export interface SalesPosServiceDeps {
  posTablesRepo: PosTablesRepo;
  tabsRepo: TabsRepo;
  tabLinesRepo: TabLinesRepo;
  outboxRepo: OutboxRepo;
}

export interface SalesPosServiceFactoryInput {
  userDataPath: string;
}

export interface MutationResult {
  mutationId: string;
  tabId: string;
  mutationType: OutboxMutationType;
  status: 'APPLIED' | 'DUPLICATE';
  baseTabVersion: number | null;
  tabVersionLocal: number;
}

export interface ConfigureTablesInput {
  tenantId: string;
  eventId?: string | null;
  createdBy?: string | null;
  tables?: Array<{
    id?: string;
    name: string;
    isActive?: boolean;
    sortOrder?: number;
    deletedAt?: string | null;
  }>;
  generate?: {
    count: number;
    prefix?: string;
    startAt?: number;
    isActive?: boolean;
  };
}

export interface OpenTabInput {
  tenantId: string;
  tabId?: string;
  kioskId: string;
  folioNumber: number;
  folioText: string;
  posTableId?: string | null;
  posTableLabel?: string | null;
  openedAt?: string | null;
  totalCents?: number;
  createdAt?: string | null;
  operationKey?: string | null;
  mutationId?: string;
  meta?: Record<string, unknown> | null;
}

export interface AddItemInput {
  tenantId: string;
  tabId: string;
  kioskId: string;
  lineId?: string;
  productId: string;
  productName?: string | null;
  qty: number;
  unitPriceCents: number;
  notes?: string | null;
  createdAt?: string | null;
  operationKey?: string | null;
  mutationId?: string;
  meta?: Record<string, unknown> | null;
}

export interface UpdateQtyInput {
  tenantId: string;
  tabId: string;
  kioskId: string;
  lineId: string;
  qty: number;
  notes?: string | null;
  createdAt?: string | null;
  operationKey?: string | null;
  mutationId?: string;
  meta?: Record<string, unknown> | null;
}

export interface RemoveItemInput {
  tenantId: string;
  tabId: string;
  kioskId: string;
  lineId: string;
  reason?: string | null;
  createdAt?: string | null;
  operationKey?: string | null;
  mutationId?: string;
  meta?: Record<string, unknown> | null;
}

export interface KitchenPrintInput {
  tenantId: string;
  tabId: string;
  kioskId: string;
  ok?: boolean;
  error?: string | null;
  createdAt?: string | null;
  operationKey?: string | null;
  mutationId?: string;
  meta?: Record<string, unknown> | null;
}

export interface KitchenPrintResult extends MutationResult {
  skipped: boolean;
  printedVersion: number;
  fromVersion: number;
  round: {
    lines: Array<{
      line_id: string;
      product_id: string;
      qty: number;
      unit_price_cents: number;
      notes: string | null;
    }>;
  };
}

export interface CloseTabPaidInput {
  tenantId: string;
  tabId: string;
  kioskId: string;
  closedAt?: string | null;
  totalCents?: number;
  createdAt?: string | null;
  operationKey?: string | null;
  mutationId?: string;
  meta?: Record<string, unknown> | null;
}

export interface CancelTabInput {
  tenantId: string;
  tabId: string;
  kioskId: string;
  canceledAt?: string | null;
  cancelReason?: string | null;
  createdAt?: string | null;
  operationKey?: string | null;
  mutationId?: string;
  meta?: Record<string, unknown> | null;
}

export class SalesPosDomainService {
  private readonly deps: SalesPosServiceDeps;

  constructor(deps: SalesPosServiceDeps) {
    this.deps = deps;
  }

  static fromUserDataPath(input: SalesPosServiceFactoryInput): SalesPosDomainService {
    return new SalesPosDomainService({
      posTablesRepo: new PosTablesRepo(input.userDataPath),
      tabsRepo: new TabsRepo(input.userDataPath),
      tabLinesRepo: new TabLinesRepo(input.userDataPath),
      outboxRepo: new OutboxRepo(input.userDataPath),
    });
  }

  configureTables(input: ConfigureTablesInput): { upserted: number; generated: number } {
    const tenantId = ensureNonEmpty(input.tenantId, 'tenantId');
    const explicitTables = input.tables || [];
    const generatedTables = this.generateTables(input);

    const rows: UpsertPosTableInput[] = [...explicitTables, ...generatedTables].map((table, index) => {
      const name = ensureNonEmpty(table.name, 'table.name');
      return {
        id: table.id || stableEntityId(tenantId, input.eventId ?? null, name),
        tenantId,
        eventId: input.eventId ?? null,
        name,
        isActive: table.isActive !== false,
        sortOrder: Number.isInteger(table.sortOrder) ? Number(table.sortOrder) : index,
        createdBy: input.createdBy ?? null,
        deletedAt: table.deletedAt ?? null,
      };
    });

    if (rows.length > 0) {
      this.deps.posTablesRepo.upsertMany(rows);
    }

    return {
      upserted: rows.length,
      generated: generatedTables.length,
    };
  }

  openTab(input: OpenTabInput): MutationResult {
    const tenantId = ensureNonEmpty(input.tenantId, 'tenantId');
    const kioskId = ensureNonEmpty(input.kioskId, 'kioskId');
    const tabId = input.tabId || fallbackEntityId();
    const createdAt = normalizeIso(input.createdAt ?? input.openedAt);

    if (!Number.isInteger(input.folioNumber) || input.folioNumber < 0) {
      throw new Error('folioNumber must be a non-negative integer.');
    }

    const payload = {
      mutation_id: '',
      type: 'OPEN_TAB' as const,
      order_id: tabId,
      kiosk_id: kioskId,
      folio_number: input.folioNumber,
      folio_text: ensureNonEmpty(input.folioText, 'folioText'),
      total_cents: safeInt(input.totalCents ?? 0, 'totalCents', 0),
      pos_table_id: input.posTableId ?? null,
      pos_table_label: input.posTableLabel ?? null,
      opened_at: normalizeIso(input.openedAt ?? createdAt),
      created_at: createdAt,
      meta: input.meta ?? null,
    };

    const mutationId = this.resolveMutationId({
      mutationId: input.mutationId,
      tenantId,
      tabId,
      mutationType: 'OPEN_TAB',
      operationKey: input.operationKey || `open:${tabId}`,
      payload,
    });

    const duplicate = this.deps.outboxRepo.getByMutationId(mutationId);
    if (duplicate) {
      const tab = this.requireTab(tabId, tenantId);
      return this.asDuplicateResult(duplicate, tab.tabVersionLocal);
    }

    let tab = this.deps.tabsRepo.getById(tabId);
    if (tab && tab.tenantId !== tenantId) {
      throw new Error('tabId belongs to another tenant.');
    }
    if (tab && tab.status !== 'OPEN') {
      throw new Error(`Cannot open tab with status ${tab.status}.`);
    }

    const baseTabVersion = tab ? tab.tabVersionLocal : 0;

    if (!tab) {
      this.deps.tabsRepo.createOpenTab({
        id: tabId,
        tenantId,
        kioskId,
        folioNumber: input.folioNumber,
        folioText: payload.folio_text,
        posTableId: payload.pos_table_id,
        openedAt: payload.opened_at,
        totalCents: payload.total_cents,
      });
      tab = this.requireTab(tabId, tenantId);
    }

    let tabVersionLocal = tab.tabVersionLocal;
    if (tab.lastMutationId !== mutationId) {
      tabVersionLocal = this.deps.tabsRepo.bumpTabVersion(tabId, mutationId);
    }

    payload.mutation_id = mutationId;
    const record = this.ensureOutboxMutation({
      mutationId,
      tenantId,
      tabId,
      mutationType: 'OPEN_TAB',
      baseTabVersion,
      payload,
    });

    return {
      mutationId,
      tabId,
      mutationType: 'OPEN_TAB',
      status: record ? 'DUPLICATE' : 'APPLIED',
      baseTabVersion,
      tabVersionLocal,
    };
  }

  addItem(input: AddItemInput): MutationResult {
    const tenantId = ensureNonEmpty(input.tenantId, 'tenantId');
    const tab = this.requireOpenTab(input.tabId, tenantId);
    const lineId = input.lineId || fallbackEntityId();
    const createdAt = normalizeIso(input.createdAt);

    const payload = {
      mutation_id: '',
      type: 'ADD_ITEM' as const,
      order_id: tab.id,
      kiosk_id: ensureNonEmpty(input.kioskId, 'kioskId'),
      line_id: lineId,
      product_id: ensureNonEmpty(input.productId, 'productId'),
      qty: safeInt(input.qty, 'qty', 1),
      unit_price_cents: safeInt(input.unitPriceCents, 'unitPriceCents', 0),
      notes: input.notes ?? null,
      base_tab_version: tab.tabVersionLocal,
      created_at: createdAt,
      meta: input.meta ?? null,
    };

    const mutationId = this.resolveMutationId({
      mutationId: input.mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'ADD_ITEM',
      operationKey: input.operationKey || `add:${lineId}`,
      payload,
    });

    const duplicate = this.deps.outboxRepo.getByMutationId(mutationId);
    if (duplicate) {
      return this.asDuplicateResult(duplicate, tab.tabVersionLocal);
    }

    const baseTabVersion = tab.tabVersionLocal;
    let tabVersionLocal = tab.tabVersionLocal;

    if (tab.lastMutationId !== mutationId) {
      this.deps.tabLinesRepo.upsert({
        id: lineId,
        tenantId,
        tabId: tab.id,
        productId: payload.product_id,
        productName: input.productName ?? null,
        qty: payload.qty,
        unitPriceCents: payload.unit_price_cents,
        notes: payload.notes,
      });

      const totalCents = this.calculateTabTotalCents(tenantId, tab.id);
      tabVersionLocal = this.deps.tabsRepo.bumpTabVersion(tab.id, mutationId);
      this.deps.tabsRepo.updateTotalsAndKitchenState({
        tabId: tab.id,
        totalCents,
        mutationId,
      });
    }

    payload.mutation_id = mutationId;
    const record = this.ensureOutboxMutation({
      mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'ADD_ITEM',
      baseTabVersion,
      payload,
    });

    return {
      mutationId,
      tabId: tab.id,
      mutationType: 'ADD_ITEM',
      status: record ? 'DUPLICATE' : 'APPLIED',
      baseTabVersion,
      tabVersionLocal,
    };
  }

  updateQty(input: UpdateQtyInput): MutationResult {
    const tenantId = ensureNonEmpty(input.tenantId, 'tenantId');
    const tab = this.requireOpenTab(input.tabId, tenantId);
    const line = this.requireLine(input.lineId, tab.id, tenantId);
    const createdAt = normalizeIso(input.createdAt);

    const payload = {
      mutation_id: '',
      type: 'UPDATE_ITEM_QTY' as const,
      order_id: tab.id,
      kiosk_id: ensureNonEmpty(input.kioskId, 'kioskId'),
      line_id: line.id,
      qty: safeInt(input.qty, 'qty', 1),
      notes: input.notes ?? null,
      base_tab_version: tab.tabVersionLocal,
      created_at: createdAt,
      meta: input.meta ?? null,
    };

    const mutationId = this.resolveMutationId({
      mutationId: input.mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'UPDATE_ITEM_QTY',
      operationKey: input.operationKey || `qty:${line.id}:${payload.qty}`,
      payload,
    });

    const duplicate = this.deps.outboxRepo.getByMutationId(mutationId);
    if (duplicate) {
      return this.asDuplicateResult(duplicate, tab.tabVersionLocal);
    }

    const baseTabVersion = tab.tabVersionLocal;
    let tabVersionLocal = tab.tabVersionLocal;

    if (tab.lastMutationId !== mutationId) {
      this.deps.tabLinesRepo.updateQty(line.id, payload.qty, payload.notes);
      const totalCents = this.calculateTabTotalCents(tenantId, tab.id);
      tabVersionLocal = this.deps.tabsRepo.bumpTabVersion(tab.id, mutationId);
      this.deps.tabsRepo.updateTotalsAndKitchenState({
        tabId: tab.id,
        totalCents,
        mutationId,
      });
    }

    payload.mutation_id = mutationId;
    const record = this.ensureOutboxMutation({
      mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'UPDATE_ITEM_QTY',
      baseTabVersion,
      payload,
    });

    return {
      mutationId,
      tabId: tab.id,
      mutationType: 'UPDATE_ITEM_QTY',
      status: record ? 'DUPLICATE' : 'APPLIED',
      baseTabVersion,
      tabVersionLocal,
    };
  }

  removeItem(input: RemoveItemInput): MutationResult {
    const tenantId = ensureNonEmpty(input.tenantId, 'tenantId');
    const tab = this.requireOpenTab(input.tabId, tenantId);
    const line = this.requireLine(input.lineId, tab.id, tenantId);
    const createdAt = normalizeIso(input.createdAt);

    const payload = {
      mutation_id: '',
      type: 'REMOVE_ITEM' as const,
      order_id: tab.id,
      kiosk_id: ensureNonEmpty(input.kioskId, 'kioskId'),
      line_id: line.id,
      reason: input.reason ?? null,
      base_tab_version: tab.tabVersionLocal,
      created_at: createdAt,
      meta: input.meta ?? null,
    };

    const mutationId = this.resolveMutationId({
      mutationId: input.mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'REMOVE_ITEM',
      operationKey: input.operationKey || `remove:${line.id}`,
      payload,
    });

    const duplicate = this.deps.outboxRepo.getByMutationId(mutationId);
    if (duplicate) {
      return this.asDuplicateResult(duplicate, tab.tabVersionLocal);
    }

    const baseTabVersion = tab.tabVersionLocal;
    let tabVersionLocal = tab.tabVersionLocal;

    if (tab.lastMutationId !== mutationId) {
      this.deps.tabLinesRepo.softDelete(line.id);
      const totalCents = this.calculateTabTotalCents(tenantId, tab.id);
      tabVersionLocal = this.deps.tabsRepo.bumpTabVersion(tab.id, mutationId);
      this.deps.tabsRepo.updateTotalsAndKitchenState({
        tabId: tab.id,
        totalCents,
        mutationId,
      });
    }

    payload.mutation_id = mutationId;
    const record = this.ensureOutboxMutation({
      mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'REMOVE_ITEM',
      baseTabVersion,
      payload,
    });

    return {
      mutationId,
      tabId: tab.id,
      mutationType: 'REMOVE_ITEM',
      status: record ? 'DUPLICATE' : 'APPLIED',
      baseTabVersion,
      tabVersionLocal,
    };
  }

  kitchenPrint(input: KitchenPrintInput): KitchenPrintResult {
    const tenantId = ensureNonEmpty(input.tenantId, 'tenantId');
    const tab = this.requireOpenTab(input.tabId, tenantId);

    const fromVersion = tab.kitchenLastPrintedVersion;
    const printedVersion = tab.tabVersionLocal;
    const roundLines = this.deps.tabLinesRepo
      .listByTab(tenantId, tab.id)
      .map((line) => ({
        line_id: line.id,
        product_id: line.productId,
        qty: line.qty,
        unit_price_cents: line.unitPriceCents,
        notes: line.notes,
      }));

    if (printedVersion <= fromVersion) {
      return {
        mutationId: '',
        tabId: tab.id,
        mutationType: 'KITCHEN_PRINT',
        status: 'DUPLICATE',
        baseTabVersion: tab.tabVersionLocal,
        tabVersionLocal: tab.tabVersionLocal,
        skipped: true,
        printedVersion,
        fromVersion,
        round: { lines: roundLines },
      };
    }

    const createdAt = normalizeIso(input.createdAt);
    const payload = {
      mutation_id: '',
      type: 'KITCHEN_PRINT' as const,
      order_id: tab.id,
      kiosk_id: ensureNonEmpty(input.kioskId, 'kioskId'),
      printed_version: printedVersion,
      ok: input.ok !== false,
      error: input.error ?? null,
      base_tab_version: tab.tabVersionLocal,
      created_at: createdAt,
      meta: {
        from_version: fromVersion,
        round: {
          lines: roundLines,
        },
        ...(input.meta || {}),
      },
    };

    const mutationId = this.resolveMutationId({
      mutationId: input.mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'KITCHEN_PRINT',
      operationKey: input.operationKey || `kitchen:${fromVersion}->${printedVersion}`,
      payload,
    });

    const duplicate = this.deps.outboxRepo.getByMutationId(mutationId);
    if (duplicate) {
      return {
        ...this.asDuplicateResult(duplicate, tab.tabVersionLocal),
        skipped: false,
        printedVersion,
        fromVersion,
        round: { lines: roundLines },
      };
    }

    if (tab.lastMutationId !== mutationId) {
      this.deps.tabsRepo.updateTotalsAndKitchenState({
        tabId: tab.id,
        kitchenLastPrintedVersion: printedVersion,
        kitchenLastPrintAt: createdAt,
        mutationId,
      });
    }

    payload.mutation_id = mutationId;
    const record = this.ensureOutboxMutation({
      mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'KITCHEN_PRINT',
      baseTabVersion: tab.tabVersionLocal,
      payload,
    });

    return {
      mutationId,
      tabId: tab.id,
      mutationType: 'KITCHEN_PRINT',
      status: record ? 'DUPLICATE' : 'APPLIED',
      baseTabVersion: tab.tabVersionLocal,
      tabVersionLocal: tab.tabVersionLocal,
      skipped: false,
      printedVersion,
      fromVersion,
      round: { lines: roundLines },
    };
  }

  closeTabPaid(input: CloseTabPaidInput): MutationResult {
    const tenantId = ensureNonEmpty(input.tenantId, 'tenantId');
    const tab = this.requireOpenTab(input.tabId, tenantId);
    const closedAt = normalizeIso(input.closedAt ?? input.createdAt);

    const payload = {
      mutation_id: '',
      type: 'CLOSE_TAB_PAID' as const,
      order_id: tab.id,
      kiosk_id: ensureNonEmpty(input.kioskId, 'kioskId'),
      closed_at: closedAt,
      total_cents: safeInt(input.totalCents ?? this.calculateTabTotalCents(tenantId, tab.id), 'totalCents', 0),
      base_tab_version: tab.tabVersionLocal,
      created_at: normalizeIso(input.createdAt ?? closedAt),
      meta: input.meta ?? null,
    };

    const mutationId = this.resolveMutationId({
      mutationId: input.mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'CLOSE_TAB_PAID',
      operationKey: input.operationKey || `close-paid:${tab.id}`,
      payload,
    });

    const duplicate = this.deps.outboxRepo.getByMutationId(mutationId);
    if (duplicate) {
      return this.asDuplicateResult(duplicate, tab.tabVersionLocal);
    }

    const baseTabVersion = tab.tabVersionLocal;
    let tabVersionLocal = tab.tabVersionLocal;

    if (tab.lastMutationId !== mutationId) {
      this.deps.tabsRepo.updateStatus(tab.id, 'PAID', closedAt);
      this.deps.tabsRepo.updateTotalsAndKitchenState({
        tabId: tab.id,
        totalCents: payload.total_cents,
        mutationId,
      });
      tabVersionLocal = this.deps.tabsRepo.bumpTabVersion(tab.id, mutationId);
    }

    payload.mutation_id = mutationId;
    const record = this.ensureOutboxMutation({
      mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'CLOSE_TAB_PAID',
      baseTabVersion,
      payload,
    });

    return {
      mutationId,
      tabId: tab.id,
      mutationType: 'CLOSE_TAB_PAID',
      status: record ? 'DUPLICATE' : 'APPLIED',
      baseTabVersion,
      tabVersionLocal,
    };
  }

  cancelTab(input: CancelTabInput): MutationResult {
    const tenantId = ensureNonEmpty(input.tenantId, 'tenantId');
    const tab = this.requireOpenTab(input.tabId, tenantId);
    const canceledAt = normalizeIso(input.canceledAt ?? input.createdAt);

    const payload = {
      mutation_id: '',
      type: 'CANCEL_TAB' as const,
      order_id: tab.id,
      kiosk_id: ensureNonEmpty(input.kioskId, 'kioskId'),
      canceled_at: canceledAt,
      cancel_reason: input.cancelReason ?? null,
      base_tab_version: tab.tabVersionLocal,
      created_at: normalizeIso(input.createdAt ?? canceledAt),
      meta: input.meta ?? null,
    };

    const mutationId = this.resolveMutationId({
      mutationId: input.mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'CANCEL_TAB',
      operationKey: input.operationKey || `cancel:${tab.id}`,
      payload,
    });

    const duplicate = this.deps.outboxRepo.getByMutationId(mutationId);
    if (duplicate) {
      return this.asDuplicateResult(duplicate, tab.tabVersionLocal);
    }

    const baseTabVersion = tab.tabVersionLocal;
    let tabVersionLocal = tab.tabVersionLocal;

    if (tab.lastMutationId !== mutationId) {
      this.deps.tabsRepo.updateStatus(tab.id, 'CANCELED', canceledAt);
      tabVersionLocal = this.deps.tabsRepo.bumpTabVersion(tab.id, mutationId);
    }

    payload.mutation_id = mutationId;
    const record = this.ensureOutboxMutation({
      mutationId,
      tenantId,
      tabId: tab.id,
      mutationType: 'CANCEL_TAB',
      baseTabVersion,
      payload,
    });

    return {
      mutationId,
      tabId: tab.id,
      mutationType: 'CANCEL_TAB',
      status: record ? 'DUPLICATE' : 'APPLIED',
      baseTabVersion,
      tabVersionLocal,
    };
  }

  private generateTables(input: ConfigureTablesInput): Array<{
    id?: string;
    name: string;
    isActive?: boolean;
    sortOrder?: number;
  }> {
    if (!input.generate) return [];
    const count = safeInt(input.generate.count, 'generate.count', 1);
    const startAt = safeInt(input.generate.startAt ?? 1, 'generate.startAt', 1);
    const prefix = ensureNonEmpty(input.generate.prefix || 'Mesa', 'generate.prefix');

    const rows: Array<{ name: string; isActive?: boolean; sortOrder?: number }> = [];
    for (let i = 0; i < count; i += 1) {
      const number = startAt + i;
      rows.push({
        name: `${prefix} ${number}`,
        isActive: input.generate.isActive !== false,
        sortOrder: i,
      });
    }
    return rows;
  }

  private resolveMutationId(input: {
    mutationId?: string;
    tenantId: string;
    tabId: string;
    mutationType: OutboxMutationType;
    operationKey?: string | null;
    payload: Record<string, unknown>;
  }): string {
    if (input.mutationId && input.mutationId.trim()) {
      return input.mutationId.trim();
    }
    return stableMutationId({
      tenantId: input.tenantId,
      tabId: input.tabId,
      mutationType: input.mutationType,
      operationKey: input.operationKey,
      payload: input.payload,
    });
  }

  private ensureOutboxMutation(input: {
    mutationId: string;
    tenantId: string;
    tabId: string;
    mutationType: OutboxMutationType;
    baseTabVersion: number | null;
    payload: Record<string, unknown>;
  }): OutboxMutationRecord | null {
    try {
      this.deps.outboxRepo.enqueue({
        mutationId: input.mutationId,
        tenantId: input.tenantId,
        tabId: input.tabId,
        mutationType: input.mutationType,
        baseTabVersion: input.baseTabVersion,
        payload: input.payload,
      });
      return null;
    } catch (error) {
      if (isUniqueMutationViolation(error)) {
        return this.deps.outboxRepo.getByMutationId(input.mutationId);
      }
      throw error;
    }
  }

  private asDuplicateResult(record: OutboxMutationRecord, tabVersionLocal: number): MutationResult {
    return {
      mutationId: record.mutationId,
      tabId: record.tabId,
      mutationType: record.mutationType,
      status: 'DUPLICATE',
      baseTabVersion: record.baseTabVersion,
      tabVersionLocal,
    };
  }

  private requireOpenTab(tabId: string, tenantId: string): TabLocal {
    const tab = this.requireTab(tabId, tenantId);
    if (tab.status !== 'OPEN') {
      throw new Error(`Tab ${tab.id} is not OPEN.`);
    }
    return tab;
  }

  private requireTab(tabId: string, tenantId: string): TabLocal {
    const tab = this.deps.tabsRepo.getById(tabId);
    if (!tab) {
      throw new Error(`Tab not found: ${tabId}`);
    }
    if (tab.tenantId !== tenantId) {
      throw new Error(`Tab ${tabId} does not belong to tenant ${tenantId}.`);
    }
    return tab;
  }

  private requireLine(lineId: string, tabId: string, tenantId: string): TabLineLocal {
    const line = this.deps.tabLinesRepo.getById(lineId);
    if (!line) {
      throw new Error(`Line not found: ${lineId}`);
    }
    if (line.tabId !== tabId) {
      throw new Error(`Line ${lineId} does not belong to tab ${tabId}.`);
    }
    if (line.tenantId !== tenantId) {
      throw new Error(`Line ${lineId} does not belong to tenant ${tenantId}.`);
    }
    if (line.deletedAt) {
      throw new Error(`Line ${lineId} is deleted.`);
    }
    return line;
  }

  private calculateTabTotalCents(tenantId: string, tabId: string): number {
    return this.deps.tabLinesRepo
      .listByTab(tenantId, tabId)
      .reduce((acc, line) => acc + (line.qty * line.unitPriceCents), 0);
  }
}

function ensureNonEmpty(value: string | null | undefined, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

function safeInt(value: unknown, field: string, min: number): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min) {
    throw new Error(`${field} must be an integer >= ${min}.`);
  }
  return num;
}

function normalizeIso(value: string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed.toISOString();
}

function stableEntityId(tenantId: string, eventId: string | null, name: string): string {
  return stableMutationId({
    tenantId,
    tabId: eventId || 'global',
    mutationType: 'CONFIGURE_TABLE',
    operationKey: `table:${name.toLowerCase().trim()}`,
    payload: {
      event_id: eventId,
      name,
    },
  });
}

function isUniqueMutationViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code || '');
  const message = String((error as { message?: unknown }).message || '');
  return code.includes('SQLITE_CONSTRAINT') && message.includes('outbox_mutations.mutation_id');
}
