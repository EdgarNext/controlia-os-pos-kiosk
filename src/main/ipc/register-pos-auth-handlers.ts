import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type {
  PosLoginInput,
  PosLoginResult,
  PosSessionView,
  PosUserView,
  SupervisorOverrideInput,
  SupervisorOverrideResult,
} from '../../shared/orders';
import { PosAuthService } from '../auth/pos-auth-service';

export function registerPosAuthHandlers(authService: PosAuthService): void {
  ipcMain.handle(IPC_CHANNELS.POS_AUTH_LIST_USERS, async (): Promise<PosUserView[]> => {
    return authService.listUsers();
  });

  ipcMain.handle(IPC_CHANNELS.POS_AUTH_LOGIN, async (_event, input: PosLoginInput): Promise<PosLoginResult> => {
    return authService.login(input || { userId: '', pin: '' });
  });

  ipcMain.handle(IPC_CHANNELS.POS_AUTH_LOGOUT, async (): Promise<{ ok: boolean }> => {
    return authService.logout();
  });

  ipcMain.handle(IPC_CHANNELS.POS_AUTH_SESSION_GET, async (): Promise<PosSessionView | null> => {
    return authService.getSession();
  });

  ipcMain.handle(IPC_CHANNELS.POS_AUTH_TOUCH, async (): Promise<PosSessionView | null> => {
    return authService.touchSession();
  });

  ipcMain.handle(
    IPC_CHANNELS.POS_AUTH_SUPERVISOR_OVERRIDE,
    async (_event, input: SupervisorOverrideInput): Promise<SupervisorOverrideResult> => {
      return authService.supervisorOverride(input || { pin: '' });
    },
  );
}
