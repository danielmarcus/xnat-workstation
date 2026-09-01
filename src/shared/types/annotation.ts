/**
 * Annotation rebuild — unified container data model (Phase 0 scaffolding).
 *
 * This is the TARGET model the multi-viewport annotation rebuild is built
 * around (see docs/multiviewport-annotation-design.md and the terminology
 * table in CLAUDE.md). It is ADDITIVE and not yet consumed by any store or
 * component — landing the types first lets later phases compile against a
 * stable shape.
 *
 * Cornerstone3D remains the source of truth for pixels/geometry. A `Container`
 * models the persisted DICOM object (one file) that owns `Member`s. Over the
 * rebuild it will progressively unify the three lightweight UI-summary layers
 * that exist today — do NOT modify these in this slice, they are listed only
 * so the reconciliation target is explicit:
 *   - SegmentationSummary / SegmentSummary   src/renderer/stores/segmentationStore.ts
 *   - AnnotationSummary                       src/renderer/stores/annotationStore.ts
 *   - PanelSegState / PresentationState       src/renderer/stores/segmentationManagerStore.ts
 *
 * SOP Class UIDs / transfer-syntax details are owned by the transport layer
 * (segmentationService.ts, rtStructService.ts) and are deliberately not
 * duplicated here.
 */

/** The three peer annotation types — each a distinct DICOM SOP class. */
export type ContainerKind = 'SEG' | 'RTSTRUCT' | 'SR';

/** Human-facing singular label for each kind (matches the UI terminology). */
export const CONTAINER_KIND_LABEL: Record<ContainerKind, string> = {
  SEG: 'Segmentation',
  RTSTRUCT: 'Structure',
  SR: 'Measurement',
};

/**
 * RTROIInterpretedType (DICOM tag (3006,00A4)). DICOM defines an enumerated
 * set but also permits site-specific values, so the union stays open.
 */
export type RtRoiInterpretedType =
  | 'ORGAN'
  | 'PTV'
  | 'CTV'
  | 'GTV'
  | 'TREATED_VOLUME'
  | 'IRRAD_VOLUME'
  | 'BOLUS'
  | 'AVOIDANCE'
  | 'EXTERNAL'
  | 'MARKER'
  | 'REGISTRATION'
  | 'ISOCENTER'
  | 'CONTRAST_AGENT'
  | 'CAVITY'
  | 'SUPPORT'
  | 'FIXATION'
  | 'CONTROL'
  | 'DOSE_REGION'
  | (string & {});

/** DICOM approval state (SEG / RTSTRUCT ApprovalStatus). */
export type ApprovalStatus = 'UNAPPROVED' | 'APPROVED' | 'REJECTED';

/**
 * Persisted approval state for one container (requirements D7.11, design §2.6).
 * Written to / read from the DICOM approval attributes — see
 * `renderer/lib/annotations/approval` for the mapping.
 */
export interface ApprovalRecord {
  approved: boolean;
  /** DICOM ReviewerName (person-name form), when an identity is known. */
  reviewerName: string | null;
  /** Epoch ms of the approval; second-resolution once round-tripped through DICOM. */
  reviewedAt: number | null;
}

/** One entry of the session-only approval audit trail (design §2.6). */
export interface ApprovalEvent {
  action: 'approve' | 'revoke';
  by: string | null;
  at: number;
}

/**
 * Where a container came from in XNAT and where it will be saved back to.
 * Drives the overwrite-vs-create-new decision on save and (via
 * frameOfReferenceUID) which viewports a container is eligible to render on.
 */
export interface SourceIdentity {
  projectId: string;
  subjectId: string;
  /** XNAT experiment/session ID. */
  sessionId: string;
  /** Human-readable session label, when known. */
  sessionLabel?: string;
  /** The image series (scan) this container annotates / is derived from. */
  sourceScanId: string;
  /** The container's own XNAT scan ID once persisted (e.g. a `30xx` SEG scan). */
  scanId?: string;
  /** DICOM Frame of Reference UID (0020,0052) — gates cross-viewport rendering. */
  frameOfReferenceUID?: string;
  /** SeriesInstanceUID (0020,000E) of the referenced source series. */
  referencedSeriesInstanceUID?: string;
  /**
   * All SeriesInstanceUIDs this container references (RTSTRUCT
   * ReferencedSeriesSequence / SEG ReferencedSeriesSequence). A viewport showing
   * any of these series is "native" for FoR-eligibility (A2a). Superset of
   * `referencedSeriesInstanceUID`; empty when lineage is unknown.
   */
  referencedSeriesInstanceUIDs?: string[];
}

/**
 * One member of a container: a segment (SEG), an ROI structure (RTSTRUCT), or
 * a measurement (SR). Kind-specific fields are optional and populated per kind.
 */
export interface Member {
  /**
   * Stable id within the container. SEG: stringified segment index; RTSTRUCT:
   * stringified ROI number; SR: the Cornerstone annotationUID.
   */
  id: string;
  label: string;
  /** Display color, RGBA 0–255. */
  color?: [number, number, number, number];
  visible: boolean;
  locked: boolean;

  // ── SEG ──
  /** 1-based segment index (0 = background). */
  segmentIndex?: number;

  // ── RTSTRUCT ──
  /** ROI Number (3006,0022). */
  roiNumber?: number;
  /** RTROIInterpretedType (3006,00A4). */
  interpretedType?: RtRoiInterpretedType;

  // ── SR ──
  /** Cornerstone tool class name backing an SR measurement (e.g. 'Length'). */
  toolName?: string;
  /** Cornerstone annotationUID for an SR measurement member. */
  annotationUID?: string;
}

/**
 * A persisted (or pending) DICOM annotation object — one file — that owns
 * Members. Containers are session-scoped (not viewport-scoped); FoR matching
 * decides which viewports they render on.
 */
export interface Container {
  /**
   * App-internal id. For SEG/RTSTRUCT this corresponds to a Cornerstone
   * segmentationId; for SR it is a synthetic id grouping the measurements.
   */
  id: string;
  kind: ContainerKind;
  label: string;
  members: Member[];
  source: SourceIdentity;
  /** DICOM SOPInstanceUID (0008,0018) once the object exists. */
  sopInstanceUID?: string;
  /** Approval state (SEG SegmentSequence / RTSTRUCT RTROIObservations). */
  approval?: ApprovalStatus;
  /** Unsaved-edits flag, fed by autosave/dirty tracking. */
  dirty?: boolean;
}
