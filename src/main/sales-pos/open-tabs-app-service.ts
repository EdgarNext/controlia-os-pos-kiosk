import { randomUUID } from 'node:crypto';
import { OutboxRepo } from '../../../lib/outboxRepo';
import { KitchenRoundActionsRepo } from '../../../lib/kitchenRoundActionsRepo';
import { TabLinesRepo } from '../../../lib/tabLinesRepo';
import { PosTablesRepo } from '../../../lib/posTablesRepo';
import { TabsRepo } from '../../../lib/tabsRepo';
import { SalesPosDomainService, SyncV2Engine } from '../../../lib/services/sales-pos';
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
  PosTableView,
  PosTableCrudResult,
  ReorderPosTableInput,
  RemoveTabLineInput,
  TabCloseResult,
  TabDetailView,
  TabLineView,
  KitchenRoundView,
  TabMutationResult,
  TogglePosTableInput,
  TabView,
  UpdatePosTableInput,
  UpdateTabLineQtyInput,
} from '../../shared/open-tabs';
import { CatalogRepository } from '../catalog/catalog-repository';
import { OrdersRepository } from '../orders/orders-repository';
import { PrintService } from '../printing/print-service';

interface OpenTabsAppServiceInput {
  userDataPath: string;
  catalogRepository: CatalogRepository;
  ordersRepository: OrdersRepository;
  printService: PrintService;
}

export class OpenTabsAppService {
  private readonly domain: SalesPosDomainService;

  private readonly posTablesRepo: PosTablesRepo;

  private readonly tabsRepo: TabsRepo;

  private readonly tabLinesRepo: TabLinesRepo;

  private readonly catalogRepository: CatalogRepository;

  private readonly ordersRepository: OrdersRepository;

  private readonly printService: PrintService;

  private readonly syncService: SyncV2Engine;

  private readonly outboxRepo: OutboxRepo;

  private readonly kitchenRoundActionsRepo: KitchenRoundActionsRepo;

  constructor(input: OpenTabsAppServiceInput) {
    this.domain = SalesPosDomainService.fromUserDataPath({ userDataPath: input.userDataPath });
    this.posTablesRepo = new PosTablesRepo(input.userDataPath);
    this.tabsRepo = new TabsRepo(input.userDataPath);
    this.tabLinesRepo = new TabLinesRepo(input.userDataPath);
    this.catalogRepository = input.catalogRepository;
    this.ordersRepository = input.ordersRepository;
    this.printService = input.printService;
    this.outboxRepo = new OutboxRepo(input.userDataPath);
    this.kitchenRoundActionsRepo = new KitchenRoundActionsRepo(input.userDataPath);
    this.syncService = new SyncV2Engine({
      userDataPath: input.userDataPath,
      getRuntimeConfig: () => this.ordersRepository.getRuntimeConfig(),
    });
  }

