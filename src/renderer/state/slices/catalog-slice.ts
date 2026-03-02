import type { CatalogSnapshot } from '../../../shared/catalog';

export function createCatalogSlice() {
  return {
    snapshot: null as CatalogSnapshot | null,
    activeCategoryId: '',
    barcodeBindingOpen: false,
    barcodeBindingCategoryId: '',
    barcodeBindingSearch: '',
    barcodeBindingSelectedItemId: '',
    barcodeBindingBusy: false,
    barcodeBindingStatusMessage: 'Selecciona un producto y escanea una etiqueta.' as string,
    barcodeBindingStatusKind: 'info' as 'info' | 'success' | 'error',
    catalog: {
      version: 0,
    },
  };
}
