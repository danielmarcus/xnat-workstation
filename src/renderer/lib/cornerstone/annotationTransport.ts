/**
 * Annotation transport contract (§H boundary) + an in-memory double.
 *
 * The §H boundary is the single seam between the multi-viewport annotation layer
 * and XNAT persistence. The layer hands the transport a SERIALIZED container + the
 * version token its local edits are based on; the transport persists it and reports
 * one §H5 outcome: Success (new version token) · Conflict (the local base token is
 * stale — someone else saved) · Transient error (retry) · Permanent error
 * (auth/perms). External change (§H6) is exposed via `getServerVersion`.
 *
 * `createInMemoryTransport` is the offline/test double implementing this contract
 * (version tokens via a per-container counter — deterministic, no clock/random),
 * so the queue-next-save (signal 14) and conflict-resolution (H7 / signal 27) state
 * machines are verifiable without a live XNAT. The real XNAT transport (IPC
 * upload/overwrite handlers, which already exist) implements the SAME interface and
 * is injected via segmentationService.setSaveTransport.
 */
import type { ContainerKind, SourceIdentity } from '@shared/types/annotation';

export interface SerializedContainer {
  containerId: string;
  kind: ContainerKind;
  /** base64 DICOM (SEG/RTSTRUCT/SR) from exportToDicomSeg / exportToRtStruct. */
  base64: string;
  source: SourceIdentity;
  /** User-facing container label → the XNAT scan's series description (so saved
   *  annotations are named, not all "Segmentation"). Optional for back-compat. */
  label?: string;
}

export type SaveResult =
  // `scanId` is set on a first save (H8): the session-local container now maps to a
  // persistent XNAT scan id, which the caller writes back into the container source.
  | { ok: true; versionToken: string; scanId?: string }
  | { ok: false; kind: 'conflict' | 'transient' | 'permanent'; error?: string; serverVersionToken?: string };

export interface AnnotationTransport {
  /**
   * Persist a serialized container. `baseVersionToken` is the version the local
   * edits are based on (null for a never-saved container). A stale base token ⇒
   * conflict (H5).
   */
  save(serialized: SerializedContainer, baseVersionToken: string | null): Promise<SaveResult>;
  /** Current server version token for a container (external-change detection, H6); null if absent. */
  getServerVersion(containerId: string): Promise<string | null>;
}

export interface InMemoryTransport extends AnnotationTransport {
  /** Test/offline: simulate another source modifying the container (bumps its server version). */
  _externalEdit(containerId: string): void;
  /** Test/offline: make the next save fail with the given kind (cleared after one save). */
  _failNext(kind: 'transient' | 'permanent', error?: string): void;
}

interface Entry {
  version: number;
  base64: string;
}

export function createInMemoryTransport(): InMemoryTransport {
  const store = new Map<string, Entry>();
  let failNext: { kind: 'transient' | 'permanent'; error?: string } | null = null;
  const tokenOf = (id: string, version: number) => `${id}:v${version}`;

  return {
    async save(serialized, baseVersionToken) {
      if (failNext) {
        const f = failNext;
        failNext = null;
        return { ok: false, kind: f.kind, error: f.error ?? `${f.kind} error` };
      }
      const existing = store.get(serialized.containerId);
      const currentToken = existing ? tokenOf(serialized.containerId, existing.version) : null;
      // Conflict: a prior version exists and the local edit isn't based on it (H5).
      if (existing && baseVersionToken !== currentToken) {
        return { ok: false, kind: 'conflict', serverVersionToken: currentToken ?? undefined };
      }
      const nextVersion = (existing?.version ?? 0) + 1;
      store.set(serialized.containerId, { version: nextVersion, base64: serialized.base64 });
      return { ok: true, versionToken: tokenOf(serialized.containerId, nextVersion) };
    },

    async getServerVersion(containerId) {
      const e = store.get(containerId);
      return e ? tokenOf(containerId, e.version) : null;
    },

    _externalEdit(containerId) {
      const e = store.get(containerId);
      // Bump the server version without changing the local base token (simulates H6).
      store.set(containerId, { version: (e?.version ?? 0) + 1, base64: e?.base64 ?? '' });
    },

    _failNext(kind, error) {
      failNext = { kind, error };
    },
  };
}
