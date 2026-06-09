/**
 * In-memory mock XNAT API (the mocked-XNAT harness).
 *
 * Simulates the XNAT upload/overwrite/version surface (the `XnatUploadApi` the
 * xnatTransport adapter calls) deterministically — version tokens via a per-scan
 * counter (no clock/random), conflict on stale base token, and injectable
 * external-edit / failures. Lets the real adapter + the save/conflict flow be
 * exercised offline (unit + E2E) with no live server and no real data.
 *
 * Upload assigns a synthetic `30xx` scan id (the SEG-scan convention) per source
 * scan. Used by unit tests and the E2E harness (which installs it in place of the
 * real electronAPI.xnat).
 */
import type { XnatUploadApi, XnatWriteResult } from './xnatTransport';

interface ScanState { version: number; dicomBase64: string }

export interface MockXnatApi extends XnatUploadApi {
  /** Simulate another source modifying a scan (bumps its version → next overwrite conflicts). */
  _externalEdit(sessionId: string, scanId: string): void;
  /** Bump EVERY stored scan's version (E2E conflict injection without knowing the scan id). */
  _externalEditAll(): void;
  /** Make the next write fail with the given kind (cleared after one call). */
  _failNext(f: { kind: 'transient' | 'permanent'; error?: string }): void;
  /** Inspect stored scans (tests). */
  _scans(): Array<{ sessionId: string; scanId: string; version: number }>;
}

export function createMockXnatApi(): MockXnatApi {
  // key = `${sessionId}/${scanId}`
  const scans = new Map<string, ScanState>();
  let nextSegScan = 3001;
  let failNext: { kind: 'transient' | 'permanent'; error?: string } | null = null;
  const key = (s: string, sc: string) => `${s}/${sc}`;
  const tokenOf = (sessionId: string, scanId: string, version: number) => `${sessionId}/${scanId}:v${version}`;

  function takeFailure(): XnatWriteResult | null {
    if (!failNext) return null;
    const f = failNext;
    failNext = null;
    return { ok: false, error: f.error ?? `${f.kind} error`, kind: f.kind };
  }

  return {
    async uploadSeg(p) {
      const fail = takeFailure();
      if (fail) return fail;
      const scanId = String(nextSegScan++);
      scans.set(key(p.sessionId, scanId), { version: 1, dicomBase64: p.dicomBase64 });
      return { ok: true, scanId, versionToken: tokenOf(p.sessionId, scanId, 1) };
    },

    async overwriteSeg(p) {
      const fail = takeFailure();
      if (fail) return fail;
      const k = key(p.sessionId, p.targetScanId);
      const cur = scans.get(k);
      const currentToken = cur ? tokenOf(p.sessionId, p.targetScanId, cur.version) : null;
      if (cur && p.baseVersionToken !== currentToken) {
        return { ok: false, error: 'version conflict', conflict: true, serverVersionToken: currentToken ?? undefined };
      }
      const version = (cur?.version ?? 0) + 1;
      scans.set(k, { version, dicomBase64: p.dicomBase64 });
      return { ok: true, scanId: p.targetScanId, versionToken: tokenOf(p.sessionId, p.targetScanId, version) };
    },

    async getVersion(p) {
      const cur = scans.get(key(p.sessionId, p.scanId));
      return cur ? tokenOf(p.sessionId, p.scanId, cur.version) : null;
    },

    _externalEdit(sessionId, scanId) {
      const k = key(sessionId, scanId);
      const cur = scans.get(k);
      scans.set(k, { version: (cur?.version ?? 0) + 1, dicomBase64: cur?.dicomBase64 ?? '' });
    },

    _externalEditAll() {
      for (const [k, cur] of scans) scans.set(k, { version: cur.version + 1, dicomBase64: cur.dicomBase64 });
    },

    _failNext(f) {
      failNext = f;
    },

    _scans() {
      return Array.from(scans.entries()).map(([k, v]) => {
        const [sessionId, scanId] = k.split('/');
        return { sessionId, scanId, version: v.version };
      });
    },
  };
}
