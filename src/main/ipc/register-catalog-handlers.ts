import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type {
  AssignBarcodeInput,
  AssignBarcodeResult,
  CatalogSnapshot,
  CatalogSyncResult,
} from '../../shared/catalog';
import { CatalogRepository } from '../catalog/catalog-repository';
import { CatalogSyncService } from '../catalog/sync-catalog-service';

export function registerCatalogHandlers(
  repository: CatalogRepository,
  syncService: CatalogSyncService,
): void {
  ipcMain.handle(IPC_CHANNELS.CATALOG_GET, async (): Promise<CatalogSnapshot> => {
    return repository.getCatalogSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.CATALOG_SYNC, async (): Promise<CatalogSyncResult> => {
    return syncService.syncFromApi();
  });

  ipcMain.handle(
    IPC_CHANNELS.CATALOG_ASSIGN_BARCODE,
    async (_event, input: AssignBarcodeInput): Promise<AssignBarcodeResult> => {
      return repository.assignBarcode(input);
    },
  );
}
