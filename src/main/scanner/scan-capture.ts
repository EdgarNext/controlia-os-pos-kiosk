import type { BrowserWindow, Event, Input } from 'electron';
import type {
  HidScanPayload,
  HidScannerSettings,
  ScanCaptureDebugState,
  ScanCaptureLogEntry,
  ScanContext,
  ScannerReading,
} from '../../shared/scanner';

const DEFAULT_SETTINGS: HidScannerSettings = {
  minCodeLen: 6,
  maxCodeLen: 64,
  maxInterKeyMsScan: 35,
  scanEndGapMs: 80,
  humanKeyGapMs: 100,
  allowEnterTerminator: true,
  allowedCharsPattern: '[0-9A-Za-z\\-_.]',
};

const ENTER_KEYS = new Set(['Enter', 'NumpadEnter']);
const LOG_RING_SIZE = 200;
const SCAN_RING_SIZE = 50;

interface ScanCaptureLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info?(message: string, data?: Record<string, unknown>): void;
  warn?(message: string, data?: Record<string, unknown>): void;
}

interface CreateScanCaptureInput {
  win: BrowserWindow;
  settingsProvider?: () => Partial<HidScannerSettings>;
  logger?: ScanCaptureLogger;
  onScan?: (payload: HidScanPayload) => void;
}

interface ScanCaptureApi {
  enable(): void;
  disable(): void;
  setContext(input: Partial<ScanContext>): ScanContext;
  updateSettings(partial: Partial<HidScannerSettings>): HidScannerSettings;
  getDebugState(): ScanCaptureDebugState;
  destroy(): void;
}

export function createScanCapture(input: CreateScanCaptureInput): ScanCaptureApi {
  const logger = input.logger ?? createConsoleLogger();
  let settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...(input.settingsProvider?.() || {}) });

  let enabled = true;
  let context: ScanContext = { enabled: true, mode: 'sale', selectedProductId: null };
  let buffer = '';
  let scanModeActive = false;
  let startedAt = 0;
  let lastKeyAt = 0;
  let interKeyGaps: number[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  const recentScans: ScannerReading[] = [];
  const logs: ScanCaptureLogEntry[] = [];

  const writeLog = (
    level: ScanCaptureLogEntry['level'],
    message: string,
    data?: Record<string, unknown>,
  ): void => {
    logs.push({ level, message, ts: new Date().toISOString(), data });
    if (logs.length > LOG_RING_SIZE) logs.shift();
    if (level === 'warn' && logger.warn) {
      logger.warn(message, data);
      return;
    }
    if (level === 'info' && logger.info) {
      logger.info(message, data);
      return;
    }
    logger.debug(message, data);
  };

  const resetBuffer = (): void => {
    buffer = '';
    scanModeActive = false;
    startedAt = 0;
    lastKeyAt = 0;
    interKeyGaps = [];
    clearFlushTimer();
  };

  const clearFlushTimer = (): void => {
    if (!flushTimer) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  };

  const armFlushTimer = (): void => {
    clearFlushTimer();
    flushTimer = setTimeout(() => {
      finalizeScan('gap-timeout');
    }, settings.scanEndGapMs);
  };

  const emitScan = (code: string, reason: string): void => {
    const payload: HidScanPayload = {
      code,
      source: 'hid',
      receivedAt: new Date().toISOString(),
      meta: {
        reason,
        durationMs: startedAt > 0 ? Date.now() - startedAt : 0,
        averageInterKeyMs: averageInterKeyMs(interKeyGaps),
        contextMode: context.mode,
      },
    };
    recentScans.push(payload);
    if (recentScans.length > SCAN_RING_SIZE) recentScans.shift();
    writeLog('info', 'scan emitted', {
      code,
      reason,
      len: code.length,
      contextMode: context.mode,
    });
    input.onScan?.(payload);
  };

  const finalizeScan = (reason: string): void => {
    if (!buffer) {
      resetBuffer();
      return;
    }

    const code = buffer;
    const avgGap = averageInterKeyMs(interKeyGaps);
    const validLen = code.length >= settings.minCodeLen && code.length <= settings.maxCodeLen;
    const scanLike = scanModeActive || (avgGap !== null && avgGap <= settings.maxInterKeyMsScan);

    if (validLen && scanLike) {
      emitScan(code, reason);
    } else {
      writeLog('debug', 'scan discarded', {
        reason,
        codeLen: code.length,
        avgGap,
        scanModeActive,
      });
    }

    resetBuffer();
  };

  const onBeforeInputEvent = (event: Event, rawInput: Input): void => {
    if (!enabled || !context.enabled || context.mode === 'disabled') return;
    if (rawInput.type !== 'keyDown') return;
    if (rawInput.isAutoRepeat) return;

    const key = String(rawInput.key || '');
    if (!key) return;

    if (settings.allowEnterTerminator && ENTER_KEYS.has(key)) {
      if (scanModeActive && buffer.length >= settings.minCodeLen) {
        event.preventDefault();
        finalizeScan('enter');
      }
      return;
    }

    if (rawInput.control || rawInput.alt || rawInput.meta) {
      if (scanModeActive) event.preventDefault();
      return;
    }

    if (key.length !== 1) {
      if (scanModeActive) event.preventDefault();
      return;
    }

    const now = Date.now();
    const gap = lastKeyAt ? now - lastKeyAt : 0;

    if (lastKeyAt && gap > settings.humanKeyGapMs) {
      finalizeScan('human-gap-reset');
    }

    if (buffer.length >= settings.maxCodeLen) {
      finalizeScan('max-len-reached');
    }

    if (!isAllowedChar(key, settings.allowedCharsPattern)) {
      if (scanModeActive) {
        event.preventDefault();
        finalizeScan('invalid-char');
      }
      return;
    }

    if (!startedAt) {
      startedAt = now;
      writeLog('debug', 'scan candidate started', { firstKey: key, mode: context.mode });
    }

    if (lastKeyAt && gap > 0) {
      interKeyGaps.push(gap);
    }

    buffer += key;
    lastKeyAt = now;

    if (!scanModeActive) {
      const avg = averageInterKeyMs(interKeyGaps);
      const qualifiesBySpeed = avg !== null && avg <= settings.maxInterKeyMsScan;
      const qualifiesByBurst = buffer.length >= 4 && (avg ?? settings.maxInterKeyMsScan + 1) <= settings.maxInterKeyMsScan;
      scanModeActive = qualifiesBySpeed || qualifiesByBurst;
      if (scanModeActive) {
        writeLog('debug', 'scan mode activated', {
          len: buffer.length,
          avgInterKeyMs: avg,
          mode: context.mode,
        });
      }
    }

    if (scanModeActive) {
      // Consume scanner keys to avoid mutating focused inputs and firing shortcuts while scanning.
      event.preventDefault();
    }

    armFlushTimer();
  };

  input.win.webContents.on('before-input-event', onBeforeInputEvent);

  return {
    enable(): void {
      enabled = true;
      writeLog('debug', 'capture enabled');
    },
    disable(): void {
      enabled = false;
      resetBuffer();
      writeLog('debug', 'capture disabled');
    },
    setContext(nextInput: Partial<ScanContext>): ScanContext {
      context = {
        ...context,
        ...nextInput,
      };
      if (typeof nextInput.enabled === 'boolean' && !nextInput.enabled) {
        resetBuffer();
      }
      writeLog('debug', 'context updated', {
        enabled: context.enabled,
        mode: context.mode,
        selectedProductId: context.selectedProductId || null,
      });
      return context;
    },
    updateSettings(partial: Partial<HidScannerSettings>): HidScannerSettings {
      settings = normalizeSettings({
        ...settings,
        ...partial,
      });
      writeLog('debug', 'settings updated', {
        minCodeLen: settings.minCodeLen,
        maxCodeLen: settings.maxCodeLen,
        maxInterKeyMsScan: settings.maxInterKeyMsScan,
        scanEndGapMs: settings.scanEndGapMs,
      });
      return settings;
    },
    getDebugState(): ScanCaptureDebugState {
      return {
        enabled,
        context,
        scanModeActive,
        buffer,
        averageInterKeyMs: averageInterKeyMs(interKeyGaps),
        settings,
        recentScans: [...recentScans],
        logs: [...logs],
      };
    },
    destroy(): void {
      input.win.webContents.removeListener('before-input-event', onBeforeInputEvent);
      resetBuffer();
    },
  };
}

