import type { RuntimeConfig } from '../../../shared/orders';

export function createRuntimeSlice() {
  return {
    runtimeConfig: null as RuntimeConfig | null,
    deviceBindingOpen: false,
    deviceBindingBusy: false,
    deviceBindingConfirmReset: false,
    deviceBindingStatusMessage: '' as string,
    deviceBindingStatusKind: 'info' as 'info' | 'success' | 'error',
    deviceBindingApiBaseUrl: '' as string,
    runtime: {
      version: 0,
    },
  };
}
