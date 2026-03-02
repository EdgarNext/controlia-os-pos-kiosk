export type RegionKey =
  | 'gate:activation'
  | 'gate:auth'
  | 'shell'
  | 'catalog'
  | 'cart'
  | 'open-tabs'
  | 'status'
  | 'printer-debug'
  | 'modals';

export const REGION_ORDER: RegionKey[] = [
  'gate:activation',
  'gate:auth',
  'shell',
  'catalog',
  'cart',
  'open-tabs',
  'status',
  'printer-debug',
  'modals',
];

type FlushResult = {
  rendered: RegionKey[];
  blockedByGate: boolean;
};

type FlushContext = {
  shouldBlockAfterGates: () => boolean;
  renderers: Record<RegionKey, () => void>;
};

export function createRenderScheduler() {
  const dirty = new Set<RegionKey>(REGION_ORDER);
  let shellRenderedOnce = false;

  function invalidate(region: RegionKey): void {
    dirty.add(region);
  }

  function invalidateMany(regions: RegionKey[]): void {
    for (const region of regions) dirty.add(region);
  }

  function invalidateAll(): void {
    for (const region of REGION_ORDER) dirty.add(region);
  }

  function ensureShellRenderedOnce(): void {
    if (shellRenderedOnce) return;
    dirty.add('shell');
    shellRenderedOnce = true;
  }

  function flush(ctx: FlushContext): FlushResult {
    const rendered: RegionKey[] = [];
    const hadActivationDirty = dirty.has('gate:activation');
    const hadAuthDirty = dirty.has('gate:auth');

    if (hadActivationDirty) {
      ctx.renderers['gate:activation']();
      dirty.delete('gate:activation');
      rendered.push('gate:activation');
    }
    if (hadAuthDirty) {
      ctx.renderers['gate:auth']();
      dirty.delete('gate:auth');
      rendered.push('gate:auth');
    }

    const blockedByGate = ctx.shouldBlockAfterGates();
    if (blockedByGate) {
      return { rendered, blockedByGate };
    }

    for (const region of REGION_ORDER) {
      if (region === 'gate:activation' || region === 'gate:auth') continue;
      if (!dirty.has(region)) continue;
      ctx.renderers[region]();
      dirty.delete(region);
      rendered.push(region);
    }

    return { rendered, blockedByGate };
  }

  return {
    invalidate,
    invalidateMany,
    invalidateAll,
    flush,
    ensureShellRenderedOnce,
  };
}
