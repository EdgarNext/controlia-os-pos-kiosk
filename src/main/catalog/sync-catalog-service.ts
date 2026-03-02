import type { CatalogCategory, CatalogItem, CatalogSyncResult, PosUserLocal } from '../../shared/catalog';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { OrdersRepository } from '../orders/orders-repository';
import { CatalogRepository } from './catalog-repository';

interface RemoteCategoryRow {
  id: string;
  name: string;
  sort_order: number | null;
  image_path: string | null;
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
  imageBaseUrl?: string | null;
  image_base_url?: string | null;
  categories?: RemoteCategoryRow[];
  items?: RemoteItemRow[];
  users?: Array<{
    id: string;
    name: string;
    pin_hash: string;
    role: string;
    is_active: boolean;
    updated_at: string;
  }>;
}

export class CatalogSyncService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly ordersRepository: OrdersRepository,
    private readonly userDataPath: string,
  ) {}

  private getCatalogImagesRoot(): string {
    return path.join(this.userDataPath, 'catalog-images');
  }

  private resolveRemoteImageUrl(baseUrl: string, rawPath: string): string {
    const trimmed = rawPath.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    const normalizedBase = baseUrl.replace(/\/$/, '');
    const normalized = trimmed.replace(/^\/+/, '');
    if (normalizedBase.includes('/storage/v1/object/public/')) {
      return `${normalizedBase}/${normalized}`;
    }
    return `${normalizedBase}/storage/v1/object/public/catalog-images/${normalized}`;
  }

  private resolveCatalogImageBaseUrl(syncApiBaseUrl: string, payload: CatalogSyncApiResponse): string {
    const fromPayload = payload.imageBaseUrl || payload.image_base_url || '';
    const fromEnv =
      process.env.POS_CATALOG_IMAGES_BASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';

    const candidate = (fromPayload || fromEnv).trim();
    if (candidate) {
      return candidate.replace(/\/$/, '');
    }

    return syncApiBaseUrl.replace(/\/$/, '');
  }

  private getLocalImagePath(rawPath: string): string {
    const root = this.getCatalogImagesRoot();
    const trimmed = rawPath.trim();

    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      const ext = path.extname(parsed.pathname) || '.img';
      const fileName = `${createHash('sha1').update(trimmed).digest('hex')}${ext}`;
      return path.join(root, 'external', fileName);
    }

    const normalized = trimmed.replace(/^\/+/, '');
    const safeSegments = normalized
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

    if (safeSegments.length === 0) {
      const fallbackName = `${createHash('sha1').update(trimmed).digest('hex')}.img`;
      return path.join(root, 'misc', fallbackName);
    }

    return path.join(root, ...safeSegments);
  }

  private async downloadCatalogImage(imageBaseUrl: string, rawPath: string | null): Promise<string | null> {
    if (!rawPath || !rawPath.trim()) {
      return null;
    }

    const remoteUrl = this.resolveRemoteImageUrl(imageBaseUrl, rawPath);
    const localPath = this.getLocalImagePath(rawPath);

    try {
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      const response = await fetch(remoteUrl);
      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.warn('[catalog-sync] image download failed', response.status, remoteUrl);
        return null;
      }

      const bytes = await response.arrayBuffer();
      await fs.writeFile(localPath, Buffer.from(bytes));
      const relativePath = path.relative(this.getCatalogImagesRoot(), localPath).split(path.sep).join('/');
      return `pos-media://catalog/${encodeURI(relativePath)}`;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[catalog-sync] image download error', remoteUrl, error);
      return null;
    }
  }

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

    const imageBaseUrl = this.resolveCatalogImageBaseUrl(baseUrl, payload);

    const activeCategories = (payload.categories || []).filter(
      (row) => row.deleted_at == null && row.is_active !== false,
    );
    const categories: CatalogCategory[] = await Promise.all(
      activeCategories.map(async (row) => ({
        id: row.id,
        name: row.name,
        sortOrder: Number.isFinite(row.sort_order) ? Number(row.sort_order) : 0,
        imagePath: await this.downloadCatalogImage(imageBaseUrl, row.image_path),
      })),
    );

    const categoryIds = new Set(categories.map((row) => row.id));

    const activeItems = (payload.items || []).filter(
      (row) => row.deleted_at == null && row.is_active !== false,
    );
    const items: CatalogItem[] = (
      await Promise.all(
        activeItems.map(async (row) => ({
          id: row.id,
          name: row.name,
          type: row.type || 'item',
          priceCents: Number.isFinite(row.price_cents) ? Number(row.price_cents) : 0,
          categoryId: row.category_id,
          imagePath: await this.downloadCatalogImage(imageBaseUrl, row.image_path),
          barcode: null,
        })),
      )
    ).filter((item) => categoryIds.has(item.categoryId));

    const users: PosUserLocal[] = (payload.users || [])
      .map((row) => ({
        id: row.id,
        name: row.name,
        pinHash: row.pin_hash,
        role: row.role,
        isActive: row.is_active !== false,
        updatedAt: row.updated_at,
      }))
      .filter((row) => row.isActive);

    const syncedAt = new Date().toISOString();
    this.repository.replaceCatalog(categories, items, users, syncedAt);

    return {
      ok: true,
      categoriesCount: categories.length,
      itemsCount: items.length,
      syncedAt,
    };
  }
}
