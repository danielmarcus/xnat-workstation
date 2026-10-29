// Shared type definitions between main and renderer processes
export * from './viewer';
export * from './dicom';
export * from './xnat';
export * from './preferences';
export * from './backup';
export * from './checkpoint';
export * from './diagnostics';
export * from './updater';
export * from './annotation';

import type {
  XnatLoginResult,
  XnatSessionStatus,
  XnatConnectionInfo,
  ProxiedFetchResult,
  XnatProject,
  XnatSubject,
  XnatSession,
  XnatScan,
  XnatUploadResult,
} from './xnat';
import type { MainDiagnosticsSnapshotResult } from './diagnostics';
import type {
  CheckForUpdatesResponse,
  ConfigureUpdaterRequest,
  ConfigureUpdaterResponse,
  QuitAndInstallResponse,
  UpdateStatus,
} from './updater';

export interface ElectronAPI {
  platform: string;
  xnat: {
    browserLogin(serverUrl: string): Promise<XnatLoginResult>;
    logout(): Promise<void>;
    validateSession(): Promise<XnatSessionStatus>;
    getConnection(): Promise<XnatConnectionInfo | null>;
    dicomwebFetch(
      path: string,
      options?: { accept?: string },
    ): Promise<ProxiedFetchResult>;
    getProjects(): Promise<XnatProject[]>;
    getSubjects(projectId: string): Promise<XnatSubject[]>;
    getSessions(projectId: string, subjectId: string): Promise<XnatSession[]>;
    getScans(
      sessionId: string,
      options?: { includeSopClassUID?: boolean },
    ): Promise<XnatScan[]>;
    getScanFiles(
      sessionId: string,
      scanId: string,
    ): Promise<{ ok: boolean; files: Array<{ uri: string; instanceNumber?: number }>; serverUrl?: string; error?: string }>;
    getProjectSessions(
      projectId: string,
    ): Promise<Array<{ subjectId: string; modality: string }>>;
    downloadScanFile(
      sessionId: string,
      scanId: string,
    ): Promise<{ ok: boolean; data?: string; error?: string }>;
    uploadDicomSeg(
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomBase64: string,
      label?: string,
    ): Promise<XnatUploadResult>;
    uploadDicomRtStruct(
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomBase64: string,
      label?: string,
    ): Promise<XnatUploadResult>;
    uploadDicomSr(
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomBase64: string,
      label?: string,
    ): Promise<XnatUploadResult>;
    overwriteDicomSeg(
      sessionId: string,
      targetScanId: string,
      dicomBase64: string,
      seriesDescription?: string,
    ): Promise<XnatUploadResult>;
    overwriteDicomRtStruct(
      sessionId: string,
      targetScanId: string,
      dicomBase64: string,
      seriesDescription?: string,
    ): Promise<XnatUploadResult>;
    overwriteDicomSr(
      sessionId: string,
      targetScanId: string,
      dicomBase64: string,
      seriesDescription?: string,
    ): Promise<XnatUploadResult>;
    /** Poll the current server-side version token for a scan (H6). Null = unknown. */
    getScanVersion(sessionId: string, scanId: string): Promise<string | null>;
    prepareDicomForUpload(
      type: 'SEG' | 'RTSTRUCT',
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomBase64: string,
      targetScanId?: string,
      seriesDescription?: string,
    ): Promise<{ ok: boolean; data?: string; scanId?: string; error?: string }>;
    autoSaveTemp(
      sessionId: string,
      sourceScanId: string,
      dicomBase64: string,
      tempFilename?: string,
    ): Promise<{ ok: boolean; url?: string; error?: string }>;
    listTempFiles(
      sessionId: string,
    ): Promise<{ ok: boolean; files?: Array<{ name: string; uri: string; size: number }>; error?: string }>;
    deleteScan(
      sessionId: string,
      scanId: string,
      trashResourceName?: string,
    ): Promise<{ ok: boolean; error?: string }>;
    deleteTempFile(
      sessionId: string,
      filename: string,
    ): Promise<{ ok: boolean; error?: string }>;
    downloadTempFile(
      sessionId: string,
      filename: string,
    ): Promise<{ ok: boolean; data?: string; error?: string }>;
  };
  export: {
    saveScreenshot(
      dataUrl: string,
      defaultName?: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }>;
    copyToClipboard(
      dataUrl: string,
    ): Promise<{ ok: boolean; error?: string }>;
    copyViewportCapture(
      bounds: { x: number; y: number; width: number; height: number },
    ): Promise<{ ok: boolean; error?: string }>;
    saveDicom(
      dicomData: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }>;
    saveAllSlices(
      slices: Array<{ dataUrl: string; filename: string }>,
    ): Promise<{ ok: boolean; path?: string; count?: number; error?: string }>;
    saveReport(
      text: string,
      defaultName?: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }>;
    saveDicomSeg(
      dicomBase64: string,
      defaultName?: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }>;
    saveDicomRtStruct(
      dicomBase64: string,
      defaultName?: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }>;
    saveDicomSr(
      dicomBase64: string,
      defaultName?: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }>;
    saveViewportCapture(
      bounds: { x: number; y: number; width: number; height: number },
      defaultName?: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }>;
  };
  shell: {
    openExternal(url: string): Promise<{ ok: boolean; error?: string }>;
  };
  backup: {
    writeFile(
      sessionId: string,
      filename: string,
      base64Data: string,
    ): Promise<{ ok: boolean; path?: string; sizeBytes?: number; error?: string }>;
    readFile(
      sessionId: string,
      filename: string,
    ): Promise<{ ok: boolean; data?: string; error?: string }>;
    deleteFile(
      sessionId: string,
      filename: string,
    ): Promise<{ ok: boolean; error?: string }>;
    listSession(
      sessionId: string,
    ): Promise<{ ok: boolean; files?: Array<{ name: string; sizeBytes: number; modifiedAt: string }>; error?: string }>;
    readManifest(
      sessionId: string,
    ): Promise<{ ok: boolean; manifest?: import('./backup').BackupManifest; error?: string }>;
    writeManifest(
      sessionId: string,
      manifestJson: string,
    ): Promise<{ ok: boolean; error?: string }>;
    deleteSession(
      sessionId: string,
    ): Promise<{ ok: boolean; error?: string }>;
    listAllSessions(): Promise<{ ok: boolean; sessions?: import('./backup').BackupSessionSummary[]; error?: string }>;
    getCachePath(): Promise<{ ok: boolean; path?: string; error?: string }>;
  };
  checkpoint?: {
    write(key: string, record: import('./checkpoint').CheckpointRecord): Promise<{ ok: boolean; error?: string }>;
    /** `legacy` names the container so checkpoints filed under the pre-#102 key are adopted. */
    list(key: string, legacy?: { seriesInstanceUID: string; containerLabel: string }): Promise<{ ok: boolean; checkpoints?: import('./checkpoint').CheckpointMeta[]; error?: string }>;
    /** A rename: move every checkpoint from one key to another, relabelled. */
    move(fromKey: string, toKey: string, containerLabel: string): Promise<{ ok: boolean; error?: string }>;
    read(key: string, id: string): Promise<{ ok: boolean; record?: import('./checkpoint').CheckpointRecord; error?: string }>;
    delete(key: string, id: string): Promise<{ ok: boolean; error?: string }>;
    /** Save a checkpoint to a file the user picks. */
    exportFile(key: string, id: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
    /** Read a checkpoint file the user picks (validated shape; not yet stored). */
    importFile(): Promise<{ ok: boolean; record?: import('./checkpoint').CheckpointRecord; canceled?: boolean; error?: string }>;
  };
  modules?: {
    list(): Promise<{ modules: import('../modules/types').ModuleListing[]; settings: import('../modules/types').ModuleSettings }>;
    /** Pick a .xwmodule; it is checked and held for install under a token. */
    pick(): Promise<import('../modules/types').ModuleInspection>;
    inspectDropped(file: File): Promise<import('../modules/types').ModuleInspection>;
    install(token: string, acceptCommunity: boolean): Promise<{ ok: boolean; reason?: string; needsConfirmation?: boolean; summary?: import('../modules/types').ModuleSummary }>;
    remove(id: string): Promise<{ ok: boolean; reason?: string }>;
    setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }>;
    setAllowCommunity(allow: boolean): Promise<{ ok: boolean }>;
    /** Pick a publisher's public.json and trust its key. */
    trustKeyPick(): Promise<{ ok: boolean; reason?: string; canceled?: boolean; key?: import('../modules/types').TrustedKey }>;
    untrustKey(keyId: string): Promise<{ ok: boolean }>;
    /** Start a sandboxed run; its port arrives as a window message { type: 'xw-module-port', runId }. */
    runStart(id: string): Promise<{ ok: true; runId: string } | { ok: false; reason: string }>;
    /** Save a module's log to a file the user picks. */
    saveLog(text: string, suggested: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; reason?: string }>;
    /** End a run: its sandboxed process is destroyed. */
    runStop(runId: string): Promise<{ ok: boolean }>;
  };
  /** The edition's extensions (docs/extension-framework.md). Each call returns the updated list. */
  extensions?: {
    list(): Promise<import('../extensions/types').ExtensionSummary[]>;
    setEnabled(id: string, enabled: boolean): Promise<import('../extensions/types').ExtensionSummary[]>;
    /** The renderer could not start an extension's renderer part. */
    rendererFailed(id: string, reason: string): Promise<import('../extensions/types').ExtensionSummary[]>;
    /** A renderer part's ext.xnat call, made in main. */
    xnat(id: string, op: string, args: unknown[]): Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
    /** A renderer part's ext.channel.request(), answered by its main part. */
    channelRequest(id: string, message: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
    /** Main parts' ext.channel.post(); returns the unsubscribe. */
    onChannelMessage(callback: (id: string, message: unknown) => void): () => void;
  };
  diagnostics?: {
    getMainSnapshot(): Promise<MainDiagnosticsSnapshotResult>;
  };
  updater?: {
    getState(): Promise<UpdateStatus>;
    configure(config: ConfigureUpdaterRequest): Promise<ConfigureUpdaterResponse>;
    checkForUpdates(): Promise<CheckForUpdatesResponse>;
    quitAndInstall(): Promise<QuitAndInstallResponse>;
    onStatus(callback: (status: UpdateStatus) => void): () => void;
  };
  /** App-close guard: main asks before quitting; the renderer reports the decision. */
  app?: {
    onCloseRequested(callback: () => void): () => void;
    sendCloseDecision(decision: 'proceed' | 'cancel'): void;
  };
  on(channel: string, callback: (...args: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
