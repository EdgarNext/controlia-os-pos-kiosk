export interface CatalogCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface CatalogItem {
  id: string;
  name: string;
  type: string;
  priceCents: number;
  categoryId: string;
  imagePath: string | null;
  barcode: string | null;
}

export interface CatalogSnapshot {
  categories: CatalogCategory[];
  items: CatalogItem[];
  lastSyncedAt: string | null;
}

export interface CatalogSyncResult {
  ok: boolean;
  categoriesCount: number;
  itemsCount: number;
  syncedAt: string;
  error?: string;
}

export interface AssignBarcodeInput {
  itemId: string;
  barcode: string;
}

export interface AssignBarcodeResult {
  ok: boolean;
  itemId: string;
  barcode?: string;
  error?: string;
}
