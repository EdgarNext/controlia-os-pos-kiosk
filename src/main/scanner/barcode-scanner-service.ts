import fs from 'node:fs';
import { SerialPort } from 'serialport';
import type { ScannerReading } from '../../shared/scanner';

const BAUD_RATE = 9600;
const RECONNECT_DELAY_MS = 2000;
const FLUSH_DELAY_MS = 40;

export class BarcodeScannerService {
  private port: SerialPort | null = null;
  private buffer = Buffer.alloc(0);
  private flushTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly onReading: (reading: ScannerReading) => void) {}

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.clearFlushTimer();
    const current = this.port;
    this.port = null;
    if (current) {
      try {
        current.removeAllListeners();
        if (current.isOpen) current.close();
      } catch {
        // best effort shutdown
      }
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.port) return;

    const path = await this.pickPortPath();
    if (!path) {
      this.scheduleReconnect();
      return;
    }

    const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
    this.port = port;

    port.open((error) => {
      if (!error) return;
      this.port = null;
      this.scheduleReconnect();
    });

    port.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.clearFlushTimer();
      this.flushTimer = setTimeout(() => {
        const code = this.buffer.toString().replace(/[\r\n\t]+/g, '').trim();
        this.buffer = Buffer.alloc(0);
        if (!code) return;
        this.onReading({
          code,
          receivedAt: new Date().toISOString(),
        });
      }, FLUSH_DELAY_MS);
    });

    port.on('close', () => {
      this.clearFlushTimer();
      this.buffer = Buffer.alloc(0);
      this.port = null;
      if (!this.stopped) this.scheduleReconnect();
    });

    port.on('error', () => {
      try {
        if (port.isOpen) port.close();
      } catch {
        // force close path if available
      }
    });
  }

  private async pickPortPath(): Promise<string | null> {
    try {
      if (process.platform === 'win32') {
        const ports = await SerialPort.list();
        const candidates = ports
          .filter((port) => {
            const path = (port.path || '').toUpperCase();
            if (!/^COM\d+$/.test(path)) return false;
            const metadata = [
              port.manufacturer,
              port.friendlyName,
              port.pnpId,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            const looksLikeUsbSerial =
              Boolean(port.vendorId && port.productId) ||
              /(usb|cdc|ch340|ftdi|cp210|silicon labs|prolific)/.test(metadata);
            return looksLikeUsbSerial;
          })
          .map((port) => port.path)
          .filter(Boolean)
          .sort((a, b) => {
            const aNum = Number.parseInt(a.replace(/^COM/i, ''), 10);
            const bNum = Number.parseInt(b.replace(/^COM/i, ''), 10);
            return aNum - bNum;
          });

        return candidates[0] || null;
      }

      const devMatch = fs
        .readdirSync('/dev')
        .filter((entry) => entry.startsWith('ttyACM') || entry.startsWith('ttyUSB'))
        .sort();

      if (devMatch.length) return `/dev/${devMatch[0]}`;

      const ports = await SerialPort.list();
      const listedDev = ports
        .map((port) => port.path)
        .filter((path): path is string => Boolean(path))
        .filter((path) => path.startsWith('/dev/ttyACM') || path.startsWith('/dev/ttyUSB'))
        .sort();

      return listedDev[0] || null;
    } catch {
      return null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private clearReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }
}
