import type {
  EpsonPrinterStatusView,
  PrintConfig,
  PrinterConnectionResult,
} from '../../shared/print-v2';
import { cut, eposDocument, feed, separator, text } from './epos-xml-builder';

type EpsonEposResponse = {
  success: boolean;
  code: string | null;
  status: number | null;
  battery: number | null;
  rawXml: string;
};

const STATUS_FLAGS = {
  NO_RESPONSE: 0x00000001,
  OFFLINE: 0x00000008,
  COVER_OPEN: 0x00000020,
  MECHANICAL_ERROR: 0x00000400,
  CUTTER_ERROR: 0x00000800,
  UNRECOVERABLE: 0x00002000,
  AUTO_RECOVERY: 0x00004000,
  PAPER_NEAR_END: 0x00020000,
  PAPER_END: 0x00080000,
} as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSoapEnvelope(xml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${xml}</s:Body></s:Envelope>`;
}

export function buildEpsonEndpoint(config: PrintConfig): string {
  const protocol = config.epsonUseHttps ? 'https' : 'http';
  return `${protocol}://${config.epsonHost}:${config.epsonPort}/cgi-bin/epos/service.cgi?devid=${encodeURIComponent(config.epsonDeviceId)}&timeout=${encodeURIComponent(String(config.epsonTimeoutMs))}`;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseResponseXml(rawXml: string): EpsonEposResponse {
  const match = rawXml.match(/<response\b([^>]*)\/?>/i);
  if (!match) {
    throw new Error('La impresora respondió con XML sin <response>.');
  }

  const attrText = match[1] || '';
  const readAttribute = (name: string): string | null => {
    const attrMatch = attrText.match(new RegExp(`${escapeRegex(name)}="([^"]*)"`, 'i'));
    return attrMatch?.[1] ?? null;
  };

  const successValue = readAttribute('success');
  return {
    success: successValue === 'true' || successValue === '1',
    code: readAttribute('code'),
    status: parseInteger(readAttribute('status') ?? undefined),
    battery: parseInteger(readAttribute('battery') ?? undefined),
    rawXml,
  };
}

function mapStatus(parsed: EpsonEposResponse, checkedAt: string): EpsonPrinterStatusView {
  const status = parsed.status ?? 0;
  const code = parsed.code ?? '';

  const create = (
    state: EpsonPrinterStatusView['state'],
    label: string,
    message: string,
    isOnline: boolean,
  ): EpsonPrinterStatusView => ({
    state,
    label,
    message,
    checkedAt,
    success: parsed.success,
    code: parsed.code,
    status: parsed.status,
    battery: parsed.battery,
    isOnline,
  });

  if (code === 'EPTR_REC_EMPTY' || (status & STATUS_FLAGS.PAPER_END) !== 0) {
    return create('paper_end', 'Sin papel', 'No hay papel en la impresora.', false);
  }
  if (code === 'EPTR_COVER_OPEN' || (status & STATUS_FLAGS.COVER_OPEN) !== 0) {
    return create('cover_open', 'Tapa abierta', 'Cierra la tapa de la impresora.', false);
  }
  if (code === 'EPTR_CUTTER' || (status & STATUS_FLAGS.CUTTER_ERROR) !== 0) {
    return create('cutter_error', 'Error de corte', 'Revisa cutter y papel antes de intentar de nuevo.', false);
  }
  if (code === 'EPTR_MECHANICAL' || (status & STATUS_FLAGS.MECHANICAL_ERROR) !== 0) {
    return create('mechanical_error', 'Error mecánico', 'La impresora reporta un error mecánico.', false);
  }
  if (
    code === 'EX_TIMEOUT' ||
    code === 'EX_BADPORT' ||
    code === 'EX_ENPC_TIMEOUT' ||
    code === 'DeviceNotFound' ||
    (status & STATUS_FLAGS.NO_RESPONSE) !== 0
  ) {
    return create('no_response', 'Sin respuesta', 'No hubo respuesta de la impresora en el tiempo configurado.', false);
  }
  if ((status & STATUS_FLAGS.OFFLINE) !== 0) {
    return create('offline', 'Offline', 'La impresora está offline o no lista para imprimir.', false);
  }
  if ((status & STATUS_FLAGS.PAPER_NEAR_END) !== 0) {
    return create('paper_near_end', 'Papel por agotarse', 'La impresora sigue operativa, pero el papel está por terminarse.', true);
  }
  if (
    code === 'EPTR_AUTOMATICAL' ||
    code === 'EPTR_UNRECOVERABLE' ||
    (status & STATUS_FLAGS.UNRECOVERABLE) !== 0 ||
    (status & STATUS_FLAGS.AUTO_RECOVERY) !== 0
  ) {
    return create('unknown', 'Error desconocido', 'La impresora reportó un error que requiere revisión manual.', false);
  }
  if (parsed.success) {
    return create('ready', 'Lista', 'La impresora respondió correctamente.', true);
  }
  return create('unknown', 'Error desconocido', 'La impresora respondió, pero no fue posible clasificar el estado.', false);
}

