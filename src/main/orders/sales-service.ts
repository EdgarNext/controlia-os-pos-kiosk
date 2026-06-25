import type {
  CancelOrderResult,
  CreateSaleInput,
  CreateSaleResult,
  OrderHistoryRecord,
  ReprintOrderResult,
} from '../../shared/orders';
import { PrintService } from '../printing/print-service';
import { buildEscPosTextPayload } from '../printing/escpos-utils';
import { buildSaleTicketLayout, resolveSaleTicketHeaderLabel } from '../printing/kiosk-ticket-layout';
import type { SyncCoordinator } from '../sync/sync-coordinator';
import { OrdersRepository } from './orders-repository';

export class SalesService {
  private pendingOrderByPrintJobId = new Map<string, string>();

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly printService: PrintService,
    private readonly syncCoordinator: SyncCoordinator,
  ) {}

  start(): void {
    this.printService.onJobCompleted(({ jobId, status, error }) => {
      const orderId = this.pendingOrderByPrintJobId.get(jobId);
      if (!orderId) return;
      this.pendingOrderByPrintJobId.delete(jobId);
      this.ordersRepository.recordReprintAttemptAndOutbox({
        orderId,
        printStatus: status === 'SENT' ? 'SENT' : 'FAILED',
        printJobId: jobId,
        printError: status === 'SENT' ? null : error || 'Print error',
      });
      this.syncCoordinator.notifyPendingWork('auto');
    });
  }

  async createSaleAndPrint(input: CreateSaleInput): Promise<CreateSaleResult> {
    const runtime = this.ordersRepository.getRuntimeConfig();
    if (!runtime.tenantId || !runtime.kioskId || !runtime.kioskNumber) {
      return {
        ok: false,
        error:
          'Configura tenant_id, kiosk_id y kiosk_number en Ajustes antes de confirmar ventas.',
      };
    }

    const lines = (input.lines || [])
      .map((line) => ({
        catalogItemId: line.catalogItemId,
        name: line.name,
        qty: Number(line.qty),
        unitPriceCents: Number(line.unitPriceCents),
      }))
      .filter((line) => line.catalogItemId && line.name && line.qty > 0 && Number.isFinite(line.unitPriceCents));

    if (!lines.length) {
      return { ok: false, error: 'Carrito vacio.' };
    }

    const totalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.qty, 0);
    const pagoRecibidoCents = Number(input.pagoRecibidoCents || 0);

    if (!Number.isFinite(pagoRecibidoCents) || pagoRecibidoCents < totalCents) {
      return { ok: false, error: 'Pago insuficiente.' };
    }

    const cambioCents = pagoRecibidoCents - totalCents;
    let created: { orderId: string; folioText: string };
    try {
      created = this.ordersRepository.createOrderAndOutbox({
        lines,
        totalCents,
        pagoRecibidoCents,
        cambioCents,
        metodoPago: input.metodoPago || 'efectivo',
        printStatus: 'FAILED',
        printJobId: null,
        printError: 'Print queued',
        printAttempted: true,
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo crear la venta local.',
      };
    }
    this.syncCoordinator.notifyPendingWork('sale');

    const printedAtIso = new Date().toISOString();
    const rawBase64 = this.buildTicketRawBase64(
      lines,
      totalCents,
      pagoRecibidoCents,
      cambioCents,
      input.metodoPago || 'efectivo',
      runtime.splitFoodAndDrinksOnTicket === true,
      resolveSaleTicketHeaderLabel(runtime),
      created.folioText,
      printedAtIso,
    );
    try {
      const printResult = await this.printService.printSaleTicket({
        headerTitle: resolveSaleTicketHeaderLabel(runtime),
        lines,
        totalCents,
        pagoRecibidoCents,
        cambioCents,
        metodoPago: input.metodoPago || 'efectivo',
        folioText: created.folioText,
        createdAtIso: printedAtIso,
        tenantId: runtime.tenantId,
        kioskId: runtime.kioskId,
        orderId: created.orderId,
        usbRawBase64: rawBase64,
        jobName: `order_${Date.now()}`,
      });

      if (printResult.status === 'QUEUED') {
        this.pendingOrderByPrintJobId.set(printResult.jobId, created.orderId);
      } else {
        this.ordersRepository.recordReprintAttemptAndOutbox({
          orderId: created.orderId,
          printStatus: printResult.ok ? 'SENT' : 'FAILED',
          printJobId: printResult.jobId || null,
          printError: printResult.error || null,
        });
        this.syncCoordinator.notifyPendingWork('auto');
      }

      return {
        ok: true,
        orderId: created.orderId,
        folioText: created.folioText,
        totalCents,
        cambioCents,
        printStatus: printResult.status,
        error: printResult.error,
      };
    } catch (error) {
      try {
        this.ordersRepository.recordReprintAttemptAndOutbox({
          orderId: created.orderId,
          printStatus: 'FAILED',
          printJobId: null,
          printError: error instanceof Error ? error.message : 'Print queue error',
        });
      } catch {
        // best effort; sale is already persisted locally
      }
      this.syncCoordinator.notifyPendingWork('auto');
      return {
        ok: true,
        orderId: created.orderId,
        folioText: created.folioText,
        totalCents,
        cambioCents,
        printStatus: 'FAILED',
        error: error instanceof Error ? error.message : 'Print queue error',
      };
    }
  }

  listOrderHistory(limit = 50): OrderHistoryRecord[] {
    const sales = this.ordersRepository.listTodayOrders(limit);
    const tabs = this.ordersRepository.listTodayClosedTabs(limit);
    return [...sales, ...tabs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Math.max(1, Math.min(limit, 100)));
  }

  async reprintOrder(orderIdRaw: string): Promise<ReprintOrderResult> {
    const orderId = String(orderIdRaw || '').trim();
    if (!orderId) {
      return { ok: false, orderId: '', error: 'Order id invalido.' };
    }

    const order = this.ordersRepository.getOrderForReprint(orderId);
    if (!order) {
      return { ok: false, orderId, error: 'La orden no existe.' };
    }

    if (order.status === 'CANCELED') {
      return { ok: false, orderId, error: 'No se puede reimprimir una orden cancelada.' };
    }

    const rawBase64 = this.buildTicketRawBase64(
      order.lines,
      order.totalCents,
      order.pagoRecibidoCents,
      order.cambioCents,
      order.metodoPago,
      this.ordersRepository.getRuntimeConfig().splitFoodAndDrinksOnTicket === true,
      resolveSaleTicketHeaderLabel(this.ordersRepository.getRuntimeConfig()),
      order.folioText,
      order.createdAt,
      true,
    );

    try {
      const runtime = this.ordersRepository.getRuntimeConfig();
      const printResult = await this.printService.printSaleTicket({
        headerTitle: resolveSaleTicketHeaderLabel(runtime),
        lines: order.lines,
        totalCents: order.totalCents,
        pagoRecibidoCents: order.pagoRecibidoCents,
        cambioCents: order.cambioCents,
        metodoPago: order.metodoPago,
        folioText: order.folioText,
        createdAtIso: order.createdAt,
        isReprint: true,
        tenantId: order.tenantId,
        kioskId: order.kioskId,
        orderId,
        usbRawBase64: rawBase64,
        jobName: `reprint_${order.folioText}_${Date.now()}`,
      });

      if (printResult.status === 'QUEUED') {
        this.pendingOrderByPrintJobId.set(printResult.jobId, orderId);
      } else {
        this.ordersRepository.recordReprintAttemptAndOutbox({
          orderId,
          printStatus: printResult.ok ? 'SENT' : 'FAILED',
          printJobId: printResult.jobId || null,
          printError: printResult.error || null,
        });
      }
      this.syncCoordinator.notifyPendingWork('auto');

      return {
        ok: printResult.ok || printResult.status === 'QUEUED',
        orderId,
        printStatus: printResult.ok ? 'SENT' : printResult.status === 'QUEUED' ? 'SENT' : 'FAILED',
        jobId: printResult.jobId,
        error: printResult.error,
      };
    } catch (error) {
      return {
        ok: false,
        orderId,
        error: error instanceof Error ? error.message : 'No se pudo encolar reimpresion.',
      };
    }
  }

  cancelOrder(orderIdRaw: string): CancelOrderResult {
    const orderId = String(orderIdRaw || '').trim();
    if (!orderId) {
      return { ok: false, orderId: '', error: 'Order id invalido.' };
    }

    let result: { ok: boolean; canceledAt?: string; error?: string };
    try {
      result = this.ordersRepository.cancelOrderAndOutbox(orderId);
    } catch (error) {
      return { ok: false, orderId, error: error instanceof Error ? error.message : 'No se pudo cancelar la orden.' };
    }
    if (!result.ok) {
      return { ok: false, orderId, error: result.error || 'No se pudo cancelar la orden.' };
    }
    this.syncCoordinator.notifyPendingWork('sale');

    return {
      ok: true,
      orderId,
      canceledAt: result.canceledAt,
    };
  }

  private buildTicketRawBase64(
    lines: Array<{ name: string; qty: number; unitPriceCents: number; itemType?: string | null }>,
    totalCents: number,
    pagoRecibidoCents: number,
    cambioCents: number,
    metodoPago: string,
    splitFoodAndDrinksOnTicket: boolean,
    headerTitle?: string | null,
    folioText?: string,
    createdAtIso?: string,
    isReprint = false,
  ): string {
    const layout = buildSaleTicketLayout({
      headerTitle,
      lines,
      totalCents,
      pagoRecibidoCents,
      cambioCents,
      metodoPago,
      folioText,
      createdAtIso,
      isReprint,
      width: 32,
      splitFoodAndDrinksOnTicket,
    });
    const body = [
      centerText(layout.headerTitle, 32),
      ...(layout.headerSubtitle ? [centerText(layout.headerSubtitle, 32)] : []),
      centerText(layout.ticketLabel, 32),
      ...layout.metaLines,
      ...layout.columnHeaderLines,
      ...layout.itemLines,
      ...layout.summaryLines,
      ...layout.footerLines.map((line) => centerText(line, 32)),
    ].join('\n');
    const payload = buildEscPosTextPayload(body);
    return payload.toString('base64');
  }
}

function centerText(value: string, width: number): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length >= width) return text;
  const leftPad = Math.floor((width - text.length) / 2);
  return `${' '.repeat(leftPad)}${text}`;
}
