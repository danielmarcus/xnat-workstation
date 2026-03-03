/**
 * IPC Handler for Proxied DICOMweb Requests
 *
 * The renderer can't make authenticated requests to XNAT directly
 * (credentials stay in main process). This handler receives QIDO-RS
 * requests via IPC, makes them with auth headers, and returns the
 * JSON response.
 *
 * WADO-URI requests (actual DICOM file fetches by Cornerstone) are
 * handled transparently by the webRequest interceptor in sessionManager.
 */
import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipcChannels';
import type { ProxiedFetchResult } from '../../shared/types/xnat';
import * as sessionManager from '../xnat/sessionManager';

export function registerProxyHandlers(): void {
  ipcMain.handle(
    IPC.XNAT_DICOMWEB_FETCH,
    async (
      _event,
      path: string,
      options?: { accept?: string },
    ): Promise<ProxiedFetchResult> => {
      if (typeof path !== 'string' || path.trim().length === 0 || !path.startsWith('/')) {
        return { ok: false, status: 400, error: 'Invalid payload: path must be a non-empty absolute path' };
      }
      if (options && typeof options !== 'object') {
        return { ok: false, status: 400, error: 'Invalid payload: options must be an object' };
      }
      if (options?.accept !== undefined && typeof options.accept !== 'string') {
        return { ok: false, status: 400, error: 'Invalid payload: options.accept must be a string' };
      }

      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, status: 401, error: 'Not connected to XNAT' };
      }

      try {
        // Build the full DICOMweb endpoint path
        // XNAT exposes DICOMweb at /xapi/dicomweb/
        const endpoint = `/xapi/dicomweb${path}`;

        const response = await client.authenticatedFetch(endpoint, {
          headers: {
            Accept: options?.accept || 'application/dicom+json',
          },
        });

        const data = await response.json();
        return { ok: true, status: response.status, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[proxy] DICOMweb fetch error:', message);
        sessionManager.handleAuthFailure(err);
        return { ok: false, status: 500, error: message };
      }
    },
  );

  // ─── XNAT REST API Browse Handlers ─────────────────────────────

  ipcMain.handle(IPC.XNAT_GET_PROJECTS, async () => {
    const client = sessionManager.getClient();
    if (!client) return [];
    try {
      return await client.getProjects();
    } catch (err) {
      console.error('[proxy] getProjects error:', err);
      sessionManager.handleAuthFailure(err);
      return [];
    }
  });

  ipcMain.handle(IPC.XNAT_GET_SUBJECTS, async (_event, projectId: string) => {
    const client = sessionManager.getClient();
    if (!client) return [];
    try {
      return await client.getSubjects(projectId);
    } catch (err) {
      console.error('[proxy] getSubjects error:', err);
      sessionManager.handleAuthFailure(err);
      return [];
    }
  });

  ipcMain.handle(
    IPC.XNAT_GET_SESSIONS,
    async (_event, projectId: string, subjectId: string) => {
      const client = sessionManager.getClient();
      if (!client) return [];
      try {
        return await client.getSessions(projectId, subjectId);
      } catch (err) {
        console.error('[proxy] getSessions error:', err);
        sessionManager.handleAuthFailure(err);
        return [];
      }
    },
  );

  ipcMain.handle(IPC.XNAT_GET_PROJECT_SESSIONS, async (_event, projectId: string) => {
    const client = sessionManager.getClient();
    if (!client) return [];
    try {
      return await client.getProjectSessions(projectId);
    } catch (err) {
      console.error('[proxy] getProjectSessions error:', err);
      sessionManager.handleAuthFailure(err);
      return [];
    }
  });

  ipcMain.handle(
    IPC.XNAT_GET_SCANS,
    async (
      _event,
      sessionId: string,
      options?: { includeSopClassUID?: boolean },
    ) => {
    const client = sessionManager.getClient();
    if (!client) return [];
    try {
      return await client.getScans(sessionId, options);
    } catch (err) {
      console.error('[proxy] getScans error:', err);
      sessionManager.handleAuthFailure(err);
      return [];
    }
    },
  );

  ipcMain.handle(
    IPC.XNAT_GET_SCAN_FILES,
    async (_event, sessionId: string, scanId: string) => {
      const client = sessionManager.getClient();
      if (!client) return { ok: false, error: 'Not connected', files: [] };
      try {
        const uris = await client.getScanFiles(sessionId, scanId);
        return { ok: true, files: uris, serverUrl: client.serverUrl };
      } catch (err) {
        console.error('[proxy] getScanFiles error:', err);
        sessionManager.handleAuthFailure(err);
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          files: [],
        };
      }
    },
  );

  console.log('[ipc] Proxy handlers registered');
}
