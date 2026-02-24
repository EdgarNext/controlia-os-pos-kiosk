import type { PosKioskElectronApi } from './shared/electron-api';

declare global {
  interface Window {
    posKiosk: PosKioskElectronApi;
  }
}

export {};
