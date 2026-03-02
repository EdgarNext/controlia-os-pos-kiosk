export function renderCartRegion(params: {
  html: string;
  signatureStore: Record<string, string>;
  apply: () => void;
}): void {
  const container = document.getElementById('region-cart');
  if (!container) return;
  container.classList.add('command-center', 'cart-accented');
  if (params.signatureStore.cart === params.html) return;
  params.signatureStore.cart = params.html;
  params.apply();
}
