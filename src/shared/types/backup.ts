// ─── Local Backup Cache Types ────────────────────────────────────
//
// These types describe the on-disk manifest and summary structures
// used by the local file backup system. The backup cache lives under
// Electron's userData directory at <userData>/backups/<sessionId>/.

export interface BackupManifest {
  version: 1;
  sessionId: string;
  serverUrl: string;
  lastUpdated: string; // ISO 8601
  entries: BackupManifestEntry[];
  /** XNAT project ID (e.g. "MyProject") */
  projectId?: string;
  /** XNAT subject ID (e.g. "XNAT_S00123") — needed to auto-load session for recovery */
  subjectId?: string;
  /** Human-readable subject label (e.g. "Subject_001") */
  subjectLabel?: string;
  /** Human-readable session label (e.g. "Session_001_MR") */
  sessionLabel?: string;
}

export interface BackupManifestEntry {
  segmentationId: string;
  filename: string; // e.g. "seg1234_20260302143022.dcm"
  format: 'SEG' | 'RTSTRUCT';
  sourceScanId: string;
  timestamp: string; // ISO 8601
  sizeBytes: number;
}

/** Lightweight summary returned when listing all backup sessions. */
export interface BackupSessionSummary {
  sessionId: string;
  serverUrl: string;
  entryCount: number;
  totalSizeBytes: number;
  lastUpdated: string; // ISO 8601
  /** XNAT project ID (e.g. "MyProject") */
  projectId: string;
  /** XNAT subject ID (e.g. "XNAT_S00123") */
  subjectId: string;
  /** Human-readable subject label (e.g. "Subject_001") */
  subjectLabel: string;
  /** Human-readable session label (e.g. "Session_001_MR") */
  sessionLabel: string;
}
