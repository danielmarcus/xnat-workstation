/**
 * Preload Script — exposes typed IPC bridge to the renderer.
 *
 * Context isolation is enabled. The renderer accesses main process
 * functionality exclusively through window.electronAPI.
 *
 * XNAT credentials never flow through this bridge — the main process
 * handles authentication via a browser window and cookie-based sessions.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipcChannels';

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

    overwriteDicomSeg: (sessionId: string, targetScanId: string, dicomBase64: string, seriesDescription?: string) =>
      ipcRenderer.invoke(IPC.XNAT_OVERWRITE_DICOM_SEG, sessionId, targetScanId, dicomBase64, seriesDescription),

    overwriteDicomRtStruct: (sessionId: string, targetScanId: string, dicomBase64: string, seriesDescription?: string) =>
      ipcRenderer.invoke(IPC.XNAT_OVERWRITE_DICOM_RTSTRUCT, sessionId, targetScanId, dicomBase64, seriesDescription),

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
    saveViewportCapture: (
      bounds: { x: number; y: number; width: number; height: number },
      defaultName?: string,
    ) =>
      ipcRenderer.invoke(IPC.EXPORT_SAVE_VIEWPORT_CAPTURE, bounds, defaultName),
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
