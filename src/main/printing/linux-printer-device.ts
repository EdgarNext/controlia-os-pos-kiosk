import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import type { FileHandle } from 'node:fs/promises';
import type { PrinterDeviceStat, PrinterDiagnostics } from '../../shared/print-v2';

export const DEFAULT_LINUX_PRINTER_DEVICE_PATH = '/dev/pos58';

const PASSWD_PATH = '/etc/passwd';
const GROUP_PATH = '/etc/group';

function formatMode(mode: number): string {
  return `0${(mode & 0o777).toString(8).padStart(3, '0')}`;
}

async function readIdNameMaps(): Promise<{ usersByUid: Map<number, string>; groupsByGid: Map<number, string> }> {
  const usersByUid = new Map<number, string>();
  const groupsByGid = new Map<number, string>();

  try {
    const passwd = await fs.readFile(PASSWD_PATH, 'utf8');
    passwd.split('\n').forEach((line) => {
      if (!line || line.startsWith('#')) return;
      const parts = line.split(':');
      if (parts.length < 4) return;
      const uid = Number(parts[2]);
      if (Number.isInteger(uid)) usersByUid.set(uid, parts[0]);
    });
  } catch {
    // best effort
  }

  try {
    const groups = await fs.readFile(GROUP_PATH, 'utf8');
    groups.split('\n').forEach((line) => {
      if (!line || line.startsWith('#')) return;
      const parts = line.split(':');
      if (parts.length < 3) return;
      const gid = Number(parts[2]);
      if (Number.isInteger(gid)) groupsByGid.set(gid, parts[0]);
    });
  } catch {
    // best effort
  }

  return { usersByUid, groupsByGid };
}

async function statDevice(devicePath: string): Promise<PrinterDeviceStat> {
  try {
    const stat = await fs.stat(devicePath);
    let writable = false;
    try {
      await fs.access(devicePath, fsConstants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }

    const { usersByUid, groupsByGid } = await readIdNameMaps();
    const owner = usersByUid.get(stat.uid) || String(stat.uid);
    const group = groupsByGid.get(stat.gid) || String(stat.gid);

    return {
      path: devicePath,
      exists: true,
      writable,
      owner,
      group,
      mode: formatMode(stat.mode),
      error: null,
    };
  } catch (error) {
    return {
      path: devicePath,
      exists: false,
      writable: false,
      owner: null,
      group: null,
      mode: null,
      error: error instanceof Error ? error.message : 'no_stat',
    };
  }
}

async function detectUsbLpDevicePaths(): Promise<string[]> {
  try {
    const entries = await fs.readdir('/dev/usb');
    return entries
      .filter((entry) => /^lp\d+$/.test(entry))
      .map((entry) => `/dev/usb/${entry}`)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function resolveLinuxPrinterDevicePath(configuredPathRaw: string | null | undefined): Promise<string> {
  const configuredPath = String(configuredPathRaw || '').trim() || DEFAULT_LINUX_PRINTER_DEVICE_PATH;
  try {
    await fs.access(configuredPath, fsConstants.F_OK);
    return configuredPath;
  } catch {
    const usbPaths = await detectUsbLpDevicePaths();
    if (usbPaths.length > 0) return usbPaths[0];
  }

  throw new Error(
    `No Linux printer device found. Checked ${configuredPath} and /dev/usb/lp*. Install udev rule 99-pos58-thermal.rules, ensure symlink /dev/pos58 exists, add your user to group posprint, then re-login.`,
  );
}

export async function writeBufferToLinuxPrinterDevice(buffer: Buffer, configuredPathRaw: string | null | undefined): Promise<string> {
  const devicePath = await resolveLinuxPrinterDevicePath(configuredPathRaw);

  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(devicePath, 'w');
    await handle.write(buffer, 0, buffer.length, null);
    return devicePath;
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `Permission denied writing to ${devicePath}. Add current user to group posprint and re-login; install udev rule 99-pos58-thermal.rules; verify with: ls -l ${devicePath}`,
      );
    }
    throw error instanceof Error ? error : new Error('Linux direct print write failed');
  } finally {
    if (handle) await handle.close();
  }
}

export async function getLinuxPrinterDiagnostics(configuredPathRaw: string | null | undefined): Promise<PrinterDiagnostics> {
  const configuredPath = String(configuredPathRaw || '').trim() || DEFAULT_LINUX_PRINTER_DEVICE_PATH;
  const userInfo = os.userInfo();
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const gid = typeof process.getgid === 'function' ? process.getgid() : null;
  const gids = typeof process.getgroups === 'function' ? process.getgroups() : [];
  const { groupsByGid } = await readIdNameMaps();
  const groupNames = gids.map((groupId) => groupsByGid.get(groupId) || String(groupId));

  const pos58 = await statDevice(DEFAULT_LINUX_PRINTER_DEVICE_PATH);
  const usbPaths = await detectUsbLpDevicePaths();
  const usbLpDevices = await Promise.all(usbPaths.map((path) => statDevice(path)));

  let resolvedDevicePath: string | null = null;
  const notes: string[] = [];
  try {
    resolvedDevicePath = await resolveLinuxPrinterDevicePath(configuredPath);
  } catch (error) {
    notes.push(error instanceof Error ? error.message : 'Unable to resolve Linux printer device path.');
  }

  if (!groupNames.includes('posprint')) {
    notes.push('Current user is not in group posprint.');
  }
  if (!pos58.exists) {
    notes.push('Symlink /dev/pos58 is missing.');
  }
  if (!resolvedDevicePath) {
    notes.push('No writable Linux device detected for thermal printer.');
  }

  return {
    platform: process.platform,
    configuredDevicePath: configuredPath,
    resolvedDevicePath,
    currentUser: userInfo.username,
    currentUid: uid,
    currentGid: gid,
    currentGroups: groupNames,
    pos58,
    usbLpDevices,
    notes,
  };
}
