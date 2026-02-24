import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrintV2Request } from '../../shared/print-v2';
import type { PrintTransport } from './print-transport';
import { PrintJobsRepository } from './print-jobs-repository';

const execFileAsync = promisify(execFile);

export class NativeV2Transport implements PrintTransport {
  constructor(private readonly jobsRepository: PrintJobsRepository) {}

  async send(request: PrintV2Request): Promise<void> {
    const rawBuffer = Buffer.from(String(request.rawBase64), 'base64');
    if (!rawBuffer.length) {
      throw new Error('Invalid rawBase64 payload');
    }

    if (process.platform === 'linux') {
      await this.sendLinux(rawBuffer, request.jobName);
      return;
    }

    if (process.platform === 'win32') {
      await this.sendWindows(rawBuffer);
      return;
    }

    throw new Error(`Platform not supported for native print: ${process.platform}`);
  }

  private async sendLinux(rawBuffer: Buffer, jobName?: string): Promise<void> {
    const config = this.jobsRepository.getPrintConfig();
    const tmpPath = await this.writeTempFile(rawBuffer);

    try {
      const args = ['-d', config.linuxPrinterName, '-o', 'raw'];
      if (jobName) {
        args.push('-t', String(jobName));
      }
      args.push(tmpPath);

      await execFileAsync('lp', args, { encoding: 'utf8' });
    } catch (error) {
      throw this.normalizeExecError(error, 'lp failed');
    } finally {
      await this.safeUnlink(tmpPath);
    }
  }

  private async sendWindows(rawBuffer: Buffer): Promise<void> {
    const config = this.jobsRepository.getPrintConfig();
    const tmpPath = await this.writeTempFile(rawBuffer);

    try {
      await execFileAsync(
        'cmd.exe',
        ['/c', 'copy', '/b', tmpPath, config.windowsPrinterShare],
        { encoding: 'utf8', windowsHide: true },
      );
    } catch (error) {
      throw this.normalizeExecError(error, 'copy failed');
    } finally {
      await this.safeUnlink(tmpPath);
    }
  }

  private async writeTempFile(rawBuffer: Buffer): Promise<string> {
    const tmpName = `kiosk-print-${randomBytes(6).toString('hex')}.bin`;
    const tmpPath = path.join(os.tmpdir(), tmpName);
    await fs.writeFile(tmpPath, rawBuffer);
    return tmpPath;
  }

  private async safeUnlink(tmpPath: string): Promise<void> {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // cleanup best effort
    }
  }

  private normalizeExecError(error: unknown, fallback: string): Error {
    if (error && typeof error === 'object') {
      const err = error as { stderr?: string; stdout?: string; message?: string };
      const message = (err.stderr || err.stdout || err.message || fallback).trim();
      return new Error(message || fallback);
    }
    return new Error(fallback);
  }
}
