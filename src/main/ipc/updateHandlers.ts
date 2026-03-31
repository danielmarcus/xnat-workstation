import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipcChannels';
import type { ConfigureUpdaterRequest } from '../../shared/types/updater';
import {
  autoUpdateService,
  type AutoUpdateService,
} from '../updater/autoUpdateService';

function isConfigureUpdaterRequest(value: unknown): value is ConfigureUpdaterRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigureUpdaterRequest>;
  return typeof candidate.enabled === 'boolean' && typeof candidate.autoDownload === 'boolean';
}

export function registerUpdateHandlers(
  service: AutoUpdateService = autoUpdateService,
): void {
  ipcMain.handle(IPC.UPDATER_GET_STATE, () => service.getState());

  ipcMain.handle(IPC.UPDATER_CONFIGURE, async (_event, config: unknown) => {
    if (!isConfigureUpdaterRequest(config)) {
      return {
        ok: false,
        status: service.getState(),
        error: `Invalid payload for ${IPC.UPDATER_CONFIGURE}: expected boolean enabled and autoDownload values`,
      };
    }
    return service.configure(config);
  });

  ipcMain.handle(IPC.UPDATER_CHECK_FOR_UPDATES, async () => {
    return service.checkForUpdates({ manual: true });
  });

  ipcMain.handle(IPC.UPDATER_QUIT_AND_INSTALL, async () => {
    return service.quitAndInstall();
  });
}
