import type { PosKioskElectronApi, PosScannerElectronApi } from './shared/electron-api';

declare global {
  interface Window {
    posKiosk: PosKioskElectronApi;
    posScanner: PosScannerElectronApi;
  }
}

export {};
