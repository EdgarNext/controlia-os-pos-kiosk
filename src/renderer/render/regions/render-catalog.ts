export function renderCatalogRegion(params: {
  categoriesHtml: string;
  productsHtml: string;
  signatureStore: Record<string, string>;
  applyCategories: () => void;
  applyProducts: () => void;
}): void {
  const catalogRoot = document.getElementById('region-catalog');
  if (!catalogRoot) return;
  catalogRoot.classList.add('catalog-accented');

  const categoriesContainer = catalogRoot.querySelector('[data-region="categories"]');
  const productsContainer = catalogRoot.querySelector('[data-region="products"]');

  if (categoriesContainer && params.signatureStore.categories !== params.categoriesHtml) {
    params.signatureStore.categories = params.categoriesHtml;
    params.applyCategories();
  }
  if (productsContainer && params.signatureStore.products !== params.productsHtml) {
    params.signatureStore.products = params.productsHtml;
    params.applyProducts();
  }
}
