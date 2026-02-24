import type {
  CancelOrderResult,
  CreateSaleInput,
  CreateSaleResult,
  OrderHistoryRecord,
  ReprintOrderResult,
} from '../../shared/orders';
import { PrintService } from '../printing/print-service';
import { OrdersRepository } from './orders-repository';

export class SalesService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly printService: PrintService,
  ) {}

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
    const rawBase64 = this.buildTicketRawBase64(lines, totalCents, pagoRecibidoCents, cambioCents);

    const printResult = await this.printService.printV2({
      rawBase64,
      jobName: `order_${Date.now()}`,
      tenantId: runtime.tenantId,
      kioskId: runtime.kioskId,
    });

    const printStatus = printResult.ok ? 'SENT' : 'FAILED';
    const printError = printResult.ok ? null : printResult.error || 'Print error';

    const created = this.ordersRepository.createOrderAndOutbox({
      lines,
      totalCents,
      pagoRecibidoCents,
      cambioCents,
      metodoPago: input.metodoPago || 'efectivo',
      printStatus,
      printJobId: printResult.jobId || null,
      printError,
    });

    return {
      ok: true,
      orderId: created.orderId,
      folioText: created.folioText,
      totalCents,
      cambioCents,
      printStatus,
      error: printResult.ok ? undefined : printError || undefined,
    };
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
      order.folioText,
      order.createdAt,
      true,
    );

    const printResult = await this.printService.printV2({
      rawBase64,
      jobName: `reprint_${order.folioText}_${Date.now()}`,
      tenantId: order.tenantId,
      kioskId: order.kioskId,
      orderId,
    });

    const persisted = this.ordersRepository.recordReprintAttemptAndOutbox({
      orderId,
      printStatus: printResult.ok ? 'SENT' : 'FAILED',
      printJobId: printResult.jobId || null,
      printError: printResult.ok ? null : printResult.error || 'Print error',
    });

    if (!persisted.ok) {
      return { ok: false, orderId, error: persisted.error || 'No se pudo registrar la reimpresion.' };
    }

    return {
      ok: printResult.ok,
      orderId,
      printStatus: printResult.ok ? 'SENT' : 'FAILED',
      jobId: printResult.jobId,
      error: printResult.ok ? undefined : printResult.error,
    };
  }

  cancelOrder(orderIdRaw: string): CancelOrderResult {
    const orderId = String(orderIdRaw || '').trim();
    if (!orderId) {
      return { ok: false, orderId: '', error: 'Order id invalido.' };
    }

    const result = this.ordersRepository.cancelOrderAndOutbox(orderId);
    if (!result.ok) {
      return { ok: false, orderId, error: result.error || 'No se pudo cancelar la orden.' };
    }

    return {
      ok: true,
      orderId,
      canceledAt: result.canceledAt,
    };
  }

  private buildTicketRawBase64(
    lines: Array<{ name: string; qty: number; unitPriceCents: number }>,
    totalCents: number,
    pagoRecibidoCents: number,
    cambioCents: number,
    folioText?: string,
    createdAtIso?: string,
    isReprint = false,
  ): string {
    const encoder = new TextEncoder();
    const ESC = 0x1b;
    const GS = 0x1d;

    const rows: number[] = [ESC, 0x40, ESC, 0x61, 0x01];
    rows.push(...Array.from(encoder.encode('KIOSK POS\n')));
    rows.push(...Array.from(encoder.encode(isReprint ? 'REIMPRESION\n' : 'Ticket de venta\n')));
    rows.push(ESC, 0x61, 0x00);
    rows.push(...Array.from(encoder.encode(`${formatDateTimeMx(new Date().toISOString())}\n`)));
    if (folioText) {
      rows.push(...Array.from(encoder.encode(`Folio: ${folioText}\n`)));
    }
    if (createdAtIso && isReprint) {
      rows.push(...Array.from(encoder.encode(`Venta original: ${formatDateTimeMx(createdAtIso)}\n`)));
    }
    rows.push(...Array.from(encoder.encode('------------------------------\n')));

    lines.forEach((line) => {
      const lineTotal = new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 0,
      }).format((line.unitPriceCents * line.qty) / 100);
      rows.push(...Array.from(encoder.encode(`${line.qty}x ${line.name} ${lineTotal}\n`)));
    });

    const money = (cents: number) =>
      new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 0,
      }).format(cents / 100);

    rows.push(...Array.from(encoder.encode('------------------------------\n')));
    rows.push(...Array.from(encoder.encode(`TOTAL: ${money(totalCents)}\n`)));
    rows.push(...Array.from(encoder.encode(`RECIBIDO: ${money(pagoRecibidoCents)}\n`)));
    rows.push(...Array.from(encoder.encode(`CAMBIO: ${money(cambioCents)}\n`)));
    rows.push(...Array.from(encoder.encode('\n\n\n')));
    rows.push(GS, 0x56, 0x00);

    const bytes = new Uint8Array(rows);
    let binary = '';
    bytes.forEach((value) => {
      binary += String.fromCharCode(value);
    });
    return btoa(binary);
  }
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
