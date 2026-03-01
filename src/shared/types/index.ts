// Shared type definitions between main and renderer processes
export * from './viewer';
export * from './dicom';
export * from './xnat';
export * from './preferences';

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
    ): Promise<{ ok: boolean; files: string[]; serverUrl?: string; error?: string }>;
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
    saveViewportCapture(
      bounds: { x: number; y: number; width: number; height: number },
      defaultName?: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }>;
  };
  on(channel: string, callback: (...args: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
