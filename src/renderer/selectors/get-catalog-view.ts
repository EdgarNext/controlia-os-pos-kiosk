import type { CatalogCategory, CatalogItem } from '../../shared/catalog';
import type { AppState } from '../state/app-state';

type CatalogView = {
  categories: CatalogCategory[];
  items: CatalogItem[];
  visibleItems: CatalogItem[];
  barcodeBindingItems: CatalogItem[];
};

let lastKey = '';
let lastValue: CatalogView = {
  categories: [],
  items: [],
  visibleItems: [],
  barcodeBindingItems: [],
};

export function getCatalogView(state: AppState): CatalogView {
  const key = [
    state.catalog.version,
    state.activeCategoryId,
    state.barcodeBindingCategoryId,
    state.barcodeBindingSearch,
  ].join('|');

  if (key === lastKey) return lastValue;

  const categories = state.snapshot?.categories || [];
  const items = state.snapshot?.items || [];
  const visibleItems = !state.activeCategoryId ? items : items.filter((row) => row.categoryId === state.activeCategoryId);

  const categoryId = state.barcodeBindingCategoryId;
  const search = state.barcodeBindingSearch.trim().toLowerCase();
  const barcodeBindingItems = items.filter((item) => {
    const categoryMatch = !categoryId || item.categoryId === categoryId;
    const searchMatch = !search || item.name.toLowerCase().includes(search) || (item.barcode || '').toLowerCase().includes(search);
    return categoryMatch && searchMatch;
  });

  lastKey = key;
  lastValue = {
    categories,
    items,
    visibleItems,
    barcodeBindingItems,
  };
  return lastValue;
}
