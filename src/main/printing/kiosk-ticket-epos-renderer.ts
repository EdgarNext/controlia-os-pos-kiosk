import type { PrintConfig } from '../../shared/print-v2';
import { cut, eposDocument, feed, pulse, separator, text } from './epos-xml-builder';

type KioskTicketLine = {
  name: string;
  qty: number;
  unitPriceCents: number;
};

type RenderKioskTicketInput = {
  lines: KioskTicketLine[];
  totalCents: number;
  pagoRecibidoCents: number;
  cambioCents: number;
  metodoPago: string;
  folioText?: string;
  createdAtIso?: string;
  isReprint?: boolean;
  config: PrintConfig;
};

function money(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function lineWidth(config: PrintConfig): number {
  return config.epsonPaperWidthMm === 58 ? 32 : 42;
}

function wrapText(value: string, width: number): string[] {
  const words = value.trim().split(/\s+/g).filter(Boolean);
  if (!words.length) return [''];

  const lines: string[] = [];
  let current = '';

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });

  if (current) lines.push(current);
  return lines;
}

function pair(left: string, right: string, width: number): string {
  if (left.length + right.length >= width) {
    return `${left}\n${right}`;
  }
  return `${left}${' '.repeat(width - left.length - right.length)}${right}`;
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

function formatPaymentMethod(value: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'tarjeta' || normalized === 'card') return 'Tarjeta';
  if (normalized === 'efectivo' || normalized === 'cash') return 'Efectivo';
  if (normalized === 'employee') return 'Pago empleado';
  return normalized ? normalized : 'Efectivo';
}

export function renderKioskTicketEposXml(input: RenderKioskTicketInput): string {
  const width = lineWidth(input.config);
  const nodes: string[] = [
    text('KIOSK POS', { align: 'center', em: true, width: 2, height: 2, smooth: true }),
    text(input.isReprint ? 'REIMPRESION' : 'Ticket de venta', { align: 'center' }),
    feed(1),
    text(`Fecha: ${formatDateTimeMx(input.createdAtIso || new Date().toISOString())}`),
  ];

  if (input.folioText) {
    nodes.push(text(`Folio: ${input.folioText}`, { em: true }));
  }

  nodes.push(
    separator(width),
    text('Cant  Producto'),
    text(pair('      P.Unit', 'Importe', width)),
    separator(width),
  );

  input.lines.forEach((line) => {
    const prefix = `${line.qty}x `;
    const wrappedName = wrapText(line.name, Math.max(10, width - prefix.length));
    const first = wrappedName.shift() || '';
    nodes.push(text(`${prefix}${first}`));
    wrappedName.forEach((chunk) => nodes.push(text(`${' '.repeat(prefix.length)}${chunk}`)));
    nodes.push(text(pair(`      ${money(line.unitPriceCents)}`, money(line.unitPriceCents * line.qty), width)));
    nodes.push(feed(1));
  });

  nodes.push(
    separator(width),
    text(pair('TOTAL', money(input.totalCents), width), { em: true }),
    text(pair('METODO', formatPaymentMethod(input.metodoPago), width)),
    text(pair('RECIBIDO', money(input.pagoRecibidoCents), width)),
    text(pair('CAMBIO', money(input.cambioCents), width)),
    feed(2),
  );

  if (input.config.epsonOpenDrawer) {
    nodes.push(pulse('drawer_1'));
  }
  if (input.config.epsonCut) {
    nodes.push(cut('feed'));
  }

  return eposDocument(nodes);
}
