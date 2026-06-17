/**
 * Container projection (Rebuild Phase 3, R3.1).
 *
 * Pure function that assembles the unified `Container[]` model
 * (src/shared/types/annotation.ts) from the three live UI-summary layers:
 *   - segmentationStore  → SEG/RTSTRUCT containers + their members (segments)
 *   - segmentationManagerStore → per-segment presentation overrides + dirty flags
 *   - annotationStore    → SR measurements (grouped into one Measurement container)
 *   - segmentationStore.xnatOriginMap → source identity
 *
 * Cornerstone3D stays the source of truth for geometry; this only re-shapes the
 * lightweight summaries into the container/member hierarchy the list panel renders.
 * Keeping it pure (no store/Cornerstone imports) lets the row mapping be verified
 * in isolation. The `useContainers` hook (separate) supplies the live store slices
 * + a `kindOf` resolver. Geometry metrics (slice count / cm³ / cm²) and approval
 * persistence are enriched in later slices; they are optional inputs here.
 */
import type {
  ApprovalStatus,
  Container,
  ContainerKind,
  Member,
  SourceIdentity,
} from '@shared/types/annotation';
import type { SegmentationSummary } from '@renderer/stores/segmentationStore';
import type { AnnotationSummary } from '@renderer/stores/annotationStore';
import type { PresentationState } from '@renderer/stores/segmentationManagerStore';

type RGBA = [number, number, number, number];

export interface XnatOrigin {
  scanId: string;
  sourceScanId: string;
  projectId: string;
  sessionId: string;
}

export interface ProjectionInputs {
  segmentations: SegmentationSummary[];
  /** SR measurements (flat) — grouped into one Measurement container. */
  annotations: AnnotationSummary[];
  /** Per-segmentation presentation overrides (color/visibility/lock by segment index). */
  presentation: Record<string, PresentationState>;
  /** Per-container dirty flags. */
  dirtySegIds: Record<string, boolean>;
  /** XNAT origin per segmentation id. */
  xnatOriginMap: Record<string, XnatOrigin>;
  /** Resolve a segmentation's container kind (SEG vs RTSTRUCT). Defaults to SEG. */
  kindOf: (segmentationId: string) => ContainerKind;
  /** Optional approval-state resolver (D7.11 persistence — wired in a later slice). */
  approvalOf?: (id: string) => ApprovalStatus | undefined;
  /** Synthetic default-SR container identity (for measurements with no SR affiliation). */
  srContainerId?: string;
  srLabel?: string;
  srSource?: SourceIdentity;
  /** User-created SR (Measurement) containers — each emitted even when empty (D7.1). */
  srContainers?: Array<{ id: string; label: string }>;
  /** annotationUID → SR container id (which created container a measurement belongs to). */
  srAffiliation?: Record<string, string>;
  /** Active viewer session. When set, the panel re-scopes to it (A13: one study at a
   *  time) — containers belonging to a KNOWN different session are held over (retained
   *  in memory + surfaced via the unsaved-work banner) and excluded here. Unset ⇒ no
   *  scoping (offline/local). */
  activeSessionId?: string;
}

/**
 * A13 panel scoping: a container is shown when it belongs to the active session, or
 * when its session is unknown (a freshly-created local container not yet tagged to a
 * session — it belongs to wherever it was made). A container with a KNOWN, different
 * session is held over and excluded so the panel shows one study at a time.
 */
function inActiveSession(c: Container, activeSessionId?: string): boolean {
  if (!activeSessionId) return true;
  const sid = c.source?.sessionId;
  return !sid || sid === activeSessionId;
}

function sourceFromOrigin(origin: XnatOrigin | undefined): SourceIdentity {
  return {
    projectId: origin?.projectId ?? '',
    subjectId: '', // not carried by xnatOriginMap today — enriched when needed
    sessionId: origin?.sessionId ?? '',
    sourceScanId: origin?.sourceScanId ?? '',
    scanId: origin?.scanId,
  };
}

function projectSegmentationContainer(
  seg: SegmentationSummary,
  inputs: ProjectionInputs,
): Container {
  const kind = inputs.kindOf(seg.segmentationId);
  const pres = inputs.presentation[seg.segmentationId];

  const members: Member[] = seg.segments.map((s) => {
    const color: RGBA = pres?.color?.[s.segmentIndex] ?? s.color;
    const visible = pres?.visibility?.[s.segmentIndex] ?? s.visible;
    const locked = pres?.locked?.[s.segmentIndex] ?? s.locked;
    return {
      id: String(s.segmentIndex),
      label: s.label,
      color,
      visible,
      locked,
      segmentIndex: s.segmentIndex,
      ...(kind === 'RTSTRUCT' ? { roiNumber: s.segmentIndex } : {}),
    };
  });

  return {
    id: seg.segmentationId,
    kind,
    label: seg.label,
    members,
    source: sourceFromOrigin(inputs.xnatOriginMap[seg.segmentationId]),
    approval: inputs.approvalOf?.(seg.segmentationId),
    dirty: !!inputs.dirtySegIds[seg.segmentationId],
  };
}

function measurementMember(a: AnnotationSummary): Member {
  return {
    id: a.annotationUID,
    label: a.label || a.displayName,
    visible: a.visible ?? true,
    locked: a.locked ?? false,
    toolName: a.toolName,
    annotationUID: a.annotationUID,
  };
}

/**
 * Project SR (Measurement) containers (D7.1). Each user-created SR container is
 * emitted even when empty, carrying the measurements affiliated to it. Measurements
 * with no affiliation fall into the default "Measurements" container (emitted only
 * when such measurements exist), preserving the pre-multi-SR behavior.
 */
function projectMeasurementContainers(inputs: ProjectionInputs): Container[] {
  const affiliation = inputs.srAffiliation ?? {};
  const created = inputs.srContainers ?? [];
  const out: Container[] = [];

  for (const c of created) {
    const members = inputs.annotations.filter((a) => affiliation[a.annotationUID] === c.id).map(measurementMember);
    out.push({
      id: c.id,
      kind: 'SR',
      label: c.label,
      members,
      source: inputs.srSource ?? sourceFromOrigin(undefined),
      dirty: !!inputs.dirtySegIds[c.id],
    });
  }

  // Unaffiliated measurements → the default container (legacy singleton behavior).
  const createdIds = new Set(created.map((c) => c.id));
  const unaffiliated = inputs.annotations.filter((a) => {
    const srId = affiliation[a.annotationUID];
    return !srId || !createdIds.has(srId);
  });
  if (unaffiliated.length > 0) {
    const id = inputs.srContainerId ?? 'sr:measurements';
    out.push({
      id,
      kind: 'SR',
      label: inputs.srLabel ?? 'Measurements',
      members: unaffiliated.map(measurementMember),
      source: inputs.srSource ?? sourceFromOrigin(undefined),
      dirty: !!inputs.dirtySegIds[id],
    });
  }
  return out;
}

export function projectContainers(inputs: ProjectionInputs): Container[] {
  const containers: Container[] = inputs.segmentations.map((seg) =>
    projectSegmentationContainer(seg, inputs),
  );
  containers.push(...projectMeasurementContainers(inputs));
  return containers.filter((c) => inActiveSession(c, inputs.activeSessionId));
}
