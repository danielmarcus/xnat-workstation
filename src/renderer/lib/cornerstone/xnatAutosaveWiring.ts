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
import { useAnnotationStore } from '../../stores/annotationStore';
import { segmentationService } from './segmentationService';
import { rtStructService } from './rtStructService';
import { exportMeasurementsToDicomSr } from './srExport';
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
  /** Export an SR (Measurement) container to base64 DICOM-SR; null if it has no measurements. */
  exportSr: (id: string) => Promise<string | null>;
  /** Resolve the XNAT origin; `undefined` ⇒ no save target. */
  originOf: (id: string) => XnatOrigin | undefined;
  /** Resolve the missing SourceIdentity fields from the viewer layer. */
  viewerContextOf: (id: string) => ViewerContext;
  /** The container's user-facing label → the saved scan's series description. */
  labelOf: (id: string) => string | undefined;
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
      : kind === 'SR'
        ? await deps.exportSr(containerId)
        : await deps.exportSeg(containerId);
  // An SR container with no measurements has nothing to serialize → no-op (null), same
  // as no-origin: the transportSaver maps null to a permanent "no content" outcome.
  if (base64 == null) return null;

  const viewer = deps.viewerContextOf(containerId);
  const source: SourceIdentity = {
    projectId: origin.projectId,
    subjectId: viewer.subjectId ?? '',
    sessionId: origin.sessionId,
    sessionLabel: viewer.sessionLabel,
    sourceScanId: origin.sourceScanId,
    scanId: origin.scanId,
  };

  return { containerId, kind, base64, source, label: deps.labelOf(containerId) };
}

/**
 * Resolve the XNAT origin a container should be saved back to. A container LOADED
 * from XNAT has an explicit `xnatOriginMap` entry. A NEWLY-CREATED annotation has
 * none — so fall back to the active viewport's XNAT context (its project/session +
 * the source scan on the active panel) so first-save upload can target that
 * session. Returns `undefined` only when there's genuinely no XNAT target (no
 * connection / no scan loaded), which makes the save a no-op. Pure + unit-testable.
 */
export function resolveSaveOrigin(args: {
  containerId: string;
  xnatOriginMap: Record<string, { scanId: string; sourceScanId: string; projectId: string; sessionId: string }>;
  activeViewportId: string | null;
  panelScanMap: Record<string, string>;
  xnatContext: { projectId: string; sessionId: string; scanId: string } | null;
}): XnatOrigin | undefined {
  const explicit = args.xnatOriginMap[args.containerId];
  if (explicit) {
    return {
      projectId: explicit.projectId,
      sessionId: explicit.sessionId,
      sourceScanId: explicit.sourceScanId,
      scanId: explicit.scanId,
    };
  }
  // New (never-saved) container → derive from the active viewport's session/scan.
  const ctx = args.xnatContext;
  if (!ctx?.projectId || !ctx.sessionId) return undefined;
  const sourceScanId =
    (args.activeViewportId ? args.panelScanMap[args.activeViewportId] : undefined) || ctx.scanId;
  if (!sourceScanId) return undefined;
  // No own scanId yet — first-save upload assigns one (the transport maps it for
  // subsequent overwrites within the session, H8).
  return { projectId: ctx.projectId, sessionId: ctx.sessionId, sourceScanId };
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

  // SR containers are annotationStore-backed (synthetic `sr:` ids), not segmentations,
  // so getPreferredDicomType (a segmentation lookup) can't classify them.
  const kindOf = (id: string): ContainerKind =>
    id.startsWith('sr:') ? 'SR' : segmentationService.getPreferredDicomType(id);

  /** The measurement UIDs belonging to an SR container (mirrors containerProjection's
   *  affiliation grouping: a created container gets its affiliated measurements; the
   *  default container gets the unaffiliated ones). */
  const srMemberUids = (containerId: string): string[] => {
    const { annotations, srContainers, srAffiliation } = useAnnotationStore.getState();
    const createdIds = new Set((srContainers ?? []).map((c) => c.id));
    const aff = srAffiliation ?? {};
    return annotations
      .filter((a) =>
        createdIds.has(containerId)
          ? aff[a.annotationUID] === containerId
          : !aff[a.annotationUID] || !createdIds.has(aff[a.annotationUID]))
      .map((a) => a.annotationUID);
  };

  /** The SR container's label (created container's label, or the default "Measurements"). */
  const srLabelOf = (containerId: string): string =>
    (useAnnotationStore.getState().srContainers ?? []).find((c) => c.id === containerId)?.label ?? 'Measurements';

  const originOf = (id: string): XnatOrigin | undefined => {
    const v = useViewerStore.getState();
    return resolveSaveOrigin({
      containerId: id,
      xnatOriginMap: useSegmentationStore.getState().xnatOriginMap,
      activeViewportId: v.activeViewportId ?? null,
      panelScanMap: v.panelScanMap,
      xnatContext: v.xnatContext,
    });
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
    exportSr: (id) => exportMeasurementsToDicomSr(srMemberUids(id), { seriesDescription: srLabelOf(id) }),
    originOf,
    viewerContextOf,
    labelOf: (id) =>
      id.startsWith('sr:')
        ? srLabelOf(id)
        : useSegmentationStore.getState().segmentations.find((s) => s.segmentationId === id)?.label,
  };

  // The transport routes SEG vs RTSTRUCT by the container's kind (from the serialized
  // payload), so the wrapper needs no scan-id-based kind guess.
  const api = createXnatUploadApi(xnat);

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
