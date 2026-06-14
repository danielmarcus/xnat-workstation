/**
 * xnatUploadApi (Transport TR5, renderer side) — adapts the real
 * `window.electronAPI.xnat` upload/overwrite/download surface to the
 * `XnatUploadApi` interface that `createXnatTransport` consumes.
 *
 * This is the production counterpart to `createMockXnatApi`: the mock is the
 * in-memory reference the adapter + conflict flow are verified against offline,
 * and this wrapper feeds the SAME `XnatUploadApi` shape from real IPC results so
 * `createXnatTransport(this)` runs unchanged against a live server.
 *
 * It does PLUMBING ONLY — it never fires a save itself; it maps an IPC result
 * the caller already received. The electronAPI slice is injected (not reached
 * for via `window`) so the mapping logic is unit-testable with a plain fake.
 *
 * Failure classification (IPC handlers return `{ ok:false, error:string }` with
 * no structured status, so we read the message the main-process XNAT client
 * produced — it embeds HTTP status codes and known markers):
 *   - version conflict  → HTTP 409, or a "conflict" / "version" marker → `{ ok:false, conflict:true, serverVersionToken }`
 *   - permanent failure  → 4xx (400/401/403/404/422), "permission denied", "not authenticated", "invalid" → `{ ok:false, kind:'permanent' }`
 *   - transient failure  → everything else: network/timeout/5xx/"not connected" → `{ ok:false, kind:'transient' }`
 *     (transient is the safe default so a flaky network retries rather than gives up).
 */
import type { XnatUploadApi, XnatWriteResult } from './xnatTransport';

/** Result shape every upload/overwrite IPC handler returns (mirrors XnatUploadResult). */
interface XnatWriteIpcResult {
  ok: boolean;
  url?: string;
  scanId?: string;
  error?: string;
  versionToken?: string;
  /** Optional structured status if a future handler surfaces it (used if present). */
  status?: number;
  conflict?: boolean;
  serverVersionToken?: string;
}

/**
 * The minimal `window.electronAPI.xnat` surface this wrapper needs. Declared
 * structurally (not the full ElectronAPI['xnat']) so tests can pass a small fake
 * and so the wrapper depends only on what it uses.
 */
export interface XnatUploadElectronApi {
  uploadDicomSeg(
    projectId: string,
    subjectId: string,
    sessionId: string,
    sessionLabel: string,
    sourceScanId: string,
    dicomBase64: string,
    label?: string,
  ): Promise<XnatWriteIpcResult>;
  uploadDicomRtStruct(
    projectId: string,
    subjectId: string,
    sessionId: string,
    sessionLabel: string,
    sourceScanId: string,
    dicomBase64: string,
    label?: string,
  ): Promise<XnatWriteIpcResult>;
  overwriteDicomSeg(
    sessionId: string,
    targetScanId: string,
    dicomBase64: string,
    seriesDescription?: string,
  ): Promise<XnatWriteIpcResult>;
  uploadDicomSr(
    projectId: string,
    subjectId: string,
    sessionId: string,
    sessionLabel: string,
    sourceScanId: string,
    dicomBase64: string,
    label?: string,
  ): Promise<XnatWriteIpcResult>;
  overwriteDicomRtStruct(
    sessionId: string,
    targetScanId: string,
    dicomBase64: string,
    seriesDescription?: string,
  ): Promise<XnatWriteIpcResult>;
  overwriteDicomSr(
    sessionId: string,
    targetScanId: string,
    dicomBase64: string,
    seriesDescription?: string,
  ): Promise<XnatWriteIpcResult>;
}

const HTTP_STATUS_RE = /\b(4\d\d|5\d\d)\b/;

