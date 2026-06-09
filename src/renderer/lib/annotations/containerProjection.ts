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
  /** Synthetic SR container identity (defaults provided). */
  srContainerId?: string;
  srLabel?: string;
  srSource?: SourceIdentity;
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

function projectMeasurementContainer(inputs: ProjectionInputs): Container | null {
  if (inputs.annotations.length === 0) return null;
  const id = inputs.srContainerId ?? 'sr:measurements';
  const members: Member[] = inputs.annotations.map((a) => ({
    id: a.annotationUID,
    label: a.label || a.displayName,
    visible: true,
    locked: false,
    toolName: a.toolName,
    annotationUID: a.annotationUID,
  }));
  return {
    id,
    kind: 'SR',
    label: inputs.srLabel ?? 'Measurements',
    members,
    source: inputs.srSource ?? sourceFromOrigin(undefined),
    dirty: !!inputs.dirtySegIds[id],
  };
}

export function projectContainers(inputs: ProjectionInputs): Container[] {
  const containers: Container[] = inputs.segmentations.map((seg) =>
    projectSegmentationContainer(seg, inputs),
  );
  const sr = projectMeasurementContainer(inputs);
  if (sr) containers.push(sr);
  return containers;
}
