/**
 * xnatTransport (Transport TR5, renderer side) — the real AnnotationTransport that
 * persists containers to XNAT via an injected upload/overwrite/version API. Pure
 * adapter logic over the API, so it's verified against the in-memory mock
 * (mockXnatApi) offline and runs unchanged against the live electronAPI.xnat.
 *
 * First save (no scan id yet) → UPLOAD → the new XNAT scan id is remembered (H8) so
 * subsequent saves OVERWRITE that scan. A save whose base version token is stale
 * (the server advanced) → conflict (H5). getServerVersion polls the mapped scan
 * (H6 external-change detection).
 *
 * NB: the live electronAPI.xnat upload/overwrite handlers must be extended to
 * return a version token (etag/last-modified) — the in-memory mock already does, so
 * the renderer-side adapter + conflict flow are fully exercised now; only that
 * main-process return-shape extension remains for the real round-trip.
 */
import type { AnnotationTransport, SaveResult, SerializedContainer } from './annotationTransport';

export interface XnatWriteOk { ok: true; scanId: string; versionToken: string }
export interface XnatWriteErr { ok: false; error: string; kind?: 'transient' | 'permanent'; conflict?: boolean; serverVersionToken?: string }
export type XnatWriteResult = XnatWriteOk | XnatWriteErr;

/** First-save (create) params — shared by SEG + RTSTRUCT. */
export interface XnatUploadParams {
  projectId: string; subjectId: string; sessionId: string; sessionLabel: string;
  sourceScanId: string; dicomBase64: string; label?: string;
}
/** Update (overwrite) params — shared by SEG + RTSTRUCT. */
export interface XnatOverwriteParams {
  sessionId: string; targetScanId: string; dicomBase64: string; baseVersionToken: string | null;
  seriesDescription?: string;
}

/** The XNAT persistence surface the adapter needs (real electronAPI.xnat or the mock). */
export interface XnatUploadApi {
  uploadSeg(p: XnatUploadParams): Promise<XnatWriteResult>;
  uploadRtStruct(p: XnatUploadParams): Promise<XnatWriteResult>;
  uploadSr(p: XnatUploadParams): Promise<XnatWriteResult>;
  overwriteSeg(p: XnatOverwriteParams): Promise<XnatWriteResult>;
  overwriteRtStruct(p: XnatOverwriteParams): Promise<XnatWriteResult>;
  overwriteSr(p: XnatOverwriteParams): Promise<XnatWriteResult>;
  getVersion(p: { sessionId: string; scanId: string }): Promise<string | null>;
}

export function createXnatTransport(api: XnatUploadApi): AnnotationTransport {
  // Session-local container id → its persistent XNAT target (H8 first-save mapping).
  const target = new Map<string, { sessionId: string; scanId: string }>();

  return {
    async save(serialized: SerializedContainer, baseVersionToken: string | null): Promise<SaveResult> {
      const { source } = serialized;
      const known = target.get(serialized.containerId);
      const scanId = known?.scanId ?? source.scanId;
      // Route by the container's actual kind (the transport knows it from the
      // serialized payload) — NOT a guess from the scan id. Each modality uses its own
      // channel: RTSTRUCT, SR, or (default) SEG.
      const kind = serialized.kind;

      let res: XnatWriteResult;
      if (!scanId) {
        const p = {
          projectId: source.projectId,
          subjectId: source.subjectId,
          sessionId: source.sessionId,
          sessionLabel: source.sessionLabel ?? '',
          sourceScanId: source.sourceScanId,
          dicomBase64: serialized.base64,
          label: serialized.label,
        };
        res = kind === 'RTSTRUCT' ? await api.uploadRtStruct(p)
          : kind === 'SR' ? await api.uploadSr(p)
            : await api.uploadSeg(p);
      } else {
        const p = {
          sessionId: source.sessionId,
          targetScanId: scanId,
          dicomBase64: serialized.base64,
          baseVersionToken,
          seriesDescription: serialized.label,
        };
        res = kind === 'RTSTRUCT' ? await api.overwriteRtStruct(p)
          : kind === 'SR' ? await api.overwriteSr(p)
            : await api.overwriteSeg(p);
      }

      if (res.ok) {
        target.set(serialized.containerId, { sessionId: source.sessionId, scanId: res.scanId });
        return { ok: true, versionToken: res.versionToken, scanId: res.scanId };
      }
      if (res.conflict) {
        return { ok: false, kind: 'conflict', error: res.error, serverVersionToken: res.serverVersionToken };
      }
      return { ok: false, kind: res.kind ?? 'transient', error: res.error };
    },

    async getServerVersion(containerId: string): Promise<string | null> {
      const known = target.get(containerId);
      if (!known) return null;
      return api.getVersion({ sessionId: known.sessionId, scanId: known.scanId });
    },
  };
}
