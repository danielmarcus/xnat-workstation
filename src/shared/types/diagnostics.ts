export type DiagnosticsLogLevel = 'log' | 'info' | 'warn' | 'error';
export type DiagnosticsLogStream = 'stdout' | 'stderr';
export type DiagnosticsLogSource = 'main' | 'renderer';

export interface DiagnosticsLogEntry {
  timestamp: string;
  source: DiagnosticsLogSource;
  level: DiagnosticsLogLevel;
  stream: DiagnosticsLogStream;
  message: string;
}

export interface MainDiagnosticsSnapshot {
  generatedAt: string;
  app: {
    name: string;
    version: string;
    isPackaged: boolean;
    pid: number;
    uptimeSec: number;
    windowCount: number;
  };
  runtime: {
    electron?: string;
    chrome?: string;
    node?: string;
    v8?: string;
    platform: string;
    arch: string;
  };
  system: {
    osType: string;
    osRelease: string;
    osVersion: string;
    cpuModel: string;
    cpuCount: number;
    totalMemoryMB: number;
    freeMemoryMB: number;
    loadAverage: number[];
    hostnameFingerprint: string;
  };
  process: {
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
    argv: string[];
  };
  logs: {
    stdout: DiagnosticsLogEntry[];
    stderr: DiagnosticsLogEntry[];
  };
}

export type MainDiagnosticsSnapshotResult =
  | { ok: true; snapshot: MainDiagnosticsSnapshot }
  | { ok: false; error: string };
