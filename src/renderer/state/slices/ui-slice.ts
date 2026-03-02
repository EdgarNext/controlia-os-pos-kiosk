import type { OrderHistoryRecord } from '../../../shared/orders';

type StatusBarPhase = 'idle' | 'working' | 'ok' | 'warn' | 'error';

export type SettingsPendingAction =
  | 'load'
  | 'save'
  | 'print-test'
  | 'refresh-jobs'
  | 'scanner-debug-save-settings'
  | 'printer-debug-diag'
  | 'printer-debug-self-test'
  | 'printer-debug-text'
  | null;

export function createUiSlice() {
  return {
    settingsOpen: false,
    settingsStatusMessage: 'Listo para configurar.' as string,
    settingsStatusKind: 'info' as 'info' | 'success' | 'error',
    settingsPendingAction: null as SettingsPendingAction,
    ordersHistoryOpen: false,
    ordersHistory: [] as OrderHistoryRecord[],
    ordersHistoryLoading: false,
    ordersHistoryActionBusy: false,
    ordersHistoryStatusMessage: 'Selecciona una orden para reimprimir o cancelar.' as string,
    ordersHistoryStatusKind: 'info' as 'info' | 'success' | 'error',
    busy: false,
    status: 'Listo.' as string,
    statusKind: 'info' as 'info' | 'success' | 'error',
    statusBar: {
      sync: {
        phase: 'idle' as StatusBarPhase,
        pendingTotal: 0,
        lastOkAt: null as string | null,
        lastErrorShort: '',
      },
      scanner: {
        phase: 'ok' as StatusBarPhase,
        lastCode: '',
        lastAt: null as string | null,
      },
      print: {
        phase: 'idle' as StatusBarPhase,
        lastErrorShort: '',
      },
      runtime: {
        modeMesa: false,
        kioskLabel: '',
        folioHint: '',
      },
    },
    ui: {
      version: 0,
    },
  };
}
