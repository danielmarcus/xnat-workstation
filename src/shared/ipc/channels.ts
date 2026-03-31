import { IPC } from '../ipcChannels';
import type { XnatLoginResult, ProxiedFetchResult } from '../types/xnat';
import type { MainDiagnosticsSnapshotResult } from '../types/diagnostics';
import type {
  CheckForUpdatesResponse,
  ConfigureUpdaterRequest,
  ConfigureUpdaterResponse,
  QuitAndInstallResponse,
  UpdateStatus,
} from '../types/updater';

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
  [IPC.DIAGNOSTICS_GET_MAIN_SNAPSHOT]: {
    request: Record<string, never>;
    response: MainDiagnosticsSnapshotResult;
  };
  [IPC.UPDATER_GET_STATE]: {
    request: Record<string, never>;
    response: UpdateStatus;
  };
  [IPC.UPDATER_CONFIGURE]: {
    request: ConfigureUpdaterRequest;
    response: ConfigureUpdaterResponse;
  };
  [IPC.UPDATER_CHECK_FOR_UPDATES]: {
    request: Record<string, never>;
    response: CheckForUpdatesResponse;
  };
  [IPC.UPDATER_QUIT_AND_INSTALL]: {
    request: Record<string, never>;
    response: QuitAndInstallResponse;
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
  getMainDiagnosticsSnapshot: IPC.DIAGNOSTICS_GET_MAIN_SNAPSHOT,
  getUpdaterState: IPC.UPDATER_GET_STATE,
  configureUpdater: IPC.UPDATER_CONFIGURE,
  checkForUpdates: IPC.UPDATER_CHECK_FOR_UPDATES,
  quitAndInstallUpdate: IPC.UPDATER_QUIT_AND_INSTALL,
  updaterStatus: IPC.UPDATER_STATUS,
  sessionExpired: IPC.XNAT_SESSION_EXPIRED,
} as const;
