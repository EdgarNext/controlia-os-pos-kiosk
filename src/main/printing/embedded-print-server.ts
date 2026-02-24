import http, { IncomingMessage, ServerResponse } from 'node:http';
import { PrintService } from './print-service';
import type { PrintV2Request } from '../../shared/print-v2';

interface EmbeddedPrintServerOptions {
  host?: string;
  port?: number;
}

export function createEmbeddedPrintServer(
  printService: PrintService,
  options: EmbeddedPrintServerOptions = {},
): http.Server {
  const host = options.host || '127.0.0.1';
  const port = options.port || 7777;

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, printService);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.info(`[embedded-print-server] listening on http://${host}:${port}`);
  });

  server.on('error', (error) => {
    // eslint-disable-next-line no-console
    console.error('[embedded-print-server] failed to start', error);
  });

  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  printService: PrintService,
): Promise<void> {
  if (req.method === 'OPTIONS' && req.url === '/print') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/print') {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  const body = await readJsonBody(req);
  const rawBase64 = typeof body?.rawBase64 === 'string' ? body.rawBase64 : '';
  const jobName = typeof body?.jobName === 'string' ? body.jobName : undefined;

  if (!rawBase64) {
    sendJson(res, 400, { ok: false, error: 'rawBase64 required' });
    return;
  }

  const request: PrintV2Request = { rawBase64, jobName };
  const result = await printService.printV2(request);

  if (!result.ok) {
    sendJson(res, 502, { ok: false, error: result.error || 'Print error' });
    return;
  }

  sendJson(res, 200, { ok: true, jobId: result.jobId });
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  setCors(res);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
