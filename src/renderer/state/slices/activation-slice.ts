export function createActivationSlice() {
  return {
    activation: {
      required: false,
      blocked: false,
      inFlight: false,
      tenantSlugInput: '',
      claimCodeInput: '',
      message: 'Ingresa Tenant Slug y Claim Code para activar este dispositivo.',
      kind: 'info' as 'info' | 'success' | 'error',
      version: 0,
    },
  };
}
