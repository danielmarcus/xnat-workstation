/**
 * xnatAutosaveWiring — composes the real XNAT save transport and gates it behind
 * the `xnatAutosaveEnabled` preference (default OFF, CNDA safety).
 *
 * Layering:
 *   buildSerializedContainer  — PURE assembly of a §H4 SerializedContainer from
 *                               injected getters (kind / exporters / origin /
 *                               viewer context). No globals, fully unit-testable.
 *   composeXnatTransport      — wires the real deps (segmentationService +
 *                               rtStructService exporters + the stores +
 *                               createXnatUploadApi over window.electronAPI.xnat)
 *                               into segmentationService.setSaveTransport /
 *                               setConflictResolver. Idempotent + guarded.
 *
 * The React opt-in hook that calls these (reading the `xnatAutosaveEnabled`
 * preference) lives in src/renderer/hooks/useXnatAutosaveOptIn.ts — this module
 * is a service (lib/**) and must stay React-free per the §2 layering boundary.
 */
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
import { segmentationService } from './segmentationService';
import { rtStructService } from './rtStructService';
import { createXnatUploadApi } from './xnatUploadApi';
import { createXnatTransportService } from './transportService';
import type { SerializedContainer } from './annotationTransport';
import type { ContainerKind, SourceIdentity } from '@shared/types/annotation';

/** The XNAT origin a container was loaded from / will be saved back to. */
export interface XnatOrigin {
  projectId: string;
  sessionId: string;
  sourceScanId: string;
  /** The container's own persisted XNAT scan id (e.g. a `30xx` SEG scan), if any. */
  scanId?: string;
}

/** Viewer-side context supplying the fields `xnatOriginMap` does not carry. */
export interface ViewerContext {
  subjectId?: string;
  sessionLabel?: string;
}

/** Injected getters for the pure container assembly. */
export interface BuildSerializedContainerDeps {
  /** Container kind (SEG vs RTSTRUCT) — routes which exporter runs. */
  kindOf: (id: string) => ContainerKind;
  /** Export a SEG container to base64 DICOM. */
  exportSeg: (id: string) => Promise<string>;
  /** Export an RTSTRUCT container to base64 DICOM. */
  exportRtStruct: (id: string) => Promise<string>;
  /** Resolve the XNAT origin; `undefined` ⇒ no save target. */
  originOf: (id: string) => XnatOrigin | undefined;
  /** Resolve the missing SourceIdentity fields from the viewer layer. */
  viewerContextOf: (id: string) => ViewerContext;
}

/**
 * Assemble a §H4 SerializedContainer for `containerId`, or `null` when no save
 * target can be determined (no XNAT origin/scan). The transportSaver maps `null`
 * → a permanent "no serializable content" outcome, so the queue stops retrying.
 *
 * Pure: every external dependency is injected. SourceIdentity is built from the
 * origin (projectId / sessionId / sourceScanId / scanId) plus the viewer context
 * (subjectId / sessionLabel), which `xnatOriginMap` does not carry.
 */
export async function buildSerializedContainer(
  containerId: string,
  deps: BuildSerializedContainerDeps,
): Promise<SerializedContainer | null> {
  const origin = deps.originOf(containerId);
  if (!origin) {
    // No XNAT lineage → nothing to save back to. Soft fallback (no throw).
    return null;
  }

  const kind = deps.kindOf(containerId);
  const base64 =
    kind === 'RTSTRUCT'
      ? await deps.exportRtStruct(containerId)
      : await deps.exportSeg(containerId);

  const viewer = deps.viewerContextOf(containerId);
  const source: SourceIdentity = {
    projectId: origin.projectId,
    subjectId: viewer.subjectId ?? '',
    sessionId: origin.sessionId,
    sessionLabel: viewer.sessionLabel,
    sourceScanId: origin.sourceScanId,
    scanId: origin.scanId,
  };

  return { containerId, kind, base64, source };
}

// ─── Real-deps composition ────────────────────────────────────────────────

let composed = false;

/**
 * Build the production save transport over `window.electronAPI.xnat` and install
 * it via segmentationService.setSaveTransport + setConflictResolver. Idempotent
 * (composes at most once). No-ops with a warning if the XNAT IPC surface is
 * absent (e.g. unit tests that don't stub it) so this is safe to call eagerly.
 */
export function composeXnatTransport(): void {
  if (composed) return;

  const xnat = window.electronAPI?.xnat;
  if (!xnat) {
    console.warn('[xnatAutosaveWiring] window.electronAPI.xnat unavailable — transport not composed.');
    return;
  }

  const kindOf = (id: string): ContainerKind => segmentationService.getPreferredDicomType(id);

  const originOf = (id: string): XnatOrigin | undefined => {
    const entry = useSegmentationStore.getState().xnatOriginMap[id];
    if (!entry) return undefined;
    return {
      projectId: entry.projectId,
      sessionId: entry.sessionId,
      sourceScanId: entry.sourceScanId,
      scanId: entry.scanId,
    };
  };

  const viewerContextOf = (_id: string): ViewerContext => {
    // Containers are session-scoped; the subject/session-label live on the
    // active viewport's XNAT context (xnatOriginMap carries neither).
    const ctx = useViewerStore.getState().xnatContext;
    return {
      subjectId: ctx?.subjectId,
      sessionLabel: ctx?.sessionLabel,
    };
  };

  const buildDeps: BuildSerializedContainerDeps = {
    kindOf,
    exportSeg: (id) => segmentationService.exportToDicomSeg(id),
    exportRtStruct: (id) => rtStructService.exportToRtStruct(id),
    originOf,
    viewerContextOf,
  };

  const api = createXnatUploadApi(xnat, {
    overwriteKindOf: (targetScanId) => segmentationService.getPreferredDicomType(targetScanId),
  });

  const svc = createXnatTransportService({
    api,
    serialize: (id) => buildSerializedContainer(id, buildDeps),
    kindOf,
  });

  segmentationService.setSaveTransport(svc.saveContainer);
  segmentationService.setConflictResolver(async (id, resolution) => {
    if (resolution === 'keep-local') {
      // H7 keep-local: re-base onto the server version, then re-save so local wins.
      await svc.rebaseToServer(id);
      await segmentationService.flushContainerSave(id);
    }
    // 'discard-local' is handled by the reload path elsewhere; nothing to do here.
  });

  composed = true;
}

/** Test-only: reset the one-shot composition guard. */
export function _resetXnatTransportComposition(): void {
  composed = false;
}
