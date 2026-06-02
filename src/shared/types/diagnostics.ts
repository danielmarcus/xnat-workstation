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

// ── Crash snapshots (MV-Phase 7.1, spec §13.8) ──────────────────────────
// Written automatically to <userData>/diagnostics/{timestamp}.json when the
// renderer hits an unhandled error. Surfaced via a banner on next launch.

/** What triggered the crash snapshot. */
export type CrashSnapshotReason =
  | 'error-boundary'        // React render error caught by an ErrorBoundary
  | 'unhandled-rejection'   // unhandled promise rejection in the renderer
  | 'uncaught-error';       // window 'error' event

export interface CrashSnapshotPayload {
  reason: CrashSnapshotReason;
  /** ISO timestamp at capture time. */
  capturedAt: string;
  /** Error message (de-identified before write). */
  message: string;
  /** Error stack, if available (de-identified before write). */
  stack?: string;
  /** React component stack for error-boundary crashes. */
  componentStack?: string;
  /** Which boundary caught it ('app' or a viewport id like 'panel_0'). */
  boundary?: string;
  /** Recent renderer console entries leading up to the crash. */
  rendererLogs: DiagnosticsLogEntry[];
  /** App version string at capture time. */
  appVersion?: string;
}

export interface CrashSnapshotSummary {
  /** Filename (also the snapshot id), e.g. "2026-06-02T18-30-12-345Z.json". */
  id: string;
  capturedAt: string;
  reason: CrashSnapshotReason;
  message: string;
}

export type CrashSnapshotWriteResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type CrashSnapshotListResult =
  | { ok: true; snapshots: CrashSnapshotSummary[] }
  | { ok: false; error: string };

export type CrashSnapshotReadResult =
  | { ok: true; snapshot: CrashSnapshotPayload }
  | { ok: false; error: string };
