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
    this.connect();
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

  private connect(): void {
    if (this.stopped || this.port) return;

    const path = this.pickPortPath();
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

  private pickPortPath(): string | null {
    try {
      const match = fs
        .readdirSync('/dev')
        .filter((entry) => entry.startsWith('ttyACM'))
        .sort();

      if (!match.length) return null;
      return `/dev/${match[0]}`;
    } catch {
      return null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
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

