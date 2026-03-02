import type { AppState } from '../state/app-state';
import type { CartLineView } from './get-cart-lines';

type TotalsView = {
  totalCents: number;
  activeTabTotalCents: number;
  currentSaleTotalCents: number;
  receivedCents: number;
  missingCents: number;
  changeCents: number;
};

let lastKey = '';
let lastValue: TotalsView = {
  totalCents: 0,
  activeTabTotalCents: 0,
  currentSaleTotalCents: 0,
  receivedCents: 0,
  missingCents: 0,
  changeCents: 0,
};

export function getTotalsView(state: AppState, cartLines: CartLineView[]): TotalsView {
  const key = [
    state.cart.version,
    state.openTabs.version,
    state.tableModeEnabled ? '1' : '0',
    state.receivedInput,
  ].join('|');

  if (key === lastKey) return lastValue;

  const totalCents = cartLines.reduce((sum, line) => sum + line.item.priceCents * line.qty, 0);
  const activeTabTotalCents = (state.openTabsDetail?.lines || []).reduce((sum, line) => sum + line.lineTotalCents, 0);
  const currentSaleTotalCents = state.tableModeEnabled ? activeTabTotalCents : totalCents;

  const raw = Number.parseInt(state.receivedInput || '0', 10);
  const receivedCents = !Number.isFinite(raw) || raw <= 0 ? 0 : raw * 100;
  const missingCents = Math.max(currentSaleTotalCents - receivedCents, 0);
  const changeCents = Math.max(receivedCents - currentSaleTotalCents, 0);

  lastKey = key;
  lastValue = {
    totalCents,
    activeTabTotalCents,
    currentSaleTotalCents,
    receivedCents,
    missingCents,
    changeCents,
  };
  return lastValue;
}
