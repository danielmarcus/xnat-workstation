import { IPC } from '../ipcChannels';
import type { XnatLoginResult, ProxiedFetchResult } from '../types/xnat';

export interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DownloadScanFileResult = {
  ok: boolean;
  data?: string;
  error?: string;
};

export type ExportResult = {
  ok: boolean;
  path?: string;
  error?: string;
};

export interface IpcInvokeContracts {
  [IPC.XNAT_BROWSER_LOGIN]: {
    request: { serverUrl: string };
    response: XnatLoginResult;
  };
  [IPC.XNAT_DICOMWEB_FETCH]: {
    request: { path: string; options?: { accept?: string } };
    response: ProxiedFetchResult;
  };
  [IPC.XNAT_DOWNLOAD_SCAN_FILE]: {
    request: { sessionId: string; scanId: string };
    response: DownloadScanFileResult;
  };
  [IPC.EXPORT_SAVE_VIEWPORT_CAPTURE]: {
    request: { bounds: ViewportBounds; defaultName?: string };
    response: ExportResult;
  };
}

export type IpcInvokeChannel = keyof IpcInvokeContracts;

export type IpcInvokeRequest<C extends IpcInvokeChannel> =
  IpcInvokeContracts[C]['request'];

export type IpcInvokeResponse<C extends IpcInvokeChannel> =
  IpcInvokeContracts[C]['response'];

export const IPC_CHANNELS = {
  browserLogin: IPC.XNAT_BROWSER_LOGIN,
  dicomwebFetch: IPC.XNAT_DICOMWEB_FETCH,
  downloadScanFile: IPC.XNAT_DOWNLOAD_SCAN_FILE,
  saveViewportCapture: IPC.EXPORT_SAVE_VIEWPORT_CAPTURE,
  sessionExpired: IPC.XNAT_SESSION_EXPIRED,
} as const;
