/**
 * Annotation data model — the authoritative shape for the multi-viewport
 * annotation rewrite. See docs/multiviewport-annotation-design.md §2.
 *
 * These types describe in-memory annotation state. Cornerstone3D owns the
 * actual geometry (contour polygons, labelmap voxels) via the bridge fields
 * `csAnnotationUIDs` / `csSegmentationId`. The shapes here are metadata
 * wrappers over Cornerstone's authoritative state, plus session-only state
 * (active/selected, visibility mode, undo history) that lives in Zustand.
 *
 * Phase 0: types defined; consumers come in Phase 1+.
 */

// ─── Container ───────────────────────────────────────────────────────────

/** Container kind. POI is recognized in the data model (forward-compat); full UX deferred. */
export type ContainerKind = 'RTSTRUCT' | 'SEG' | 'POI';

/** A loaded annotation object (RTSTRUCT structure-set, DICOM SEG, or POI list). */
export interface Container {
  /** Session-local unique ID. */
  id: string;
  kind: ContainerKind;
  /** RTSTRUCT StructureSetLabel / SEG SeriesDescription / POI list name. */
  name: string;
  /** Ordered; default order = ROI Number for RTSTRUCT, SegmentNumber for SEG. */
  members: Member[];
  /** Null until first save; assigned by the transport layer per H8. */
  sourceIdentity: SourceIdentity | null;
  /** Persistent; round-trips via DICOM ApprovalStatus. */
  approval: ApprovalState;
  /** True when in-memory state diverges from last-saved. Cleared on successful save (H5). */
  dirty: boolean;
  /** Per E2 queue-next-save: true while a save round-trip is in flight. */
  saveInFlight: boolean;
  /** Opaque token from transport (H2); used for conflict detection (H6). */
  versionToken: VersionToken | null;
  /** Non-null when the container failed to parse on load (D7.9). */
  parseError: ParseError | null;
  /**
   * Per-container opt-in for A2c cross-series rendering (§A2c, §D11).
   * Default `false`. When `true`, members of this container that classify
   * as `cross-series-A2c` on a given viewport will render (subject to
   * the master `crossSeriesRendering` preference). Session-only — does
   * not persist into saved DICOM (the toggle is presentation state).
   */
  a2cOptedIn: boolean;
}

// ─── Member ──────────────────────────────────────────────────────────────

/** RGB color, 0-255 per channel. */
export type RGB = readonly [number, number, number];

/** Three-state per-member visibility (D7.3). */
export type VisibilityMode = 'hidden' | 'outlined' | 'filled';

/** Source of a member's geometry (D7.2). */
export type Provenance =
  | 'manual'
  | 'interpolated'
  | 'imported'
  | 'auto-segmented'      // future
  | 'algebra'             // future
  | 'deformably-mapped';  // future

/** DICOM RTSTRUCT RTROIInterpretedType (300A,00A4). */
export type RTROIInterpretedType =
  | 'GTV'
  | 'CTV'
  | 'PTV'
  | 'ORGAN'
  | 'EXTERNAL'
  | 'SUPPORT'
  | 'FIXATION'
  | 'CAVITY'
  | 'BOLUS'
  | 'AVOIDANCE'
  | 'CONTROL'
  | 'DOSE_REGION'
  | 'MARKER'
  | 'REGISTRATION'
  | 'ISOCENTER'
  | 'CONTRAST_AGENT'
  | 'TREATED_VOLUME'
  | 'IRRAD_VOLUME'
  | 'BRACHY_CHANNEL'
  | 'BRACHY_ACCESSORY'
  | 'BRACHY_SRC_APP'
  | 'BRACHY_CHNL_SHLD';

/** DICOM coded concept (Code Value, Coding Scheme Designator, Code Meaning). */
export interface CodedConcept {
  codeValue: string;
  codingSchemeDesignator: string;
  codeMeaning: string;
}

/** A reserved expression for v2 ROI Algebra. v1 always sets this to null. */
export interface AlgebraExpression {
  /** Stored as a string in v1; v2 may evolve to an AST. Opaque in v1. */
  expression: string;
}

/**
 * One ROI / segment / POI within a container. Geometry lives in Cornerstone
 * (referenced via csAnnotationUIDs or csSegmentationId); this shape is
 * metadata + bridge fields.
 */
export interface Member {
  id: string;
  /** RTROIObservationLabel for RTSTRUCT, SegmentLabel for SEG, user-set for POI. */
  name: string;
  color: RGB;
  visibility: VisibilityMode;
  /** Session-only lock (C5). Distinct from container approval (D7.11). */
  locked: boolean;
  provenance: Provenance;

  // ─── RTSTRUCT-only ──
  /** DICOM RTROIInterpretedType. Null on non-RTSTRUCT members. */
  roiType: RTROIInterpretedType | null;
  /** For default ordering and DICOM round-trip. Null on non-RTSTRUCT members. */
  roiNumber: number | null;
  /** Per B5: 'has-interpolated' until manual edit or save clears the marker. */
  interpolationState: 'none' | 'has-interpolated' | null;

