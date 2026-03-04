import type { PosSessionView, PosUserView } from '../../../shared/orders';

export function createAuthSlice() {
  return {
    auth: {
      loading: false,
      users: [] as PosUserView[],
      session: null as PosSessionView | null,
      selectedUserId: '',
      pinInput: '',
      supervisorOverrideOpen: false,
      supervisorOverrideReason: '',
      supervisorPinInput: '',
      supervisorOverrideInFlight: false,
      supervisorOverrideMessage: '',
      supervisorOverrideKind: 'info' as 'info' | 'success' | 'error',
      inFlight: false,
      message: 'Inicia sesion para operar ventas.',
      kind: 'info' as 'info' | 'success' | 'error',
      version: 0,
    },
  };
}
