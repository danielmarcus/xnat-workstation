/**
 * Container Service — CRUD for Container objects (RTSTRUCT, SEG, POI).
 *
 * Single entry point for:
 *   - creating, deleting, renaming containers
 *   - adding, removing, renaming, recoloring members
 *   - setting ROI type
 *   - managing approval state
 *   - resolving the active member → active container relationship
 *
 * See docs/multiviewport-annotation-design.md §4.2.
 *
 * Phase 0: skeleton with method shapes only. Implementation lands in Phase 1+
 * when the consumers (drawing routing, list panel, transport) come online.
 *
 * The service is a singleton module — no class. Mirrors the convention of
 * segmentationService, toolService, etc.
 */
import type {
  Container,
  ContainerKind,
  Member,
  RTROIInterpretedType,
  RGB,
  ApprovalEvent,
} from '../../types/annotation';

export interface CreateContainerInput {
  kind: ContainerKind;
  name: string;
  /** Series UID the new container is tagged to. Required to enforce B3 routing. */
  referencedSeriesUID: string;
  /** FoR the new container is tagged to. Required for A2/A3 eligibility. */
  referencedFrameOfReferenceUID: string;
}

export interface CreateMemberInput {
  containerId: string;
  name: string;
  color: RGB;
  /** Required for RTSTRUCT containers; ignored otherwise. */
  roiType?: RTROIInterpretedType;
  /** Required for SEG containers; ignored otherwise. */
  segmentDescription?: string;
}

export interface ContainerService {
  // ─── Container lifecycle ──────────────────────────────────────────────

  /** Create an empty container. Caller must subsequently add members or wire to Cornerstone state. */
  createContainer(input: CreateContainerInput): Container;

  /** Delete a container, releasing all member geometry from Cornerstone state. */
  deleteContainer(containerId: string): void;

  /** Rename a container (StructureSetLabel / SeriesDescription). */
  renameContainer(containerId: string, name: string): void;

  // ─── Member CRUD ──────────────────────────────────────────────────────

  /** Create an empty member; caller activates it (D7.5) before drawing. */
  createMember(input: CreateMemberInput): Member;

  /** Permanently delete a member and its Cornerstone-side geometry. */
  deleteMember(memberId: string): void;

  /** Rename a member (RTROIObservationLabel / SegmentLabel). */
  renameMember(memberId: string, name: string): void;

  /** Recolor a member; propagates to all eligible viewports per A4. */
  recolorMember(memberId: string, color: RGB): void;

  /** Set ROI type on an RTSTRUCT member; no-op for non-RTSTRUCT members. */
  setRoiType(memberId: string, roiType: RTROIInterpretedType): void;

  // ─── Active state resolution ──────────────────────────────────────────

  /**
   * Look up the active container for the current active member (D7.5).
   * Returns null if no active member is set.
   */
  getActiveContainer(): Container | null;

  /** The active member, or null if none. */
  getActiveMember(): Member | null;

  /** Set the active member. Implicitly sets the active container. */
  setActiveMember(memberId: string | null): void;

  // ─── Approval (D7.11) ─────────────────────────────────────────────────

  /** Approve a container, locking it from edits. Persists via DICOM ApprovalStatus. */
  approveContainer(containerId: string, by: string | null): void;

  /** Revoke approval. Audit-trail-recorded but does not delete the prior approval event. */
  revokeApproval(containerId: string, by: string | null): void;

  /** Read the approval audit history for a container. */
  getApprovalHistory(containerId: string): ApprovalEvent[];
}

// Phase 0: throw on every call so accidental consumption fails loudly.
// Implementation lands incrementally in subsequent phases.
function notImplemented(method: string): never {
  throw new Error(`[containerService] ${method} not yet implemented (multi-viewport rewrite is in Phase 0)`);
}

export const containerService: ContainerService = {
  createContainer: () => notImplemented('createContainer'),
  deleteContainer: () => notImplemented('deleteContainer'),
  renameContainer: () => notImplemented('renameContainer'),
  createMember: () => notImplemented('createMember'),
  deleteMember: () => notImplemented('deleteMember'),
  renameMember: () => notImplemented('renameMember'),
  recolorMember: () => notImplemented('recolorMember'),
  setRoiType: () => notImplemented('setRoiType'),
  getActiveContainer: () => notImplemented('getActiveContainer'),
  getActiveMember: () => notImplemented('getActiveMember'),
  setActiveMember: () => notImplemented('setActiveMember'),
  approveContainer: () => notImplemented('approveContainer'),
  revokeApproval: () => notImplemented('revokeApproval'),
  getApprovalHistory: () => notImplemented('getApprovalHistory'),
};
