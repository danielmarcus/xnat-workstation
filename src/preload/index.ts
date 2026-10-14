/**
 * Preload Script — exposes typed IPC bridge to the renderer.
 *
 * Context isolation is enabled. The renderer accesses main process
 * functionality exclusively through window.electronAPI.
 *
 * XNAT credentials never flow through this bridge — the main process
 * handles authentication via a browser window and cookie-based sessions.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/ipcChannels';

// A module run's message port (branch 9): relayed to the page, which talks to the sandbox on it.
ipcRenderer.on(IPC.MODULES_RUN_PORT, (e, info: { runId: string }) => {
  window.postMessage({ type: 'xw-module-port', runId: info.runId }, '*', e.ports);
});
ipcRenderer.on(IPC.MODULES_RUN_ENDED, (_e, info: { runId: string; reason: string }) => {
  window.postMessage({ type: 'xw-module-ended', runId: info.runId, reason: info.reason }, '*');
});

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  xnat: {
    browserLogin: (serverUrl: string) =>
      ipcRenderer.invoke(IPC.XNAT_BROWSER_LOGIN, serverUrl),

    logout: () =>
      ipcRenderer.invoke(IPC.XNAT_LOGOUT),

    validateSession: () =>
      ipcRenderer.invoke(IPC.XNAT_VALIDATE),

    getConnection: () =>
      ipcRenderer.invoke(IPC.XNAT_GET_CONNECTION),

    dicomwebFetch: (path: string, options?: { accept?: string }) =>
      ipcRenderer.invoke(IPC.XNAT_DICOMWEB_FETCH, path, options),

    // XNAT REST API browsing
    getProjects: () =>
      ipcRenderer.invoke(IPC.XNAT_GET_PROJECTS),
    getSubjects: (projectId: string) =>
      ipcRenderer.invoke(IPC.XNAT_GET_SUBJECTS, projectId),
    getSessions: (projectId: string, subjectId: string) =>
      ipcRenderer.invoke(IPC.XNAT_GET_SESSIONS, projectId, subjectId),
    getScans: (sessionId: string, options?: { includeSopClassUID?: boolean }) =>
      ipcRenderer.invoke(IPC.XNAT_GET_SCANS, sessionId, options),
    getScanFiles: (sessionId: string, scanId: string) =>
      ipcRenderer.invoke(IPC.XNAT_GET_SCAN_FILES, sessionId, scanId),
    getProjectSessions: (projectId: string) =>
      ipcRenderer.invoke(IPC.XNAT_GET_PROJECT_SESSIONS, projectId),

    downloadScanFile: (sessionId: string, scanId: string) =>
      ipcRenderer.invoke(IPC.XNAT_DOWNLOAD_SCAN_FILE, sessionId, scanId),

    uploadDicomSeg: (projectId: string, subjectId: string, sessionId: string, sessionLabel: string, sourceScanId: string, dicomBase64: string, label?: string) =>
      ipcRenderer.invoke(IPC.XNAT_UPLOAD_DICOM_SEG, projectId, subjectId, sessionId, sessionLabel, sourceScanId, dicomBase64, label),

    uploadDicomRtStruct: (
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomBase64: string,
      label?: string,
    ) =>
      ipcRenderer.invoke(
        IPC.XNAT_UPLOAD_DICOM_RTSTRUCT,
        projectId,
        subjectId,
        sessionId,
        sessionLabel,
        sourceScanId,
        dicomBase64,
        label,
      ),

    uploadDicomSr: (
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomBase64: string,
      label?: string,
    ) =>
      ipcRenderer.invoke(
        IPC.XNAT_UPLOAD_DICOM_SR,
        projectId,
        subjectId,
        sessionId,
        sessionLabel,
        sourceScanId,
        dicomBase64,
        label,
      ),

    overwriteDicomSeg: (sessionId: string, targetScanId: string, dicomBase64: string, seriesDescription?: string) =>
      ipcRenderer.invoke(IPC.XNAT_OVERWRITE_DICOM_SEG, sessionId, targetScanId, dicomBase64, seriesDescription),

    overwriteDicomRtStruct: (sessionId: string, targetScanId: string, dicomBase64: string, seriesDescription?: string) =>
      ipcRenderer.invoke(IPC.XNAT_OVERWRITE_DICOM_RTSTRUCT, sessionId, targetScanId, dicomBase64, seriesDescription),

    overwriteDicomSr: (sessionId: string, targetScanId: string, dicomBase64: string, seriesDescription?: string) =>
      ipcRenderer.invoke(IPC.XNAT_OVERWRITE_DICOM_SR, sessionId, targetScanId, dicomBase64, seriesDescription),

    getScanVersion: (sessionId: string, scanId: string) =>
      ipcRenderer.invoke(IPC.XNAT_GET_SCAN_VERSION, sessionId, scanId),

    prepareDicomForUpload: (
      type: 'SEG' | 'RTSTRUCT',
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomBase64: string,
      targetScanId?: string,
      seriesDescription?: string,
    ) =>
      ipcRenderer.invoke(
        IPC.XNAT_PREPARE_DICOM_UPLOAD,
        type,
        projectId,
        subjectId,
        sessionId,
        sessionLabel,
        sourceScanId,
        dicomBase64,
        targetScanId,
        seriesDescription,
      ),

    autoSaveTemp: (sessionId: string, sourceScanId: string, dicomBase64: string, tempFilename?: string) =>
      ipcRenderer.invoke(IPC.XNAT_AUTOSAVE_TEMP, sessionId, sourceScanId, dicomBase64, tempFilename),

    listTempFiles: (sessionId: string) =>
      ipcRenderer.invoke(IPC.XNAT_LIST_TEMP_FILES, sessionId),

    deleteScan: (sessionId: string, scanId: string, trashResourceName?: string) =>
      ipcRenderer.invoke(IPC.XNAT_DELETE_SCAN, sessionId, scanId, trashResourceName),

    deleteTempFile: (sessionId: string, filename: string) =>
      ipcRenderer.invoke(IPC.XNAT_DELETE_TEMP_FILE, sessionId, filename),

    downloadTempFile: (sessionId: string, filename: string) =>
      ipcRenderer.invoke(IPC.XNAT_DOWNLOAD_TEMP_FILE, sessionId, filename),
  },

  export: {
    saveScreenshot: (dataUrl: string, defaultName?: string) =>
      ipcRenderer.invoke(IPC.EXPORT_SAVE_SCREENSHOT, dataUrl, defaultName),
    copyToClipboard: (dataUrl: string) =>
      ipcRenderer.invoke(IPC.EXPORT_COPY_CLIPBOARD, dataUrl),
    copyViewportCapture: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(IPC.EXPORT_COPY_VIEWPORT_CAPTURE, bounds),
    saveDicom: (dicomData: string) =>
      ipcRenderer.invoke(IPC.EXPORT_SAVE_DICOM, dicomData),
    saveAllSlices: (slices: Array<{ dataUrl: string; filename: string }>) =>
      ipcRenderer.invoke(IPC.EXPORT_SAVE_ALL_SLICES, slices),
    saveReport: (text: string, defaultName?: string) =>
      ipcRenderer.invoke(IPC.EXPORT_SAVE_REPORT, text, defaultName),
    saveDicomSeg: (dicomBase64: string, defaultName?: string) =>
      ipcRenderer.invoke(IPC.EXPORT_SAVE_DICOM_SEG, dicomBase64, defaultName),
    saveDicomRtStruct: (dicomBase64: string, defaultName?: string) =>
      ipcRenderer.invoke(IPC.EXPORT_SAVE_DICOM_RTSTRUCT, dicomBase64, defaultName),
    saveDicomSr: (dicomBase64: string, defaultName?: string) =>
      ipcRenderer.invoke(IPC.EXPORT_SAVE_DICOM_SR, dicomBase64, defaultName),
    saveViewportCapture: (
      bounds: { x: number; y: number; width: number; height: number },
      defaultName?: string,
    ) =>
      ipcRenderer.invoke(IPC.EXPORT_SAVE_VIEWPORT_CAPTURE, bounds, defaultName),
  },

  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),
  },

  backup: {
    writeFile: (sessionId: string, filename: string, base64Data: string) =>
      ipcRenderer.invoke(IPC.BACKUP_WRITE_FILE, sessionId, filename, base64Data),
    readFile: (sessionId: string, filename: string) =>
      ipcRenderer.invoke(IPC.BACKUP_READ_FILE, sessionId, filename),
    deleteFile: (sessionId: string, filename: string) =>
      ipcRenderer.invoke(IPC.BACKUP_DELETE_FILE, sessionId, filename),
    listSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC.BACKUP_LIST_SESSION, sessionId),
    readManifest: (sessionId: string) =>
      ipcRenderer.invoke(IPC.BACKUP_READ_MANIFEST, sessionId),
    writeManifest: (sessionId: string, manifestJson: string) =>
      ipcRenderer.invoke(IPC.BACKUP_WRITE_MANIFEST, sessionId, manifestJson),
    deleteSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC.BACKUP_DELETE_SESSION, sessionId),
    listAllSessions: () =>
      ipcRenderer.invoke(IPC.BACKUP_LIST_ALL_SESSIONS),
    getCachePath: () =>
      ipcRenderer.invoke(IPC.BACKUP_GET_CACHE_PATH),
  },

  checkpoint: {
    write: (key: string, record: unknown) => ipcRenderer.invoke(IPC.CHECKPOINT_WRITE, key, record),
    list: (key: string, legacy?: unknown) => ipcRenderer.invoke(IPC.CHECKPOINT_LIST, key, legacy),
    move: (fromKey: string, toKey: string, containerLabel: string) => ipcRenderer.invoke(IPC.CHECKPOINT_MOVE, fromKey, toKey, containerLabel),
    read: (key: string, id: string) => ipcRenderer.invoke(IPC.CHECKPOINT_READ, key, id),
    delete: (key: string, id: string) => ipcRenderer.invoke(IPC.CHECKPOINT_DELETE, key, id),
    exportFile: (key: string, id: string) => ipcRenderer.invoke(IPC.CHECKPOINT_EXPORT, key, id),
    importFile: () => ipcRenderer.invoke(IPC.CHECKPOINT_IMPORT),
  },

  modules: {
    list: () => ipcRenderer.invoke(IPC.MODULES_LIST),
    pick: () => ipcRenderer.invoke(IPC.MODULES_PICK),
    /** A file dropped on Settings › Modules: its path comes from the File, via webUtils. */
    inspectDropped: (file: File) => ipcRenderer.invoke(IPC.MODULES_INSPECT_DROPPED, webUtils.getPathForFile(file)),
    install: (token: string, acceptCommunity: boolean) => ipcRenderer.invoke(IPC.MODULES_INSTALL, token, acceptCommunity),
    remove: (id: string) => ipcRenderer.invoke(IPC.MODULES_REMOVE, id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.MODULES_SET_ENABLED, id, enabled),
    setAllowCommunity: (allow: boolean) => ipcRenderer.invoke(IPC.MODULES_SET_ALLOW_COMMUNITY, allow),
    trustKeyPick: () => ipcRenderer.invoke(IPC.MODULES_TRUST_KEY_PICK),
    untrustKey: (keyId: string) => ipcRenderer.invoke(IPC.MODULES_UNTRUST_KEY, keyId),
    runStart: (id: string) => ipcRenderer.invoke(IPC.MODULES_RUN_START, id),
    saveLog: (text: string, suggested: string) => ipcRenderer.invoke(IPC.MODULES_SAVE_LOG, text, suggested),
    runStop: (runId: string) => ipcRenderer.invoke(IPC.MODULES_RUN_STOP, runId),
  },

  diagnostics: {
    getMainSnapshot: () =>
      ipcRenderer.invoke(IPC.DIAGNOSTICS_GET_MAIN_SNAPSHOT),
  },

  app: {
    /** Main asks the renderer whether it's safe to quit (unsaved-annotations guard). */
    onCloseRequested: (callback: () => void) => {
      const wrapped = () => callback();
      ipcRenderer.on(IPC.APP_CLOSE_REQUESTED, wrapped);
      return () => {
        ipcRenderer.removeListener(IPC.APP_CLOSE_REQUESTED, wrapped);
      };
    },
    /** Renderer reports the user's decision back to main. */
    sendCloseDecision: (decision: 'proceed' | 'cancel') =>
      ipcRenderer.send(IPC.APP_CLOSE_DECISION, decision),
  },

  updater: {
    getState: () =>
      ipcRenderer.invoke(IPC.UPDATER_GET_STATE),
    configure: (config: { enabled: boolean; autoDownload: boolean }) =>
      ipcRenderer.invoke(IPC.UPDATER_CONFIGURE, config),
    checkForUpdates: () =>
      ipcRenderer.invoke(IPC.UPDATER_CHECK_FOR_UPDATES),
    quitAndInstall: () =>
      ipcRenderer.invoke(IPC.UPDATER_QUIT_AND_INSTALL),
    onStatus: (callback: (status: unknown) => void) => {
      const wrappedCallback = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
      ipcRenderer.on(IPC.UPDATER_STATUS, wrappedCallback);
      return () => {
        ipcRenderer.removeListener(IPC.UPDATER_STATUS, wrappedCallback);
      };
    },
  },

  // E2E testing: direct login bypass (only registered when E2E_TESTING=1)
  e2e: {
    directLogin: (serverUrl: string, username: string, password: string) =>
      ipcRenderer.invoke('e2e:direct-login', serverUrl, username, password),
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const allowedChannels = [IPC.XNAT_SESSION_EXPIRED];
    if (!allowedChannels.includes(channel as any)) {
      console.warn(`[preload] Blocked IPC listener for unknown channel: ${channel}`);
      return () => {};
    }
    const wrappedCallback = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, wrappedCallback);
    // Return unsubscribe function to prevent listener accumulation
    return () => {
      ipcRenderer.removeListener(channel, wrappedCallback);
    };
  },
});
