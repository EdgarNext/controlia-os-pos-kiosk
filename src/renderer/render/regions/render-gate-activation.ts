export function renderGateActivationRegion(params: {
  html: string;
  signatureStore: Record<string, string>;
}): void {
  const container = document.getElementById('region-gate-activation');
  if (!container) return;
  if (params.signatureStore.gateActivation === params.html) return;
  params.signatureStore.gateActivation = params.html;
  container.innerHTML = params.html;
}
