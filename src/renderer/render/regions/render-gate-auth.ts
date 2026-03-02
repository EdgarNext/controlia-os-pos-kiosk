export function renderGateAuthRegion(params: {
  html: string;
  signatureStore: Record<string, string>;
}): void {
  const container = document.getElementById('region-gate-auth');
  if (!container) return;
  if (params.signatureStore.gateAuth === params.html) return;
  params.signatureStore.gateAuth = params.html;
  container.innerHTML = params.html;
}
