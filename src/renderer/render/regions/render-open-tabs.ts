export function renderOpenTabsRegion(params: {
  html: string;
  signatureStore: Record<string, string>;
}): void {
  const container = document.getElementById('region-open-tabs');
  if (!container) return;
  if (params.signatureStore.openTabs === params.html) return;
  params.signatureStore.openTabs = params.html;
  container.innerHTML = params.html;
}
