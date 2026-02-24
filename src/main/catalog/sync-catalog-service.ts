import type { CatalogCategory, CatalogItem, CatalogSyncResult } from '../../shared/catalog';
import { OrdersRepository } from '../orders/orders-repository';
import { CatalogRepository } from './catalog-repository';

interface RemoteCategoryRow {
  id: string;
  name: string;
  sort_order: number | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
}

interface RemoteItemRow {
  id: string;
  name: string;
  type: string | null;
  price_cents: number | null;
  category_id: string;
  image_path: string | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
}

interface CatalogSyncApiResponse {
  ok: boolean;
  error?: string;
  categories?: RemoteCategoryRow[];
  items?: RemoteItemRow[];
}

export class CatalogSyncService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly ordersRepository: OrdersRepository,
  ) {}

  async syncFromApi(): Promise<CatalogSyncResult> {
    const runtime = this.ordersRepository.getRuntimeConfig();
    const tenantSlug = runtime.tenantSlug?.trim() || '';
    const deviceId = runtime.deviceId?.trim() || '';
    const deviceSecret = runtime.deviceSecret?.trim() || '';

    if (!tenantSlug || !deviceId || !deviceSecret) {
      return {
        ok: false,
        categoriesCount: 0,
        itemsCount: 0,
        syncedAt: new Date().toISOString(),
        error: 'Configura tenantSlug, deviceId y deviceSecret en Ajustes.',
      };
    }

    const baseUrl = (process.env.POS_SYNC_API_BASE_URL || process.env.HUB_API_BASE_URL || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    const endpoint = `${baseUrl}/api/tenant/${encodeURIComponent(tenantSlug)}/pos/sync/catalog`;

    let payload: CatalogSyncApiResponse;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          deviceSecret,
          since: null,
        }),
      });
      payload = (await response.json()) as CatalogSyncApiResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `Sync request failed with status ${response.status}`);
      }
    } catch (error) {
      return {
        ok: false,
        categoriesCount: 0,
        itemsCount: 0,
        syncedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Sync failed',
      };
    }

    const categories: CatalogCategory[] = (payload.categories || [])
      .filter((row) => row.deleted_at == null && row.is_active !== false)
      .map((row) => ({
        id: row.id,
        name: row.name,
        sortOrder: Number.isFinite(row.sort_order) ? Number(row.sort_order) : 0,
      }));

    const categoryIds = new Set(categories.map((row) => row.id));

    const items: CatalogItem[] = (payload.items || [])
      .filter((row) => row.deleted_at == null && row.is_active !== false)
      .map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type || 'item',
        priceCents: Number.isFinite(row.price_cents) ? Number(row.price_cents) : 0,
        categoryId: row.category_id,
        imagePath: row.image_path,
        barcode: null,
      }))
      .filter((item) => categoryIds.has(item.categoryId));

    const syncedAt = new Date().toISOString();
    this.repository.replaceCatalog(categories, items, syncedAt);

    return {
      ok: true,
      categoriesCount: categories.length,
      itemsCount: items.length,
      syncedAt,
    };
  }
}
