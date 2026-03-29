import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC } from '../../shared/ipcChannels';
import {
  DEFAULT_UPDATE_PREFERENCES,
  type CheckForUpdatesResponse,
  type ConfigureUpdaterRequest,
  type ConfigureUpdaterResponse,
  type QuitAndInstallResponse,
  type UpdateStatus,
} from '../../shared/types/updater';

const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 3 * 1000;

type UpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

type UpdateInfoLike = {
  version?: string | null;
};

type ProgressInfoLike = {
  percent?: number | null;
};

export interface AutoUpdateService {
  initialize(): void;
  dispose(): void;
  getState(): UpdateStatus;
  configure(config: ConfigureUpdaterRequest): Promise<ConfigureUpdaterResponse>;
  checkForUpdates(options?: { manual?: boolean }): Promise<CheckForUpdatesResponse>;
  quitAndInstall(): Promise<QuitAndInstallResponse>;
}

function createInitialStatus(): UpdateStatus {
  const isPackaged = app.isPackaged;
  return {
    phase: isPackaged ? 'idle' : 'unsupported',
    currentVersion: app.getVersion(),
    enabled: DEFAULT_UPDATE_PREFERENCES.enabled,
    autoDownload: DEFAULT_UPDATE_PREFERENCES.autoDownload,
    isPackaged,
    availableVersion: null,
    downloadedVersion: null,
    downloadProgressPercent: null,
    lastCheckedAt: null,
    message: isPackaged ? 'Automatic update checks are enabled.' : 'Auto-update is only available in packaged builds.',
    error: null,
  };
}

export function createAutoUpdateService(
  updater: UpdaterLike = autoUpdater,
): AutoUpdateService {
  let initialized = false;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let checkInFlight = false;
  let status = createInitialStatus();
  const listeners = new Map<string, (...args: any[]) => void>();

  function emitStatus(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(IPC.UPDATER_STATUS, status);
    }
  }

  function setStatus(next: Partial<UpdateStatus>): void {
    status = {
      ...status,
      ...next,
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
    };
    emitStatus();
  }

  function clearTimers(): void {
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  }

  async function runCheck(manual: boolean): Promise<CheckForUpdatesResponse> {
    if (!app.isPackaged) {
      setStatus({
        phase: 'unsupported',
        message: 'Auto-update is only available in packaged builds.',
        error: null,
      });
      return {
        ok: false,
        status,
        error: 'Auto-update is only available in packaged builds.',
      };
    }

    if (checkInFlight) {
      return { ok: true, status };
    }

    checkInFlight = true;
    setStatus({
      phase: 'checking',
      lastCheckedAt: new Date().toISOString(),
      downloadProgressPercent: null,
      message: manual ? 'Checking for updates...' : 'Checking for updates in the background...',
      error: null,
    });

    try {
      await updater.checkForUpdates();
      return { ok: true, status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({
        phase: 'error',
        message: 'Update check failed.',
        error: message,
      });
      return { ok: false, status, error: message };
    } finally {
      checkInFlight = false;
    }
  }

  function scheduleAutomaticChecks(): void {
    clearTimers();
    if (!app.isPackaged || !status.enabled) {
      if (!app.isPackaged) {
        setStatus({
          phase: 'unsupported',
          message: 'Auto-update is only available in packaged builds.',
          error: null,
        });
      } else if (status.phase !== 'downloaded') {
        setStatus({
          phase: 'disabled',
          message: 'Automatic update checks are disabled.',
          error: null,
        });
      }
      return;
    }

    if (status.phase === 'disabled') {
      setStatus({
        phase: 'idle',
        message: 'Automatic update checks are enabled.',
        error: null,
      });
    }

    startupTimer = setTimeout(() => {
      void runCheck(false);
    }, INITIAL_CHECK_DELAY_MS);
    intervalTimer = setInterval(() => {
      void runCheck(false);
    }, AUTO_UPDATE_INTERVAL_MS);
  }

  function bindUpdaterListeners(): void {
    const subscriptions: Array<[string, (...args: any[]) => void]> = [
      ['checking-for-update', () => {
        setStatus({
          phase: 'checking',
          lastCheckedAt: new Date().toISOString(),
          message: 'Checking for updates...',
          error: null,
        });
      }],
      ['update-available', (info: UpdateInfoLike) => {
        const version = info?.version ?? null;
        setStatus({
          phase: status.autoDownload ? 'downloading' : 'available',
          availableVersion: version,
          downloadedVersion: null,
          downloadProgressPercent: status.autoDownload ? 0 : null,
          message: status.autoDownload
            ? `Update ${version ?? 'available'} found. Downloading...`
            : `Update ${version ?? 'available'} is ready to download.`,
          error: null,
        });
      }],
      ['update-not-available', () => {
        setStatus({
          phase: status.enabled ? 'upToDate' : 'disabled',
          availableVersion: null,
          downloadedVersion: null,
          downloadProgressPercent: null,
          message: 'You are running the latest version.',
          error: null,
        });
      }],
      ['download-progress', (progress: ProgressInfoLike) => {
        const percent = typeof progress?.percent === 'number' && Number.isFinite(progress.percent)
          ? Math.max(0, Math.min(100, progress.percent))
          : null;
        setStatus({
          phase: 'downloading',
          downloadProgressPercent: percent,
          message: percent === null
            ? 'Downloading update...'
            : `Downloading update... ${Math.round(percent)}%`,
          error: null,
        });
      }],
      ['update-downloaded', (info: UpdateInfoLike) => {
        const version = info?.version ?? status.availableVersion;
        setStatus({
          phase: 'downloaded',
          availableVersion: version ?? null,
          downloadedVersion: version ?? null,
          downloadProgressPercent: 100,
          message: `Update ${version ?? 'ready'} downloaded. Restart to install.`,
          error: null,
        });
      }],
      ['error', (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatus({
          phase: 'error',
          downloadProgressPercent: null,
          message: 'Auto-update encountered an error.',
          error: message,
        });
      }],
    ];

    for (const [eventName, listener] of subscriptions) {
      listeners.set(eventName, listener);
      updater.on(eventName, listener);
    }
  }

  return {
    initialize() {
      if (initialized) return;
      initialized = true;
      updater.autoDownload = status.autoDownload;
      updater.autoInstallOnAppQuit = status.autoDownload;
      bindUpdaterListeners();
      scheduleAutomaticChecks();
    },

    dispose() {
      clearTimers();
      for (const [eventName, listener] of listeners) {
        updater.removeListener(eventName, listener);
      }
      listeners.clear();
      initialized = false;
    },

    getState() {
      return status;
    },

    async configure(config) {
      status = {
        ...status,
        enabled: config.enabled,
        autoDownload: config.autoDownload,
      };
      updater.autoDownload = config.autoDownload;
      updater.autoInstallOnAppQuit = config.autoDownload;
      scheduleAutomaticChecks();
      emitStatus();
      return { ok: true, status };
    },

    async checkForUpdates(options = {}) {
      return runCheck(!!options.manual);
    },

    async quitAndInstall() {
      if (status.phase !== 'downloaded') {
        return {
          ok: false,
          error: 'No downloaded update is ready to install.',
        };
      }
      updater.quitAndInstall(false, true);
      return { ok: true };
    },
  };
}

export const autoUpdateService = createAutoUpdateService();
