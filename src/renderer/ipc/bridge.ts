import { IPC } from '@shared/ipcChannels';
import type { ElectronAPI } from '@shared/types';
import type {
  IpcInvokeRequest,
  IpcInvokeResponse,
  ViewportBounds,
} from '@shared/ipc/channels';

function getElectronApi(): ElectronAPI {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('electronAPI bridge is unavailable');
  }
  return window.electronAPI;
}

export async function browserLogin(
  request: IpcInvokeRequest<typeof IPC.XNAT_BROWSER_LOGIN>,
): Promise<IpcInvokeResponse<typeof IPC.XNAT_BROWSER_LOGIN>> {
  return getElectronApi().xnat.browserLogin(request.serverUrl);
}

export async function dicomwebFetch(
  request: IpcInvokeRequest<typeof IPC.XNAT_DICOMWEB_FETCH>,
): Promise<IpcInvokeResponse<typeof IPC.XNAT_DICOMWEB_FETCH>> {
  return getElectronApi().xnat.dicomwebFetch(request.path, request.options);
}

export async function downloadScanFile(
  request: IpcInvokeRequest<typeof IPC.XNAT_DOWNLOAD_SCAN_FILE>,
): Promise<IpcInvokeResponse<typeof IPC.XNAT_DOWNLOAD_SCAN_FILE>> {
  return getElectronApi().xnat.downloadScanFile(request.sessionId, request.scanId);
}

export async function saveViewportCapture(
  request: IpcInvokeRequest<typeof IPC.EXPORT_SAVE_VIEWPORT_CAPTURE>,
): Promise<IpcInvokeResponse<typeof IPC.EXPORT_SAVE_VIEWPORT_CAPTURE>> {
  return getElectronApi().export.saveViewportCapture(request.bounds as ViewportBounds, request.defaultName);
}

export function onSessionExpired(
  callback: () => void,
): () => void {
  return getElectronApi().on(IPC.XNAT_SESSION_EXPIRED, callback);
}