  getSnapshot(eventId?: string | null): OpenTabsSnapshot {
    const runtime = this.requireRuntime();
    const tables = this.posTablesRepo
      .listActive(runtime.tenantId, eventId ?? null)
      .map((row): PosTableView => ({
        id: row.id,
        name: row.name,
        eventId: row.eventId,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
      }));

    const tabs = this.tabsRepo
      .listOpenByTenant(runtime.tenantId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((row) => this.mapTabView(row));

    return { tables, tabs };
  }

  getTabDetail(tabIdRaw: string): TabDetailView {
    const runtime = this.requireRuntime();
    const tabId = ensureNonEmpty(tabIdRaw, 'tabId');
    const tab = this.tabsRepo.getById(tabId);
    if (!tab || tab.tenantId !== runtime.tenantId) {
      throw new Error('Tab no encontrada para este tenant.');
    }

    const catalogById = new Map(this.catalogRepository.getCatalogSnapshot().items.map((item) => [item.id, item.name]));
    const kitchenBaseTime = tab.kitchenLastPrintAt ? new Date(tab.kitchenLastPrintAt).getTime() : null;
    const lines = this.tabLinesRepo.listByTab(runtime.tenantId, tabId).map((row): TabLineView => {
      const updatedTime = new Date(row.updatedAt).getTime();
      const pending =
        kitchenBaseTime == null || !Number.isFinite(updatedTime) || updatedTime > kitchenBaseTime;
      return {
        id: row.id,
        productId: row.productId,
        productName: row.productName || catalogById.get(row.productId) || row.productId,
        qty: row.qty,
        unitPriceCents: row.unitPriceCents,
        notes: row.notes,
        lineTotalCents: row.qty * row.unitPriceCents,
        updatedAt: row.updatedAt,
        kitchenStatus: pending ? 'PENDING' : 'SENT',
      };
    });

    const kitchenRounds = this.buildKitchenRounds(runtime.tenantId, tabId);
    const pendingKitchenCount = lines.filter((line) => line.kitchenStatus === 'PENDING').length;

    return {
      tab: this.mapTabView(tab),
      lines,
      pendingKitchenCount,
      kitchenRounds,
    };
  }

  configureTables(input: ConfigureOpenTabsTablesInput): ConfigureOpenTabsTablesResult {
    try {
      this.assertPosMaster();
      const runtime = this.requireRuntime();
      const result = this.domain.configureTables({
        tenantId: runtime.tenantId,
        eventId: input.eventId ?? null,
        tables: input.tables,
        generate: input.generate,
        createdBy: runtime.kioskId,
      });
      return {
        ok: true,
        upserted: result.upserted,
        generated: result.generated,
      };
    } catch (error) {
      return {
        ok: false,
        upserted: 0,
        generated: 0,
        error: error instanceof Error ? error.message : 'No se pudieron configurar mesas.',
      };
    }
  }

  listTables(eventId?: string | null): PosTableView[] {
    this.assertPosMaster();
    const runtime = this.requireRuntime();
    return this.posTablesRepo
      .listAll(runtime.tenantId, eventId ?? null)
      .map((row): PosTableView => ({
        id: row.id,
        name: row.name,
        eventId: row.eventId,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
      }));
  }

  updateTable(input: UpdatePosTableInput): PosTableCrudResult {
    try {
      this.assertPosMaster();
      this.requireRuntime();
      const tableId = ensureNonEmpty(input.tableId, 'tableId');
      const name = ensureNonEmpty(input.name, 'name');
      this.posTablesRepo.updateName(tableId, name);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'No se pudo editar mesa.' };
    }
  }

