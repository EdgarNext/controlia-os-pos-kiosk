import type { CatalogItem } from '../../shared/catalog';
import type { AppState } from '../state/app-state';

export interface CartLineView {
  item: CatalogItem;
  qty: number;
}

let lastKey = '';
let lastValue: CartLineView[] = [];

export function getCartLinesView(state: AppState): CartLineView[] {
  const cartEntries = Array.from(state.cartQtyByItemId.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, qty]) => `${itemId}:${qty}`)
    .join('|');

  const key = `${state.catalog.version}|${state.cart.version}|${cartEntries}`;
  if (key === lastKey) return lastValue;

  const items = state.snapshot?.items || [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const lines: CartLineView[] = [];
  state.cartQtyByItemId.forEach((qty, itemId) => {
    const item = byId.get(itemId);
    if (item && qty > 0) lines.push({ item, qty });
  });

  lastKey = key;
  lastValue = lines.sort((a, b) => a.item.name.localeCompare(b.item.name));
  return lastValue;
}
