import type { AppState } from '../state/app-state';
import type { OpenTabsSnapshot } from '../../shared/open-tabs';

type OpenTabsView = {
  selectedTab: OpenTabsSnapshot['tabs'][number] | null;
  itemNameById: Map<string, string>;
};

let lastKey = '';
let lastValue: OpenTabsView = {
  selectedTab: null,
  itemNameById: new Map(),
};

export function getOpenTabsView(state: AppState): OpenTabsView {
  const key = `${state.openTabs.version}|${state.catalog.version}|${state.openTabsSelectedTabId}`;
  if (key === lastKey) return lastValue;

  const selectedTab = state.openTabsSnapshot.tabs.find((tab) => tab.id === state.openTabsSelectedTabId) || null;
  const itemNameById = new Map((state.snapshot?.items || []).map((item) => [item.id, item.name]));

  lastKey = key;
  lastValue = { selectedTab, itemNameById };
  return lastValue;
}
