import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { PrintConfig } from '../../shared/print-v2';
import { cut, eposDocument, feed, image, pulse, text } from './epos-xml-builder';
import { buildSaleTicketLayout } from './kiosk-ticket-layout';

type KioskTicketLine = {
  name: string;
  qty: number;
  unitPriceCents: number;
};

type RenderKioskTicketInput = {
  headerTitle?: string | null;
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

function lineWidth(config: PrintConfig): number {
  return config.epsonPaperWidthMm === 58 ? 32 : 42;
}

type CachedLogo = {
  filePath: string;
  fileMtimeMs: number;
  width: number;
  height: number;
  base64Raster: string;
} | null;

let cachedLogo: CachedLogo = null;

function resolveTicketLogoPath(): string | null {
  const appPath = app.getAppPath();
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'assets', 'ticket-logo.png')]
    : [
        path.join(appPath, 'assets', 'ticket-logo.png'),
        path.join(process.cwd(), 'assets', 'ticket-logo.png'),
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildMonochromeRaster(bitmap: Buffer, width: number, height: number): string {
  const byteWidth = Math.ceil(width / 8);
  const raster = Buffer.alloc(byteWidth * height, 0x00);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4;
      const blue = bitmap[pixelIndex] || 0;
      const green = bitmap[pixelIndex + 1] || 0;
      const red = bitmap[pixelIndex + 2] || 0;
      const alpha = bitmap[pixelIndex + 3] || 0;
      const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
      const isDark = alpha > 16 && luminance < 210;
      if (!isDark) continue;
      const byteIndex = y * byteWidth + Math.floor(x / 8);
      raster[byteIndex] |= 0x80 >> (x % 8);
    }
  }

  return raster.toString('base64');
}

function getTicketLogo(config: PrintConfig): CachedLogo {
  const filePath = resolveTicketLogoPath();
  if (!filePath) return null;

  const stats = fs.statSync(filePath);
  if (cachedLogo && cachedLogo.filePath === filePath && cachedLogo.fileMtimeMs === stats.mtimeMs) {
    return cachedLogo;
  }

  const targetWidth = config.epsonPaperWidthMm === 58 ? 256 : 320;
  const imageSource = nativeImage.createFromPath(filePath);
  if (imageSource.isEmpty()) return null;

  const resized = imageSource.resize({ width: targetWidth, quality: 'good' });
  const size = resized.getSize();
  const paddedWidth = Math.ceil(size.width / 8) * 8;
  const finalImage =
    paddedWidth === size.width ? resized : resized.resize({ width: paddedWidth, height: size.height, quality: 'good' });
  const finalSize = finalImage.getSize();
  const base64Raster = buildMonochromeRaster(finalImage.toBitmap(), finalSize.width, finalSize.height);

  cachedLogo = {
    filePath,
    fileMtimeMs: stats.mtimeMs,
    width: finalSize.width,
    height: finalSize.height,
    base64Raster,
  };
  return cachedLogo;
}

export function renderKioskTicketEposXml(input: RenderKioskTicketInput): string {
  const layout = buildSaleTicketLayout({
    headerTitle: input.headerTitle,
    lines: input.lines,
    totalCents: input.totalCents,
    pagoRecibidoCents: input.pagoRecibidoCents,
    cambioCents: input.cambioCents,
    metodoPago: input.metodoPago,
    folioText: input.folioText,
    createdAtIso: input.createdAtIso,
    isReprint: input.isReprint,
    width: lineWidth(input.config),
  });
  const nodes: string[] = [text(layout.headerTitle, { align: 'center', em: true, smooth: true })];
  const logo = getTicketLogo(input.config);

  if (logo) {
    nodes.length = 0;
    nodes.push(image(logo.base64Raster, { width: logo.width, height: logo.height, align: 'center', mode: 'mono' }));
    nodes.push(feed(1));
    nodes.push(text(layout.headerTitle, { align: 'center', em: true, smooth: true }));
  }

  if (layout.headerSubtitle) {
    nodes.push(text(layout.headerSubtitle, { align: 'center' }));
  }

  nodes.push(text(layout.ticketLabel, { align: 'center' }), feed(1));
  layout.metaLines.forEach((line) => nodes.push(text(line)));
  layout.columnHeaderLines.forEach((line) => nodes.push(text(line)));
  layout.itemLines.forEach((line) => nodes.push(text(line)));
  layout.summaryLines.forEach((line, index) => {
    nodes.push(text(line, index === 1 ? { em: true } : undefined));
  });
  layout.footerLines.forEach((line) => nodes.push(text(line, { align: 'center' })));
  nodes.push(feed(2));

  if (input.config.epsonOpenDrawer) {
    nodes.push(pulse('drawer_1'));
  }
  if (input.config.epsonCut) {
    nodes.push(cut('feed'));
  }

  return eposDocument(nodes);
}
