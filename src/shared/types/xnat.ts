/**
 * XNAT Connection & Session Management Types
 *
 * These types are shared between main and renderer processes.
 * Sensitive data (tokens, passwords) never crosses the IPC boundary.
 */

/** Connection lifecycle status */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Connection info visible to renderer (no secrets) */
export interface XnatConnectionInfo {
  serverUrl: string;
  username: string;
  connectedAt: number; // timestamp in ms
}

/** Result from login attempt */
export interface XnatLoginResult {
  success: boolean;
  error?: string;
  connection?: XnatConnectionInfo;
}

/** Result from session validation */
export interface XnatSessionStatus {
  valid: boolean;
  username?: string;
  connection?: XnatConnectionInfo;
}

/** Result from proxied DICOMweb fetch */
export interface ProxiedFetchResult {
  ok: boolean;
  status: number;
  data?: unknown; // JSON-parsed body for QIDO-RS responses
  error?: string;
}

// ─── XNAT REST API Browse Types ──────────────────────────────────

export interface XnatProject {
  id: string;
  name: string;
  description?: string;
  subjectCount?: number;
  sessionCount?: number;
}

export interface XnatSubject {
  id: string;
  label: string;
  projectId: string;
  sessionCount?: number;
}

export interface XnatSession {
  id: string;
  label: string;
  projectId: string;
  subjectId: string;
  modality?: string;
  date?: string;
  scanCount?: number;
}

export interface XnatScan {
  id: string;
  type?: string;
  seriesDescription?: string;
  quality?: string;
  frames?: number;
  modality?: string;
  sopClassUID?: string;
}

// ─── XNAT Upload Types ──────────────────────────────────────

/** Context for targeting an XNAT upload destination */
export interface XnatUploadContext {
  projectId: string;
  subjectId: string;
  sessionId: string;
  sessionLabel: string;
  scanId: string;       // Source scan ID (e.g. "3", "12") — used to derive upload scan number
}

/** Result from upload attempt */
export interface XnatUploadResult {
  ok: boolean;
  url?: string;     // XNAT URL of created scan
  scanId?: string;  // XNAT scan ID (e.g. "3004")
  error?: string;
}
