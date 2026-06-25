type TicketLine = {
  name: string;
  qty: number;
  unitPriceCents: number;
  itemType?: string | null;
};

type BuildSaleTicketLayoutInput = {
  headerTitle?: string | null;
  lines: TicketLine[];
  totalCents: number;
  pagoRecibidoCents: number;
  cambioCents: number;
  metodoPago: string;
  folioText?: string;
  createdAtIso?: string;
  isReprint?: boolean;
  width: number;
  splitFoodAndDrinksOnTicket?: boolean;
};

export type SaleTicketLayout = {
  headerTitle: string;
  headerSubtitle: string | null;
  ticketLabel: string;
  metaLines: string[];
  columnHeaderLines: string[];
  itemLines: string[];
  summaryLines: string[];
  footerLines: string[];
};

const BRAND_FOOTER_LINES = ['Operacion impecable, cada dia.', 'Powered by Controlia Digital'] as const;

function clampWidth(width: number): number {
  return Math.max(32, Math.min(48, Math.floor(width || 32)));
}

function separator(width: number): string {
  return '-'.repeat(clampWidth(width));
}

function money(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function pair(left: string, right: string, width: number): string {
  const safeWidth = clampWidth(width);
  if (left.length + right.length >= safeWidth) {
    return `${left}\n${right}`;
  }
  return `${left}${' '.repeat(safeWidth - left.length - right.length)}${right}`;
}

function truncateWithEllipsis(value: string, width: number): string {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (normalized.length <= width) return normalized;
  if (width <= 3) return normalized.slice(0, width);
  return `${normalized.slice(0, width - 3).trimEnd()}...`;
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

function isDrinkLine(itemType: string | null | undefined, name: string): boolean {
  const type = String(itemType || '').trim().toLowerCase();
  if (type) {
    if (/(bebida|drink|beverage|juice|soda|coffee|tea|agua|cerveza|beer|cocktail|refresco)/.test(type)) {
      return true;
    }
    if (/(food|meal|alimento|comida|snack|postre|dessert)/.test(type)) {
      return false;
    }
  }
  const normalizedName = String(name || '').trim().toLowerCase();
  return /(agua|cafe|café|te|té|jugo|juice|refresco|soda|cola|cerveza|beer|vino|wine|coctel|cocktail)/.test(
    normalizedName,
  );
}

function resolveHeaderTitle(rawTitle?: string | null): { title: string; subtitle: string | null } {
  const title = String(rawTitle || '').trim();
  if (!title) {
    return { title: 'KIOSK POS', subtitle: null };
  }
  return { title, subtitle: null };
}

function humanizeSlug(value: string): string {
  return value
    .split(/[-_.\s]+/g)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function formatItemLine(line: TicketLine, width: number): string {
  const safeWidth = clampWidth(width);
  const qtyLabel = `${line.qty}x`;
  const amount = money(line.unitPriceCents * line.qty);
  const amountWidth = Math.max(8, Math.min(10, amount.length + 1));
  const qtyWidth = 4;
  const productWidth = Math.max(8, safeWidth - qtyWidth - 1 - amountWidth);
  const product = truncateWithEllipsis(line.name, productWidth);
  return `${qtyLabel.padEnd(qtyWidth)} ${product.padEnd(productWidth)}${amount.padStart(amountWidth)}`;
}

function splitTicketLines(lines: TicketLine[], enabled: boolean, width: number): string[] {
  const formatted = lines.map((line) => ({
    text: formatItemLine(line, width),
    isDrink: isDrinkLine(line.itemType, line.name),
  }));

  if (!enabled) {
    return formatted.map((line) => line.text);
  }

  const foods = formatted.filter((line) => !line.isDrink).map((line) => line.text);
  const drinks = formatted.filter((line) => line.isDrink).map((line) => line.text);
  if (!foods.length || !drinks.length) {
    return formatted.map((line) => line.text);
  }

  return [...foods, separator(width), ...drinks];
}

export function resolveSaleTicketHeaderLabel(input: {
  kioskDisplayName?: string | null;
  tenantSlug?: string | null;
}): string | null {
  const kioskDisplayName = String(input.kioskDisplayName || '').trim();
  if (kioskDisplayName) return kioskDisplayName;

  const tenantSlug = String(input.tenantSlug || '').trim();
  if (tenantSlug) return humanizeSlug(tenantSlug);

  return null;
}

export function buildSaleTicketLayout(input: BuildSaleTicketLayoutInput): SaleTicketLayout {
  const width = clampWidth(input.width);
  const header = resolveHeaderTitle(input.headerTitle);

  return {
    headerTitle: header.title,
    headerSubtitle: header.subtitle,
    ticketLabel: input.isReprint ? 'REIMPRESION' : 'Ticket de venta',
    metaLines: [
      `Fecha: ${formatDateTimeMx(input.createdAtIso || new Date().toISOString())}`,
      input.folioText ? `Folio: ${input.folioText}` : '',
    ].filter(Boolean),
    columnHeaderLines: [
      separator(width),
      pair('Cant  Producto', 'Imp', width),
      separator(width),
    ],
    itemLines: splitTicketLines(input.lines, input.splitFoodAndDrinksOnTicket === true, width),
    summaryLines: [
      separator(width),
      pair('TOTAL', money(input.totalCents), width),
      `Metodo: ${formatPaymentMethod(input.metodoPago)}`,
      pair('Recibido', money(input.pagoRecibidoCents), width),
      pair('Cambio', money(input.cambioCents), width),
    ],
    footerLines: [...BRAND_FOOTER_LINES],
  };
}
