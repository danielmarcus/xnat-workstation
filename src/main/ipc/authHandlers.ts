/**
 * IPC Handlers for XNAT Authentication
 *
 * Registers ipcMain.handle() for login, logout, session validation,
 * and connection info retrieval.
 */
import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipcChannels';
import * as sessionManager from '../xnat/sessionManager';

export function registerAuthHandlers(): void {
  ipcMain.handle(IPC.XNAT_BROWSER_LOGIN, async (_event, serverUrl: string) => {
    if (typeof serverUrl !== 'string' || serverUrl.trim().length === 0) {
      throw new Error('Invalid payload for xnat:browser-login: serverUrl must be a non-empty string');
    }
    return sessionManager.browserLogin(serverUrl);
  });

  ipcMain.handle(IPC.XNAT_LOGOUT, async () => {
    return sessionManager.logout();
  });

  ipcMain.handle(IPC.XNAT_VALIDATE, async () => {
    return sessionManager.validateSession();
  });

  ipcMain.handle(IPC.XNAT_GET_CONNECTION, async () => {
    return sessionManager.getConnectionInfo();
  });

  console.log('[ipc] Auth handlers registered');
}
