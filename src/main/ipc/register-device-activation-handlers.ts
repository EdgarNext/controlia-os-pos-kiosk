import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type {
  DeviceActivationState,
  DeviceBindingInfo,
  DeviceBindingResetResult,
  DeviceClaimActivateInput,
  DeviceClaimActivateResult,
} from '../../shared/orders';
import { OrdersRepository } from '../orders/orders-repository';
import type { SyncCoordinator } from '../sync/sync-coordinator';

interface ClaimApiResponse {
  ok?: boolean;
  error?: string;
  tenantId?: string;
  kioskId?: string;
  kioskNumber?: number;
  kioskDisplayName?: string;
  deviceId?: string;
  deviceSecret?: string;
}

interface CatalogAuthProbeResponse {
  ok?: boolean;
  error?: string;
}

export function registerDeviceActivationHandlers(
  ordersRepository: OrdersRepository,
  syncCoordinator: SyncCoordinator,
): void {
  const resolveApiBaseUrl = (): string => {
    return String(
      process.env.POS_SYNC_API_BASE_URL || process.env.HUB_API_BASE_URL || 'http://localhost:3000',
    ).replace(/\/$/, '');
  };

  ipcMain.handle(
    IPC_CHANNELS.DEVICE_ACTIVATE_CLAIM,
    async (_event, input: DeviceClaimActivateInput): Promise<DeviceClaimActivateResult> => {
      const tenantSlug = String(input?.tenantSlug || '').trim().toLowerCase();
      const claimCode = String(input?.claimCode || '').trim().toUpperCase();
      if (!tenantSlug) {
        return { ok: false, error: 'Tenant Slug es requerido.' };
      }
      if (!claimCode) {
        return { ok: false, error: 'Claim Code es requerido.' };
      }

      const baseUrl = resolveApiBaseUrl();
      const endpoint = `${baseUrl}/api/pos/claim`;

      let payload: ClaimApiResponse | null = null;
      let status = 0;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantSlug, claimCode }),
        });
        status = response.status;
        payload = (await response.json()) as ClaimApiResponse;
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'No se pudo conectar al endpoint de claim.',
        };
      }

      if (!payload?.ok || status < 200 || status >= 300) {
        return {
          ok: false,
          error: payload?.error || `Claim no disponible (HTTP ${status || 0}).`,
        };
      }

      if (
        !payload.tenantId ||
        !payload.kioskId ||
        !Number.isInteger(payload.kioskNumber) ||
        !payload.deviceId ||
        !payload.deviceSecret
      ) {
        return { ok: false, error: 'Respuesta de claim incompleta.' };
      }

      ordersRepository.setRuntimeConfig({
        tenantId: payload.tenantId,
        kioskId: payload.kioskId,
        kioskNumber: payload.kioskNumber,
        kioskDisplayName:
          typeof payload.kioskDisplayName === 'string' && payload.kioskDisplayName.trim()
            ? payload.kioskDisplayName.trim()
            : null,
        tenantSlug,
        deviceId: payload.deviceId,
        deviceSecret: payload.deviceSecret,
      });

      syncCoordinator.stop();
      syncCoordinator.start();

      return {
        ok: true,
        tenantId: payload.tenantId,
        kioskId: payload.kioskId,
        kioskNumber: payload.kioskNumber,
        kioskDisplayName:
          typeof payload.kioskDisplayName === 'string' && payload.kioskDisplayName.trim()
            ? payload.kioskDisplayName.trim()
            : undefined,
        deviceId: payload.deviceId,
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DEVICE_ACTIVATION_STATE,
    async (): Promise<DeviceActivationState> => {
      const runtime = ordersRepository.getRuntimeConfig();
      const tenantSlug = String(runtime.tenantSlug || '').trim();
      const deviceId = String(runtime.deviceId || '').trim();
      const deviceSecret = String(runtime.deviceSecret || '').trim();

      if (!tenantSlug || !deviceId || !deviceSecret) {
        return {
          state: 'unclaimed',
          message: 'Dispositivo sin activar. Ingresa Tenant Slug y Claim Code.',
        };
      }

      const baseUrl = resolveApiBaseUrl();
      const endpoint = `${baseUrl}/api/tenant/${encodeURIComponent(tenantSlug)}/pos/sync/catalog`;

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

        if (response.ok) {
          return {
            state: 'active',
            message: 'Dispositivo activo.',
          };
        }

        const payload = (await response.json()) as CatalogAuthProbeResponse;
        const errorMessage = String(payload?.error || '').toLowerCase();
        if (
          response.status === 401 &&
          (errorMessage.includes('not active') ||
            errorMessage.includes('revoked') ||
            errorMessage.includes('disabled'))
        ) {
          return {
            state: 'revoked',
            message: 'Dispositivo revocado o deshabilitado. Contacta al administrador.',
          };
        }

        return {
          state: 'active',
          message: '',
        };
      } catch {
        return {
          state: 'active',
          message: '',
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DEVICE_BINDING_INFO,
    async (): Promise<DeviceBindingInfo> => {
      const runtime = ordersRepository.getRuntimeConfig();
      const hasBinding = Boolean(runtime.tenantSlug && runtime.deviceId && runtime.deviceSecret);

      return {
        apiBaseUrl: resolveApiBaseUrl(),
        runtime,
        hasBinding,
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DEVICE_BINDING_RESET,
    async (): Promise<DeviceBindingResetResult> => {
      try {
        ordersRepository.clearPosSession();
        ordersRepository.clearDeviceBinding();
        syncCoordinator.stop();

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'No se pudo limpiar la vinculacion del dispositivo.',
        };
      }
    },
  );
}
