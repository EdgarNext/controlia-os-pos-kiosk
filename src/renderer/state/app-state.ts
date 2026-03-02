import { createActivationSlice } from './slices/activation-slice';
import { createAuthSlice } from './slices/auth-slice';
import { createCatalogSlice } from './slices/catalog-slice';
import { createCartSlice } from './slices/cart-slice';
import { createOpenTabsSlice } from './slices/open-tabs-slice';
import { createPrinterSlice } from './slices/printer-slice';
import { createRuntimeSlice } from './slices/runtime-slice';
import { createScannerSlice } from './slices/scanner-slice';
import { createSyncSlice } from './slices/sync-slice';
import { createUiSlice } from './slices/ui-slice';

export const state = {
  ...createCatalogSlice(),
  ...createCartSlice(),
  ...createUiSlice(),
  ...createPrinterSlice(),
  ...createRuntimeSlice(),
  ...createScannerSlice(),
  ...createOpenTabsSlice(),
  ...createSyncSlice(),
  ...createActivationSlice(),
  ...createAuthSlice(),
};

export type AppState = typeof state;

export function bumpCatalogVersion(): number {
  state.catalog.version += 1;
  return state.catalog.version;
}

export function bumpCartVersion(): number {
  state.cart.version += 1;
  return state.cart.version;
}

export function bumpOpenTabsVersion(): number {
  state.openTabs.version += 1;
  return state.openTabs.version;
}

export function bumpSyncVersion(): number {
  state.sync.version += 1;
  return state.sync.version;
}

export function bumpPrinterVersion(): number {
  state.printer.version += 1;
  return state.printer.version;
}

export function bumpScannerVersion(): number {
  state.scanner.version += 1;
  return state.scanner.version;
}

export function bumpUiVersion(): number {
  state.ui.version += 1;
  return state.ui.version;
}

export function bumpRuntimeVersion(): number {
  state.runtime.version += 1;
  return state.runtime.version;
}

export function bumpActivationVersion(): number {
  state.activation.version += 1;
  return state.activation.version;
}

export function bumpAuthVersion(): number {
  state.auth.version += 1;
  return state.auth.version;
}
