export function createCartSlice() {
  return {
    cartQtyByItemId: new Map<string, number>(),
    checkoutOpen: false,
    checkoutNumpadOpen: false,
    receivedInput: '',
    enterConfirmArmedAt: null as number | null,
    checkoutPaymentMethod: 'efectivo' as 'efectivo' | 'tarjeta' | 'employee',
    cart: {
      version: 0,
    },
  };
}