function normalizeSettings(settings: Partial<HidScannerSettings>): HidScannerSettings {
  return {
    minCodeLen: clampInt(settings.minCodeLen, 1, 128, DEFAULT_SETTINGS.minCodeLen),
    maxCodeLen: clampInt(settings.maxCodeLen, 4, 256, DEFAULT_SETTINGS.maxCodeLen),
    maxInterKeyMsScan: clampInt(settings.maxInterKeyMsScan, 5, 500, DEFAULT_SETTINGS.maxInterKeyMsScan),
    scanEndGapMs: clampInt(settings.scanEndGapMs, 20, 1000, DEFAULT_SETTINGS.scanEndGapMs),
    humanKeyGapMs: clampInt(settings.humanKeyGapMs, 40, 2000, DEFAULT_SETTINGS.humanKeyGapMs),
    allowEnterTerminator: Boolean(settings.allowEnterTerminator ?? DEFAULT_SETTINGS.allowEnterTerminator),
    allowedCharsPattern:
      typeof settings.allowedCharsPattern === 'string' && settings.allowedCharsPattern.trim()
        ? settings.allowedCharsPattern.trim()
        : DEFAULT_SETTINGS.allowedCharsPattern,
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function isAllowedChar(char: string, pattern: string): boolean {
  try {
    const re = new RegExp(`^${pattern}$`);
    return re.test(char);
  } catch {
    return /^[0-9A-Za-z\-_.]$/.test(char);
  }
}

function averageInterKeyMs(samples: number[]): number | null {
  if (!samples.length) return null;
  const sum = samples.reduce((acc, value) => acc + value, 0);
  return Math.round((sum / samples.length) * 100) / 100;
}

function createConsoleLogger(): ScanCaptureLogger {
  return {
    debug(message, data) {
      if (process.env.NODE_ENV !== 'production' || process.env.ELECTRON_SCAN_DEBUG === '1') {
        // eslint-disable-next-line no-console
        console.debug(`[scan-capture] ${message}`, data || '');
      }
    },
    info(message, data) {
      // eslint-disable-next-line no-console
      console.info(`[scan-capture] ${message}`, data || '');
    },
    warn(message, data) {
      // eslint-disable-next-line no-console
      console.warn(`[scan-capture] ${message}`, data || '');
    },
  };
}
