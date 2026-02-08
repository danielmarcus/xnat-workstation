/**
 * IPC Handlers for XNAT Authentication
 *
 * Registers ipcMain.handle() for login, logout, session validation,
 * and connection info retrieval.
 */
import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipcChannels';
import type { XnatLoginCredentials } from '../../shared/types/xnat';
import * as sessionManager from '../xnat/sessionManager';

export function registerAuthHandlers(): void {
  ipcMain.handle(IPC.XNAT_LOGIN, async (_event, creds: XnatLoginCredentials) => {
    return sessionManager.login(creds);
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