/** Classify a failed IPC result into transient | permanent and detect conflicts. */
function classifyFailure(res: XnatWriteIpcResult): XnatWriteResult {
  const error = res.error ?? 'Unknown XNAT error';
  const lower = error.toLowerCase();

  // Prefer structured status if a handler ever surfaces it.
  const status = typeof res.status === 'number'
    ? res.status
    : (() => {
        const m = HTTP_STATUS_RE.exec(error);
        return m ? Number(m[1]) : undefined;
      })();

  // ── Conflict (H5): server advanced past our base version ──
  const isConflict = res.conflict === true
    || status === 409
    || lower.includes('conflict')
    || lower.includes('version');
  if (isConflict) {
    return {
      ok: false,
      error,
      conflict: true,
      serverVersionToken: res.serverVersionToken,
    };
  }

  // ── Permanent: 4xx / auth / validation — retrying won't help ──
  const isPermanent =
    (typeof status === 'number' && status >= 400 && status < 500)
    || lower.includes('permission denied')
    || lower.includes('not authenticated')
    || lower.includes('unauthorized')
    || lower.includes('forbidden')
    || lower.includes('invalid');
  if (isPermanent) {
    return { ok: false, error, kind: 'permanent' };
  }

  // ── Transient: network/timeout/5xx/not-connected — safe to retry ──
  return { ok: false, error, kind: 'transient' };
}

/** Map a successful IPC result to the `XnatWriteResult` success shape. */
function mapSuccess(res: XnatWriteIpcResult): XnatWriteResult {
  // scanId + versionToken are required by the success contract; surface a
  // permanent error rather than fabricating values if the handler omitted them.
  if (!res.scanId || !res.versionToken) {
    return {
      ok: false,
      error: 'XNAT write succeeded but returned no scanId/versionToken',
      kind: 'permanent',
    };
  }
  return { ok: true, scanId: res.scanId, versionToken: res.versionToken };
}

export function createXnatUploadApi(electronApi: XnatUploadElectronApi): XnatUploadApi {
  function mapResult(res: XnatWriteIpcResult): XnatWriteResult {
    return res.ok ? mapSuccess(res) : classifyFailure(res);
  }
  // A thrown IPC call (transport-level failure) is transient by default.
  const asTransient = (err: unknown): XnatWriteResult => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    kind: 'transient',
  });

  return {
    async uploadSeg(p) {
      try {
        return mapResult(await electronApi.uploadDicomSeg(
          p.projectId, p.subjectId, p.sessionId, p.sessionLabel, p.sourceScanId, p.dicomBase64, p.label,
        ));
      } catch (err) {
        return asTransient(err);
      }
    },

    async uploadRtStruct(p) {
      try {
        return mapResult(await electronApi.uploadDicomRtStruct(
          p.projectId, p.subjectId, p.sessionId, p.sessionLabel, p.sourceScanId, p.dicomBase64, p.label,
        ));
      } catch (err) {
        return asTransient(err);
      }
    },

    async uploadSr(p) {
      try {
        return mapResult(await electronApi.uploadDicomSr(
          p.projectId, p.subjectId, p.sessionId, p.sessionLabel, p.sourceScanId, p.dicomBase64, p.label,
        ));
      } catch (err) {
        return asTransient(err);
      }
    },

    async overwriteSeg(p) {
      try {
        return mapResult(await electronApi.overwriteDicomSeg(p.sessionId, p.targetScanId, p.dicomBase64, p.seriesDescription));
      } catch (err) {
        return asTransient(err);
      }
    },

    async overwriteRtStruct(p) {
      try {
        return mapResult(await electronApi.overwriteDicomRtStruct(p.sessionId, p.targetScanId, p.dicomBase64, p.seriesDescription));
      } catch (err) {
        return asTransient(err);
      }
    },

    async overwriteSr(p) {
      try {
        return mapResult(await electronApi.overwriteDicomSr(p.sessionId, p.targetScanId, p.dicomBase64, p.seriesDescription));
      } catch (err) {
        return asTransient(err);
      }
    },

    /**
     * No cheap "head/metadata version" IPC exists today, so external-change
     * detection (H6) cannot be polled from the live surface yet — return null
     * ("unknown"), which matches `getServerVersion` semantics (the transport
     * treats null as "no known server version"). A future step may add a light
     * catalog/HEAD IPC; until then this is intentionally a no-op.
     */
    async getVersion() {
      return null;
    },
  };
}