  toggleTable(input: TogglePosTableInput): PosTableCrudResult {
    try {
      this.assertPosMaster();
      this.requireRuntime();
      const tableId = ensureNonEmpty(input.tableId, 'tableId');
      this.posTablesRepo.setActive(tableId, Boolean(input.isActive));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'No se pudo actualizar mesa.' };
    }
  }

  deleteTable(tableIdRaw: string): PosTableCrudResult {
    try {
      this.assertPosMaster();
      this.requireRuntime();
      const tableId = ensureNonEmpty(tableIdRaw, 'tableId');
      this.posTablesRepo.softDelete(tableId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'No se pudo eliminar mesa.' };
    }
  }

  reorderTable(input: ReorderPosTableInput): PosTableCrudResult {
    try {
      this.assertPosMaster();
      const runtime = this.requireRuntime();
      const tableId = ensureNonEmpty(input.tableId, 'tableId');
      const direction = input.direction === 'down' ? 'down' : 'up';
      const list = this.posTablesRepo.listAll(runtime.tenantId);
      const idx = list.findIndex((row) => row.id === tableId);
      if (idx < 0) throw new Error('Mesa no encontrada.');
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= list.length) return { ok: true };
      const current = list[idx];
      const target = list[swapIdx];
      this.posTablesRepo.updateSortOrder(current.id, target.sortOrder);
      this.posTablesRepo.updateSortOrder(target.id, current.sortOrder);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'No se pudo reordenar mesa.' };
    }
  }

  openTab(input: OpenTabInput): OpenTabResult {
    try {
      const runtime = this.requireRuntime();
      const folio = this.ordersRepository.nextFolioForKiosk(runtime.kioskNumber || 1);
      const tableId = input.posTableId ?? null;
      const table = tableId ? this.posTablesRepo.getById(tableId) : null;
      const tableLabel = table && table.tenantId === runtime.tenantId ? table.name : null;
      const result = this.domain.openTab({
        tenantId: runtime.tenantId,
        kioskId: runtime.kioskId,
        folioNumber: folio.folioNumber,
        folioText: folio.folioText,
        posTableId: tableId,
        posTableLabel: tableLabel,
        operationKey: tableId ? `open:${tableId}:${folio.folioNumber}` : `open:${folio.folioNumber}`,
      });

      return {
        ok: true,
        tabId: result.tabId,
        mutationId: result.mutationId,
        folioText: folio.folioText,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo abrir la mesa.',
      };
    }
  }

  addItem(input: AddTabItemInput): TabMutationResult {
    try {
      const runtime = this.requireRuntime();
      const snapshot = this.catalogRepository.getCatalogSnapshot();
      const product = snapshot.items.find((item) => item.id === input.productId);
      if (!product) {
        throw new Error('Producto no encontrado en catalogo local.');
      }

      const result = this.domain.addItem({
        tenantId: runtime.tenantId,
        tabId: ensureNonEmpty(input.tabId, 'tabId'),
        kioskId: runtime.kioskId,
        lineId: randomUUID(),
        productId: product.id,
        productName: product.name,
        qty: safeInt(input.qty, 'qty', 1),
        unitPriceCents: product.priceCents,
        notes: input.notes ?? null,
      });

      return {
        ok: true,
        mutationId: result.mutationId,
        tabVersionLocal: result.tabVersionLocal,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo agregar item.',
      };
    }
  }

  updateQty(input: UpdateTabLineQtyInput): TabMutationResult {
    try {
      const runtime = this.requireRuntime();
      const result = this.domain.updateQty({
        tenantId: runtime.tenantId,
        tabId: ensureNonEmpty(input.tabId, 'tabId'),
        kioskId: runtime.kioskId,
        lineId: ensureNonEmpty(input.lineId, 'lineId'),
        qty: safeInt(input.qty, 'qty', 1),
        notes: input.notes ?? null,
      });

      return {
        ok: true,
        mutationId: result.mutationId,
        tabVersionLocal: result.tabVersionLocal,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo actualizar cantidad.',
      };
    }
  }

  removeItem(input: RemoveTabLineInput): TabMutationResult {
    try {
      const runtime = this.requireRuntime();
      const result = this.domain.removeItem({
        tenantId: runtime.tenantId,
        tabId: ensureNonEmpty(input.tabId, 'tabId'),
        kioskId: runtime.kioskId,
        lineId: ensureNonEmpty(input.lineId, 'lineId'),
        reason: input.reason ?? 'removed_by_waiter',
      });

      return {
        ok: true,
        mutationId: result.mutationId,
        tabVersionLocal: result.tabVersionLocal,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo remover item.',
      };
    }
  }

  async kitchenSend(input: KitchenSendInput): Promise<KitchenSendResult> {
    try {
      const runtime = this.requireRuntime();
      const detail = this.getTabDetail(input.tabId);
      const roundLines = this.buildKitchenRoundLines(detail);
      if (detail.tab.tabVersionLocal <= detail.tab.kitchenLastPrintedVersion) {
        return {
          ok: true,
          printOk: true,
          skipped: true,
          printedVersion: detail.tab.kitchenLastPrintedVersion,
        };
      }
      const rawBase64 = this.buildKitchenRawBase64(detail, roundLines);

      const printResult = await this.printService.printV2({
        rawBase64,
        jobName: `kitchen_${detail.tab.folioText}_${Date.now()}`,
        tenantId: runtime.tenantId,
        kioskId: runtime.kioskId,
        orderId: detail.tab.id,
      });

      const mutation = this.domain.kitchenPrint({
        tenantId: runtime.tenantId,
        tabId: detail.tab.id,
        kioskId: runtime.kioskId,
        ok: printResult.ok,
        error: printResult.ok ? null : printResult.error || 'kitchen_print_failed',
        meta: {
          print_job_id: printResult.jobId || null,
          round_lines: roundLines.length,
        },
      });

      return {
        ok: printResult.ok,
        printOk: printResult.ok,
        mutationId: mutation.mutationId,
        jobId: printResult.jobId,
        printedVersion: mutation.printedVersion,
        skipped: mutation.skipped,
        error: printResult.ok ? undefined : printResult.error || 'No se pudo imprimir cocina.',
      };
    } catch (error) {
      return {
        ok: false,
        printOk: false,
        error: error instanceof Error ? error.message : 'No se pudo enviar a cocina.',
      };
    }
  }

  async reprintKitchenRound(input: TabKitchenRoundActionInput): Promise<TabKitchenRoundActionResult> {
    try {
      const runtime = this.requireRuntime();
      const tabId = ensureNonEmpty(input.tabId, 'tabId');
      const mutationId = ensureNonEmpty(input.mutationId, 'mutationId');
      const tab = this.tabsRepo.getById(tabId);
      if (!tab || tab.tenantId !== runtime.tenantId) {
        throw new Error('Tab no encontrada para este tenant.');
      }

      const round = this.getKitchenRoundPayload(runtime.tenantId, tabId, mutationId);
      if (!round) throw new Error('Comanda de cocina no encontrada.');

      const rawBase64 = this.buildKitchenRoundRawBase64({
        title: 'REIMPRESION COMANDA',
        folioText: tab.folioText,
        printedVersion: round.printedVersion,
        lines: round.lines,
      });

      const printResult = await this.printService.printV2({
        rawBase64,
        jobName: `kitchen_reprint_${tab.folioText}_${Date.now()}`,
        tenantId: runtime.tenantId,
        kioskId: runtime.kioskId,
        orderId: tab.id,
      });

      return {
        ok: printResult.ok,
        jobId: printResult.jobId,
        error: printResult.ok ? undefined : printResult.error || 'No se pudo reimprimir comanda.',
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'No se pudo reimprimir comanda.' };
    }
  }

  async cancelKitchenRound(input: TabKitchenRoundCancelInput): Promise<TabKitchenRoundActionResult> {
    try {
      const runtime = this.requireRuntime();
      const tabId = ensureNonEmpty(input.tabId, 'tabId');
      const mutationId = ensureNonEmpty(input.mutationId, 'mutationId');
      const tab = this.tabsRepo.getById(tabId);
      if (!tab || tab.tenantId !== runtime.tenantId) {
        throw new Error('Tab no encontrada para este tenant.');
      }

      const existing = this.kitchenRoundActionsRepo.getCancellation(runtime.tenantId, tabId, mutationId);
      if (existing) {
        return { ok: true, jobId: existing.printJobId || undefined };
      }

      const round = this.getKitchenRoundPayload(runtime.tenantId, tabId, mutationId);
      if (!round) throw new Error('Comanda de cocina no encontrada.');

      const reason = input.reason?.trim() || 'canceled_by_operator';
      const rawBase64 = this.buildKitchenRoundRawBase64({
        title: 'CANCELACION COMANDA',
        folioText: tab.folioText,
        printedVersion: round.printedVersion,
        lines: round.lines,
      });

      const printResult = await this.printService.printV2({
        rawBase64,
        jobName: `kitchen_cancel_${tab.folioText}_${Date.now()}`,
        tenantId: runtime.tenantId,
        kioskId: runtime.kioskId,
        orderId: tab.id,
      });

      this.kitchenRoundActionsRepo.recordCancellation({
        tenantId: runtime.tenantId,
        tabId,
        roundMutationId: mutationId,
        reason,
        printJobId: printResult.jobId || null,
      });

      return {
        ok: printResult.ok,
        jobId: printResult.jobId,
        error: printResult.ok ? undefined : printResult.error || 'No se pudo imprimir cancelacion de comanda.',
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'No se pudo cancelar comanda.' };
    }
  }

  async closeTabPaid(input: CloseTabPaidInput): Promise<TabCloseResult> {
    try {
      const runtime = this.requireRuntime();
      const detail = this.getTabDetail(input.tabId);
      const totalCents = detail.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
      const metodoPago = input.metodoPago === 'tarjeta' ? 'tarjeta' : 'efectivo';
      const pagoRecibidoCents =
        metodoPago === 'tarjeta'
          ? totalCents
          : Number.isFinite(input.pagoRecibidoCents)
            ? Number(input.pagoRecibidoCents)
            : 0;

      if (metodoPago === 'efectivo' && pagoRecibidoCents < totalCents) {
        throw new Error('Pago insuficiente para cerrar cuenta.');
      }

      const cambioCents = Math.max(pagoRecibidoCents - totalCents, 0);
      const printResult = await this.printService.printV2({
        rawBase64: this.buildFinalTicketRawBase64(detail, metodoPago, pagoRecibidoCents, cambioCents),
        jobName: `tab_close_${detail.tab.folioText}_${Date.now()}`,
        tenantId: runtime.tenantId,
        kioskId: runtime.kioskId,
        orderId: detail.tab.id,
      });

      this.tabsRepo.updateFinalPrintState({
        tabId: detail.tab.id,
        finalPrintStatus: printResult.ok ? 'SENT' : 'FAILED',
        finalPrintAt: new Date().toISOString(),
        finalPrintError: printResult.ok ? null : printResult.error || 'Print error',
      });

      const result = this.domain.closeTabPaid({
        tenantId: runtime.tenantId,
        tabId: ensureNonEmpty(input.tabId, 'tabId'),
        kioskId: runtime.kioskId,
        meta: {
          metodo_pago: metodoPago,
          total_cents: totalCents,
          pago_recibido_cents: pagoRecibidoCents,
          cambio_cents: cambioCents,
          print_status: printResult.ok ? 'SENT' : 'FAILED',
          print_job_id: printResult.jobId || null,
          print_error: printResult.ok ? null : printResult.error || 'Print error',
        },
      });

      return {
        ok: true,
        mutationId: result.mutationId,
        tabVersionLocal: result.tabVersionLocal,
        totalCents,
        cambioCents,
        printStatus: printResult.ok ? 'SENT' : 'FAILED',
        printJobId: printResult.jobId || undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo cerrar cuenta.',
      };
    }
  }

  cancelTab(tabIdRaw: string): TabMutationResult {
    try {
      const runtime = this.requireRuntime();
      const result = this.domain.cancelTab({
        tenantId: runtime.tenantId,
        tabId: ensureNonEmpty(tabIdRaw, 'tabId'),
        kioskId: runtime.kioskId,
        cancelReason: 'canceled_by_operator',
      });

      return {
        ok: true,
        mutationId: result.mutationId,
        tabVersionLocal: result.tabVersionLocal,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo cancelar tab.',
      };
    }
  }

  async syncMutations(limit = 100) {
    return this.syncService.syncPending(limit);
  }

  countPendingMutations(): number {
    return this.syncService.countPending();
  }

  isPosMaster(): boolean {
    const runtime = this.ordersRepository.getRuntimeConfig();
    return Number(runtime.kioskNumber || 0) === 1;
  }

  private assertPosMaster(): void {
    if (!this.isPosMaster()) {
      throw new Error('Solo POS master puede administrar mesas.');
    }
  }

  private requireRuntime(): { tenantId: string; kioskId: string; kioskNumber: number | null } {
    const runtime = this.ordersRepository.getRuntimeConfig();
    const tenantId = String(runtime.tenantId || '').trim();
    const kioskId = String(runtime.kioskId || '').trim();
    if (!tenantId || !kioskId) {
      throw new Error('Configura tenant_id y kiosk_id en Ajustes para operar tabs.');
    }
    return {
      tenantId,
      kioskId,
      kioskNumber: runtime.kioskNumber,
    };
  }

  private mapTabView(tab: {
    id: string;
    folioText: string;
    folioNumber: number;
    status: 'OPEN' | 'PAID' | 'CANCELED';
    posTableId: string | null;
    totalCents: number;
    tabVersionLocal: number;
    kitchenLastPrintedVersion: number;
    kitchenLastPrintAt?: string | null;
    openedAt: string | null;
    updatedAt: string;
  }): TabView {
    return {
      id: tab.id,
      folioText: tab.folioText,
      folioNumber: tab.folioNumber,
      status: tab.status,
      posTableId: tab.posTableId,
      totalCents: tab.totalCents,
      tabVersionLocal: tab.tabVersionLocal,
      kitchenLastPrintedVersion: tab.kitchenLastPrintedVersion,
      kitchenLastPrintAt: tab.kitchenLastPrintAt ?? null,
      openedAt: tab.openedAt,
      updatedAt: tab.updatedAt,
    };
  }

  private buildKitchenRawBase64(
    detail: TabDetailView,
    roundLines: Array<{ name: string; qty: number; notes: string | null }>,
  ): string {
    const lines = roundLines
      .map((line) => `${line.qty}x ${line.name}${line.notes ? ` (${line.notes})` : ''}`)
      .join('\n');
    const content = [
      'COMANDA COCINA',
      `TAB: ${detail.tab.folioText}`,
      `VERSION: ${detail.tab.tabVersionLocal}`,
      '--------------------',
      lines || 'Sin nuevos items',
      '--------------------',
      formatDateTimeMx(new Date().toISOString()),
      '\n\n\n',
    ].join('\n');

    const bytes = Buffer.from(content, 'utf8');
    return bytes.toString('base64');
  }

  private buildKitchenRoundRawBase64(input: {
    title: string;
    folioText: string;
    printedVersion: number;
    lines: Array<{ name: string; qty: number; notes: string | null }>;
  }): string {
    const lines = input.lines
      .map((line) => `${line.qty}x ${line.name}${line.notes ? ` (${line.notes})` : ''}`)
      .join('\n');
    const content = [
      input.title,
      `TAB: ${input.folioText}`,
      `VERSION: ${input.printedVersion}`,
      '--------------------',
      lines || 'Sin lineas',
      '--------------------',
      formatDateTimeMx(new Date().toISOString()),
      '\n\n\n',
    ].join('\n');
    return Buffer.from(content, 'utf8').toString('base64');
  }

  private buildFinalTicketRawBase64(
    detail: TabDetailView,
    metodoPago: 'efectivo' | 'tarjeta',
    pagoRecibidoCents: number,
    cambioCents: number,
  ): string {
    const groupedByProduct = new Map<string, { name: string; qty: number; totalCents: number }>();
    detail.lines.forEach((line) => {
      const existing = groupedByProduct.get(line.productId);
      if (existing) {
        existing.qty += line.qty;
        existing.totalCents += line.unitPriceCents * line.qty;
        return;
      }
      groupedByProduct.set(line.productId, {
        name: line.productName || line.productId,
        qty: line.qty,
        totalCents: line.unitPriceCents * line.qty,
      });
    });
    const lines = Array.from(groupedByProduct.values())
      .map((line) => `${line.qty}x ${line.name} ${formatMoney(line.totalCents)}`)
      .join('\n');
    const totalCents = detail.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const content = [
      'TICKET FINAL',
      `TAB: ${detail.tab.folioText}`,
      `FECHA: ${formatDateTimeMx(new Date().toISOString())}`,
      '------------------------------',
      lines || 'Sin lineas',
      '------------------------------',
      `TOTAL: ${formatMoney(totalCents)}`,
      `METODO: ${metodoPago.toUpperCase()}`,
      `PAGO: ${formatMoney(pagoRecibidoCents)}`,
      `CAMBIO: ${formatMoney(cambioCents)}`,
      '\n\n\n',
    ].join('\n');
    return Buffer.from(content, 'utf8').toString('base64');
  }

  private buildKitchenRoundLines(detail: TabDetailView): Array<{ name: string; qty: number; notes: string | null }> {
    const lastPrintAt = detail.tab.kitchenLastPrintAt || null;
    if (!lastPrintAt) {
      return detail.lines.map((line) => ({
        name: line.productName || line.productId,
        qty: line.qty,
        notes: line.notes,
      }));
    }

    const base = new Date(lastPrintAt).getTime();
    return detail.lines
      .filter((line) => {
        const changed = new Date(line.updatedAt).getTime();
        return Number.isFinite(changed) && changed > base;
      })
      .map((line) => ({
        name: line.productName || line.productId,
        qty: line.qty,
        notes: line.notes,
      }));
  }

  private buildKitchenRounds(tenantId: string, tabId: string): KitchenRoundView[] {
    const cancellations = this.kitchenRoundActionsRepo.listCancellationsByTab(tenantId, tabId);
    const cancellationByMutationId = new Map(cancellations.map((row) => [row.roundMutationId, row]));
    return this.outboxRepo
      .listByTabAndType(tenantId, tabId, 'KITCHEN_PRINT', 20)
      .map((row): KitchenRoundView => {
        let printedVersion = 0;
        let fromVersion = 0;
        let ok = true;
        let linesCount = 0;
        let error: string | null = row.lastError ?? null;
        try {
          const payload = JSON.parse(row.payloadJson) as {
            printed_version?: unknown;
            ok?: unknown;
            error?: unknown;
            meta?: { from_version?: unknown; round?: { lines?: unknown[] } };
          };
          printedVersion = Number(payload.printed_version) || 0;
          fromVersion = Number(payload.meta?.from_version) || 0;
          ok = payload.ok !== false;
          linesCount = Array.isArray(payload.meta?.round?.lines) ? payload.meta?.round?.lines.length : 0;
          if (typeof payload.error === 'string' && payload.error.trim()) {
            error = payload.error.trim();
          }
        } catch {
          // Keep defaults for malformed payloads.
        }

        const cancellation = cancellationByMutationId.get(row.mutationId) || null;
        return {
          mutationId: row.mutationId,
          printedVersion,
          fromVersion,
          ok,
          linesCount,
          createdAt: row.createdAt,
          status: row.status,
          error,
          canceled: Boolean(cancellation),
          canceledAt: cancellation?.createdAt || null,
          cancelReason: cancellation?.reason || null,
        };
      });
  }

  private getKitchenRoundPayload(
    tenantId: string,
    tabId: string,
    mutationId: string,
  ): {
    printedVersion: number;
    fromVersion: number;
    lines: Array<{ name: string; qty: number; notes: string | null }>;
  } | null {
    const catalogById = new Map(this.catalogRepository.getCatalogSnapshot().items.map((item) => [item.id, item.name]));
    const round = this.outboxRepo
      .listByTabAndType(tenantId, tabId, 'KITCHEN_PRINT', 200)
      .find((row) => row.mutationId === mutationId);
    if (!round) return null;
    const payload = JSON.parse(round.payloadJson) as {
      printed_version?: unknown;
      meta?: {
        from_version?: unknown;
        round?: {
          lines?: Array<{
            product_id?: unknown;
            qty?: unknown;
            notes?: unknown;
          }>;
        };
      };
    };

    const lines = Array.isArray(payload.meta?.round?.lines)
      ? payload.meta?.round?.lines.map((line) => ({
          name: catalogById.get(String(line.product_id || '')) || String(line.product_id || 'item'),
          qty: Number(line.qty) || 0,
          notes: line.notes ? String(line.notes) : null,
        }))
      : [];

    return {
      printedVersion: Number(payload.printed_version) || 0,
      fromVersion: Number(payload.meta?.from_version) || 0,
      lines: lines.filter((line) => line.qty > 0),
    };
  }
}

function ensureNonEmpty(value: string, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${field} es requerido.`);
  return normalized;
}

function safeInt(value: unknown, field: string, min: number): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min) {
    throw new Error(`${field} debe ser entero >= ${min}.`);
  }
  return num;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDateTimeMx(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
  }).format(date);
}
