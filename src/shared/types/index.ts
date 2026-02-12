// Shared type definitions between main and renderer processes
export * from './viewer';
export * from './dicom';
export * from './xnat';
export * from './ai';

import type {
  XnatLoginCredentials,
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

import type {
  AiModelConfig,
  AiServerStatus,
  AiAnalysisRequest,
  AiAnalysisResult,
  AiServerStatusUpdate,
  ModelFileStatus,
  ModelPreset,
} from './ai';

export interface ElectronAPI {
  platform: string;
  xnat: {
    login(creds: XnatLoginCredentials): Promise<XnatLoginResult>;
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
    getScans(sessionId: string): Promise<XnatScan[]>;
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
    ): Promise<XnatUploadResult>;
    uploadDicomRtStruct(
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomBase64: string,
    ): Promise<XnatUploadResult>;
    overwriteDicomSeg(
      sessionId: string,
      targetScanId: string,
      dicomBase64: string,
    ): Promise<XnatUploadResult>;
    autoSaveTemp(
      sessionId: string,
      sourceScanId: string,
      dicomBase64: string,
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
  };
  ai: {
    getConfig(): Promise<AiModelConfig>;
    setConfig(config: Partial<AiModelConfig>): Promise<{ ok: boolean; error?: string }>;
    startServer(): Promise<{ ok: boolean; error?: string }>;
    stopServer(): Promise<{ ok: boolean }>;
    getStatus(): Promise<{ status: AiServerStatus; error?: string }>;
    analyzeImage(
      request: AiAnalysisRequest,
    ): Promise<{ ok: boolean; result?: AiAnalysisResult; error?: string }>;
    checkModels(): Promise<ModelFileStatus[]>;
    cancelAnalysis(): Promise<{ ok: boolean }>;
    openModelsDir(): Promise<{ ok: boolean }>;
    browseFile(title: string, filters?: Array<{ name: string; extensions: string[] }>): Promise<{ ok: boolean; path?: string }>;
    scanModels(): Promise<ModelPreset[]>;
  };
  on(channel: string, callback: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