export class EpsonEposClient {
  async checkStatus(config: PrintConfig): Promise<PrinterConnectionResult> {
    const checkedAt = new Date().toISOString();
    const endpoint = buildEpsonEndpoint(config);

    try {
      const response = await this.postPrintDocument(config, eposDocument([]));
      const status = mapStatus(response, checkedAt);
      return {
        ok: status.state === 'ready' || status.state === 'paper_near_end',
        checkedAt,
        endpoint,
        message: status.message,
        status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible consultar la impresora.';
      return {
        ok: false,
        checkedAt,
        endpoint,
        message,
        status: {
          state: 'no_response',
          label: 'Sin respuesta',
          message,
          checkedAt,
          success: false,
          code: null,
          status: null,
          battery: null,
          isOnline: false,
        },
      };
    }
  }

  async printXml(config: PrintConfig, xml: string): Promise<PrinterConnectionResult> {
    const checkedAt = new Date().toISOString();
    const endpoint = buildEpsonEndpoint(config);

    try {
      const response = await this.postPrintDocument(config, xml);
      const status = mapStatus(response, checkedAt);
      return {
        ok: status.state === 'ready' || status.state === 'paper_near_end',
        checkedAt,
        endpoint,
        message: status.message,
        status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible enviar el trabajo a la impresora.';
      return {
        ok: false,
        checkedAt,
        endpoint,
        message,
        status: {
          state: 'no_response',
          label: 'Sin respuesta',
          message,
          checkedAt,
          success: false,
          code: null,
          status: null,
          battery: null,
          isOnline: false,
        },
      };
    }
  }

  async testPrint(config: PrintConfig): Promise<PrinterConnectionResult> {
    const checkedAt = new Date().toISOString();
    const copies = Math.max(1, config.epsonCopies);
    const nodes: string[] = [];

    for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
      nodes.push(
        text('POS KIOSK', { align: 'center', em: true, width: 2, height: 2, lang: 'en', smooth: true }),
        text('Prueba de impresion', { align: 'center', lang: 'es' }),
        feed(1),
        text(`Fecha: ${new Date(checkedAt).toLocaleString('es-MX')}`),
        text(`IP / Host: ${config.epsonHost}`),
        text(`Device ID: ${config.epsonDeviceId}`),
        separator(config.epsonPaperWidthMm === 58 ? 24 : 32),
        text('Si puedes leer esto, la impresora está configurada.'),
        feed(2),
      );

      if (config.epsonCut) {
        nodes.push(cut('feed'));
      }
    }

    return this.printXml(config, eposDocument(nodes));
  }

  async printDebugText(config: PrintConfig, content: string, includeDebugFooter: boolean): Promise<PrinterConnectionResult> {
    const footer = includeDebugFooter
      ? [
          '--------------------',
          `ts=${new Date().toISOString()}`,
          `device=${config.epsonDeviceId}`,
          `host=${config.epsonHost}:${config.epsonPort}`,
        ]
      : [];
    const nodes = [...content.split(/\r?\n/g).map((line) => text(line || ' ')), ...footer.map((line) => text(line)), feed(2)];
    if (config.epsonCut) {
      nodes.push(cut('feed'));
    }
    return this.printXml(config, eposDocument(nodes));
  }

  private async postPrintDocument(config: PrintConfig, xml: string): Promise<EpsonEposResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.epsonTimeoutMs);

    try {
      const response = await fetch(buildEpsonEndpoint(config), {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT',
          SOAPAction: '""',
        },
        body: getSoapEnvelope(xml),
        signal: controller.signal,
      });

      const rawXml = await response.text();
      if (!response.ok) {
        throw new Error(rawXml || `La impresora respondió HTTP ${response.status}.`);
      }
      return parseResponseXml(rawXml);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Timeout consultando impresora Epson.');
      }
      throw error instanceof Error ? error : new Error('No fue posible conectar con la impresora Epson.');
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