  // ─── SEG-only ──
  segmentIndex: number | null;
  segmentDescription: string | null;
  segmentedPropertyCategory: CodedConcept | null;
  segmentedPropertyType: CodedConcept | null;

  // ─── POI-only ──
  /**
   * For POI members only: world-space points. SEG and RTSTRUCT members hold
   * geometry in Cornerstone, not here. Null on non-POI members.
   */
  poiPoints: ReadonlyArray<readonly [number, number, number]> | null;

  // ─── ROI Algebra reserved (forward-compat per design §2.8). v1 always null. ──
  algebra: AlgebraExpression | null;
  algebraSources: string[] | null;
  algebraOutOfDate: boolean;
  algebraManualOverride: boolean;

  // ─── Cornerstone bridge ──
  /** UIDs in Cornerstone's annotation state; null on non-RTSTRUCT or empty members. */
  csAnnotationUIDs: string[] | null;
  /** Cornerstone segmentation ID; null on non-SEG members. */
  csSegmentationId: string | null;

  /** Session timestamps in milliseconds since epoch. */
  createdAt: number;
  modifiedAt: number;
}

// ─── Source identity (matches transport contract H2) ─────────────────────

/** Opaque transport-assigned token used for conflict detection (H2/H6). */
export type VersionToken = string;

/** Identity of a container as known to the transport layer. */
export interface SourceIdentity {
  /** Opaque to the multi-viewport layer (transport-defined). */
  uri: string;
  modality: ContainerKind;
  /** Series UIDs the container was authored against. */
  referencedSeriesUIDs: string[];
  referencedFrameOfReferenceUID: string;
  /** Session timestamp in ms since epoch. */
  loadedAt: number;
}

// ─── Approval (D7.11) ────────────────────────────────────────────────────

export interface ApprovalState {
  approved: boolean;
  /** DICOM ReviewerName (300E,0008) when available; else null. */
  reviewerName: string | null;
  /** Combined ReviewDate (300E,0004) + ReviewTime (300E,0005); ms since epoch; null if not set. */
  reviewedAt: number | null;
  /** Session-only audit trail; not all events persist to DICOM. */
  history: ApprovalEvent[];
}

export interface ApprovalEvent {
  action: 'approve' | 'revoke';
  /** User identity if available from the transport layer; else null. */
  by: string | null;
  /** ms since epoch. */
  at: number;
}

export const DEFAULT_APPROVAL: ApprovalState = {
  approved: false,
  reviewerName: null,
  reviewedAt: null,
  history: [],
};

// ─── Active / selection state (A6, A7, A11, D7.5) ────────────────────────

/** Single global active / selection / focus state. */
export interface ActiveState {
  /**
   * The "pen" — drawing tools always write to this member's container.
   * Active container is derived: the container that owns this member.
   * Null means nothing to draw into; B3 blocks drawing in that case.
   */
  activeMemberId: string | null;
  /** Multi-select set of member IDs (D7.5). Independent of activeMemberId. */
  selectionSet: ReadonlySet<string>;
  /** Edit target (A7) — set by explicit click-to-focus. Null = no panel focused. */
  activeViewportId: string | null;
  /** Single global active tool (A6). */
  activeToolId: string | null;
  /** Transient hover (D2); session-only. */
  hoverMemberId: string | null;
}

export const EMPTY_ACTIVE_STATE: ActiveState = {
  activeMemberId: null,
  selectionSet: new Set(),
  activeViewportId: null,
  activeToolId: null,
  hoverMemberId: null,
};

// ─── Per-viewport visibility overrides (A5) ──────────────────────────────

/**
 * Session-only per-viewport hide list. Closing a viewport discards its
 * overrides (A5). Reopening starts fresh from each member's global default.
 */
export interface PerViewportVisibility {
  /** viewportId → set of memberIds hidden on that viewport. */
  overrides: Map<string, Set<string>>;
}

// ─── Undo / redo (A8) ────────────────────────────────────────────────────

/**
 * One entry in the per-container undo stack. The apply/invert closures are
 * created by the domain code that emits the action; the undoService stores
 * them but does not interpret them.
 */
export interface HistoryEntry {
  /** Short user-readable description, e.g. "Brush stroke on PTV slice 42". */
  description: string;
  /** Invoked on redo. */
  apply: () => void;
  /** Invoked on undo. */
  invert: () => void;
  /**
   * Member IDs this entry references. Used to invalidate the entry if the
   * container is reloaded externally (E3 / H6) — pre-reload entries no
   * longer apply and the stack is cleared.
   */
  scopeMemberIds: string[];
  /** Session timestamp in ms since epoch. */
  at: number;
}

export interface ContainerHistory {
  containerId: string;
  /** ≥ 100 entries before overflow drops oldest (A8). */
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

/** Default cap on per-container undo depth (A8). */
export const UNDO_HISTORY_LIMIT = 100;

// ─── Errors ──────────────────────────────────────────────────────────────

export interface ParseError {
  message: string;
  /** Underlying error if available (stack/cause chain). Display-only. */
  cause?: unknown;
  /** ms since epoch. */
  at: number;
}
