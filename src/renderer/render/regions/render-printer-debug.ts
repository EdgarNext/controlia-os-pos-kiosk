export function renderPrinterDebugRegion(params: {
  html: string;
  signatureStore: Record<string, string>;
}): void {
  const container = document.getElementById('region-printer-debug');
  if (!container) return;
  if (params.signatureStore.printerDebug === params.html) return;
  params.signatureStore.printerDebug = params.html;
  container.innerHTML = params.html;
}
