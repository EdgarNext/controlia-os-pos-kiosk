export function renderModalsRegion(params: {
  html: string;
  signatureStore: Record<string, string>;
}): void {
  const container = document.getElementById('region-modals');
  if (!container) return;
  container.classList.add('modals-accented');
  const hadModals = params.signatureStore.modals.trim().length > 0;
  const hasModals = params.html.trim().length > 0;
  if (params.signatureStore.modals === params.html) return;
  params.signatureStore.modals = params.html;
  container.classList.toggle('has-active-modals', hasModals);
  if (!hadModals && hasModals) {
    container.classList.add('modals-enter');
    window.setTimeout(() => {
      container.classList.remove('modals-enter');
    }, 220);
  }
  container.innerHTML = params.html;
}
