export interface UpdatePreferences {
  enabled: boolean;
  autoDownload: boolean;
}

export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
  enabled: true,
  autoDownload: true,
};

export type UpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'upToDate'
  | 'error'
  | 'unsupported';

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  enabled: boolean;
  autoDownload: boolean;
  isPackaged: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadProgressPercent: number | null;
  lastCheckedAt: string | null;
  message: string | null;
  error: string | null;
}

export interface ConfigureUpdaterRequest extends UpdatePreferences {}

export interface ConfigureUpdaterResponse {
  ok: boolean;
  status: UpdateStatus;
  error?: string;
}

export interface CheckForUpdatesResponse {
  ok: boolean;
  status: UpdateStatus;
  error?: string;
}

export interface QuitAndInstallResponse {
  ok: boolean;
  error?: string;
}
