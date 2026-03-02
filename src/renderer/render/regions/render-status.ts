export function renderStatusRegion(params: {
  apply: () => void;
}): void {
  const container = document.getElementById('region-status');
  if (!container) return;
  params.apply();
}
