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
 * Phase 3.1 implements the read-only and metadata-mutation surface:
 *   - getActiveContainer / getActiveMember / getApprovalHistory (read)
 *   - renameContainer / approveContainer / revokeApproval (metadata mutate
 *     on the bridge's Container summary; no Cornerstone interaction)
 *
 * Member CRUD (createMember / deleteMember / renameMember / recolorMember /
 * setRoiType / setActiveMember) and container creation/deletion still
 * throw — they require the Phase 3.2 containerStore + Cornerstone-segment
 * sync layer that's about to land. Each throw names the phase that will
 * implement it.
 *
 * The service is a singleton module — no class. Mirrors the convention of
 * segmentationService, toolService, etc.
 */
import * as containerBridge from './containerBridge';
import { useSegmentationStore } from '../../stores/segmentationStore';
import type {
  ApprovalEvent,
  Container,
  ContainerKind,
  Member,
  RGB,
  RTROIInterpretedType,
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

// ─── Phase 3.1 implementations ──────────────────────────────────────────

function notImplementedYet(method: string, phase: string): never {
  throw new Error(`[containerService] ${method} not yet implemented (lands in ${phase})`);
}

export const containerService: ContainerService = {
  // ─── Container lifecycle ──────────────────────────────────────────────

  createContainer: () => notImplementedYet('createContainer', 'Phase 3.6 session-level actions'),
  deleteContainer: () => notImplementedYet('deleteContainer', 'Phase 3.6 session-level actions'),

  /**
   * Rename a container. Mutates the bridge's Container summary. Idempotent
   * on no-op rename. The DICOM-level rename (StructureSetLabel /
   * SeriesDescription) is applied at save time by the transport layer.
   */
  renameContainer(containerId: string, name: string): void {
    if (!containerId) return;
    const container = containerBridge.getContainer(containerId);
    if (!container) {
      throw new Error(`[containerService] renameContainer: unknown containerId ${containerId}`);
    }
    if (typeof name !== 'string') {
      throw new Error('[containerService] renameContainer: name must be a string');
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('[containerService] renameContainer: name cannot be empty');
    }
    if (container.name === trimmed) return;
    container.name = trimmed;
    // Renaming is a persisted-state mutation, so the container becomes dirty.
    container.dirty = true;
    containerBridge.notifyChange(containerId);
  },

  // ─── Member CRUD (Phase 3.2 / 3.6) ────────────────────────────────────

  createMember: () => notImplementedYet('createMember', 'Phase 3.2 containerStore + Cornerstone-segment sync'),
  deleteMember: () => notImplementedYet('deleteMember', 'Phase 3.2'),
  renameMember: () => notImplementedYet('renameMember', 'Phase 3.2'),
  recolorMember: () => notImplementedYet('recolorMember', 'Phase 3.2'),
  setRoiType: () => notImplementedYet('setRoiType', 'Phase 3.8 ROI type badge'),

  // ─── Active state resolution ──────────────────────────────────────────

  /**
   * Look up the active container by resolving through the bridge from the
   * current active segmentation. Returns null when no active segmentation
   * is set or the active segmentation has no bridge entry.
   */
  getActiveContainer(): Container | null {
    const containerId = containerBridge.getActiveContainerId();
    return containerId ? containerBridge.getContainer(containerId) : null;
  },

  /**
   * In v1's data flow, the "active member" is implicit via the
   * combination of `useSegmentationStore.activeSegmentationId` (→ container)
   * and `activeSegmentIndex` (→ which segment within that container).
   *
   * Phase 3.1 returns the synthesized Member from the bridge's
   * `Container.members[]` array when populated; if `members` is empty (the
   * Phase 2.6 default — Phase 3.2 wires the auto-population), returns null.
   *
   * The Phase 3.2 containerStore will keep `Container.members[]` in sync
   * with Cornerstone segment events, after which this read consistently
   * resolves the active member.
   */
  getActiveMember(): Member | null {
    const container = this.getActiveContainer();
    if (!container) return null;
    const segmentIndex = useSegmentationStore.getState().activeSegmentIndex;
    if (!Number.isInteger(segmentIndex) || segmentIndex <= 0) return null;
    return (
      container.members.find((m) => m.segmentIndex === segmentIndex)
      ?? null
    );
  },

  setActiveMember: () => notImplementedYet('setActiveMember', 'Phase 3.2'),

  // ─── Approval (D7.11) ─────────────────────────────────────────────────

  /**
   * Approve a container. Sets `approval.approved = true`, records a
   * timestamped event in `approval.history`, and marks the container dirty
   * (so the new ApprovalStatus persists on next save). Idempotent — re-
   * approving an already-approved container does NOT add a duplicate
   * audit entry.
   */
  approveContainer(containerId: string, by: string | null): void {
    if (!containerId) return;
    const container = containerBridge.getContainer(containerId);
    if (!container) {
      throw new Error(`[containerService] approveContainer: unknown containerId ${containerId}`);
    }
    if (container.approval.approved) return;
    const event: ApprovalEvent = {
      action: 'approve',
      by: by ?? null,
      at: Date.now(),
    };
    container.approval = {
      ...container.approval,
      approved: true,
      reviewerName: by ?? container.approval.reviewerName,
      reviewedAt: event.at,
      history: [...container.approval.history, event],
    };
    container.dirty = true;
    containerBridge.notifyChange(containerId);
  },

  /**
   * Revoke approval. Records a timestamped event in `approval.history` —
   * does NOT delete prior approve events; the audit trail is append-only.
   * Idempotent — revoking an already-unapproved container does NOT add a
   * duplicate audit entry.
   */
  revokeApproval(containerId: string, by: string | null): void {
    if (!containerId) return;
    const container = containerBridge.getContainer(containerId);
    if (!container) {
      throw new Error(`[containerService] revokeApproval: unknown containerId ${containerId}`);
    }
    if (!container.approval.approved) return;
    const event: ApprovalEvent = {
      action: 'revoke',
      by: by ?? null,
      at: Date.now(),
    };
    container.approval = {
      ...container.approval,
      approved: false,
      // Reviewer/reviewedAt cleared on revoke; the prior values stay in history.
      reviewerName: null,
      reviewedAt: null,
      history: [...container.approval.history, event],
    };
    container.dirty = true;
    containerBridge.notifyChange(containerId);
  },

  /**
   * Read the approval audit history for a container. Returns a copy so
   * callers can't mutate the bridge's Container state directly.
   */
  getApprovalHistory(containerId: string): ApprovalEvent[] {
    if (!containerId) return [];
    const container = containerBridge.getContainer(containerId);
    return container ? [...container.approval.history] : [];
  },
};
