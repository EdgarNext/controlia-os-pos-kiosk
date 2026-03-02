export const SHELL_LAYOUT_HTML = `
  <main class="kiosk-shell brand-accent-shell" id="region-shell">
    <header class="topbar control-strip header">
      <div class="topbar-left brand-block header-left">
        <h1>Kiosk POS</h1>
        <p id="topbar-subtitle">Offline-first</p>
      </div>
      <div class="topbar-center header-center">
        <div id="topbar-context" class="topbar-context">Usuario · Rol · Kiosko</div>
      </div>
      <div class="topbar-right header-right">
        <div class="topbar-actions" data-region="header-actions"></div>
      </div>
    </header>

    <section class="layout main-content" id="region-catalog">
      <aside class="panel categories">
        <h2>Categorias</h2>
        <div class="stack" data-region="categories"></div>
      </aside>

      <section class="panel products">
        <h2>Productos</h2>
        <div class="products-grid" data-region="products"></div>
      </section>

      <aside class="panel cart" id="region-cart" data-region="cart"></aside>
    </section>

    <footer class="bottom-status" id="region-status" data-region="statusbar"></footer>
    <div id="region-modals" data-region="modals"></div>
    <div id="region-open-tabs" data-region="open-tabs"></div>
    <div id="region-printer-debug" data-region="printer-debug"></div>
    <div id="region-gate-auth" data-region="gate-auth"></div>
    <div id="region-gate-activation" data-region="gate-activation"></div>
  </main>
`;

export function renderShellRegion(params: {
  html: string;
  signatureStore: Record<string, string>;
  apply: () => void;
}): void {
  const container = document.getElementById('region-shell');
  if (!container) return;
  if (params.signatureStore.header === params.html) return;
  params.signatureStore.header = params.html;
  params.apply();
}
