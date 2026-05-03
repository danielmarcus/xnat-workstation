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
import { useContainerSelectionStore } from '../../stores/containerSelectionStore';
import type {
  ApprovalEvent,
  Container,
  ContainerKind,
  Member,
  RGB,
  RTROIInterpretedType,
  VisibilityMode,
} from '../../types/annotation';
import {
  applyMemberVisibilityMode,
  type MemberVisibilityDeps,
} from './segmentationService/memberVisibility';

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

  /**
   * Create an empty member; caller activates it (D7.5) before drawing.
   * Async because the underlying segmentationService.addSegment is async.
   * The new Member surfaces in the containerStore via SEGMENTATION_MODIFIED
   * auto-sync; consumers don't need to await unless they need the new
   * segmentIndex for follow-up calls.
   */
  createMember(input: CreateMemberInput): Promise<number>;

  /** Permanently delete a member and its Cornerstone-side geometry. */
  deleteMember(memberId: string): void;

  /** Rename a member (RTROIObservationLabel / SegmentLabel). */
  renameMember(memberId: string, name: string): void;

  /** Recolor a member; propagates to all eligible viewports per A4. */
  recolorMember(memberId: string, color: RGB): void;

  /** Set ROI type on an RTSTRUCT member; no-op for non-RTSTRUCT members. */
  setRoiType(memberId: string, roiType: RTROIInterpretedType): void;

  /**
   * Set the visibility mode (D7.3) on a member. Updates the bridge's
   * Container.members[member].visibility AND pushes through to
   * Cornerstone (per-segment style + per-segment visibility on attached
   * viewports). Visibility-mode is session-only state and does NOT mark
   * the container dirty (per §D7.10).
   */
  setMemberVisibility(memberId: string, mode: VisibilityMode): void;

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

// ─── Phase 3.4 / 3.6: Cornerstone deps wired by segmentationService ────

/** Phase 3.6 deps for member CRUD — wrappers over segmentationService. */
export interface MemberCrudDeps {
  /** Add a new segment to a Cornerstone segmentation. Returns new segmentIndex. */
  addSegment: (segmentationId: string, label: string, color?: [number, number, number, number]) => Promise<number>;
  /** Remove a segment from a Cornerstone segmentation. */
  removeSegment: (segmentationId: string, segmentIndex: number) => void;
  /** Rename a segment within a segmentation. */
  renameSegment: (segmentationId: string, segmentIndex: number, label: string) => void;
  /** Recolor a segment within a segmentation. */
  setSegmentColor: (
    segmentationId: string,
    segmentIndex: number,
    color: [number, number, number, number],
  ) => void;
}

interface ContainerServiceDeps extends MemberVisibilityDeps, MemberCrudDeps {}

const NOOP_DEPS: ContainerServiceDeps = {
  setSegmentStyle: () => undefined,
  setSegmentVisibility: () => undefined,
  getViewportIdsWithSegmentation: () => [],
  getRepresentationKinds: () => [],
  addSegment: () => Promise.resolve(0),
  removeSegment: () => undefined,
  renameSegment: () => undefined,
  setSegmentColor: () => undefined,
};

let deps: ContainerServiceDeps = NOOP_DEPS;
let memberVisibilityDeps: MemberVisibilityDeps = NOOP_DEPS;

/**
 * Inject the Cornerstone-backed deps used by setMemberVisibility (Phase 3.4)
 * and member CRUD (Phase 3.6). Called once at segmentationService.initialize()
 * with real Cornerstone-wrapping APIs; tests pass synthetic stubs to avoid
 * module-level Cornerstone mocks.
 */
export function wireContainerService(injected: Partial<ContainerServiceDeps>): void {
  deps = { ...NOOP_DEPS, ...injected };
  memberVisibilityDeps = deps;
}

/** Reset the deps to no-op stubs. Used by test teardown. */
export function resetContainerServiceWiring(): void {
  deps = NOOP_DEPS;
  memberVisibilityDeps = NOOP_DEPS;
}

// ─── Phase 3.1 implementations ──────────────────────────────────────────

function notImplementedYet(method: string, phase: string): never {
  throw new Error(`[containerService] ${method} not yet implemented (lands in ${phase})`);
}

function findMemberContainer(
  memberId: string,
): { container: Container; member: Member } | null {
  if (!memberId) return null;
  for (const { containerId } of containerBridge.listAll()) {
    const container = containerBridge.getContainer(containerId);
    if (!container) continue;
    const member = container.members.find((m) => m.id === memberId);
    if (member) return { container, member };
  }
  return null;
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

  // ─── Member CRUD (Phase 3.6) ──────────────────────────────────────────

  /**
   * Add a new segment to the container's underlying Cornerstone
   * segmentation. The new Member surfaces in `useContainerStore` via
   * the SEGMENTATION_MODIFIED auto-sync; the returned segmentIndex is
   * useful for callers that want to immediately activate or further
   * configure the new segment.
   *
   * Marks the container dirty since adding a member is a persisted-state
   * mutation.
   */
  async createMember(input: CreateMemberInput): Promise<number> {
    if (!input.containerId) {
      throw new Error('[containerService] createMember: containerId is required');
    }
    const csSegId = containerBridge.getCsSegmentationId(input.containerId);
    if (!csSegId) {
      throw new Error(`[containerService] createMember: unknown containerId ${input.containerId}`);
    }
    const label = input.name?.trim() || 'New segment';
    const colorRgba: [number, number, number, number] = [
      input.color[0],
      input.color[1],
      input.color[2],
      255,
    ];
    const segmentIndex = await deps.addSegment(csSegId, label, colorRgba);
    containerBridge.setDirty(input.containerId, true);
    return segmentIndex;
  },

  /**
   * Permanently delete a member by removing the underlying Cornerstone
   * segment. Marks the container dirty. Idempotent on unknown memberId
   * (no-op rather than throw — matches the segmentationService.removeSegment
   * behavior for non-existent indices).
   */
  deleteMember(memberId: string): void {
    if (!memberId) return;
    const found = findMemberContainer(memberId);
    if (!found) return;
    const { container, member } = found;
    if (!member.csSegmentationId || !Number.isInteger(member.segmentIndex) || member.segmentIndex! <= 0) {
      return;
    }
    deps.removeSegment(member.csSegmentationId, member.segmentIndex!);
    containerBridge.setDirty(container.id, true);
    // Member array re-derives via SEGMENTATION_MODIFIED auto-sync.
  },

  /**
   * Rename a member. Updates Cornerstone's segment label, which fires
   * SEGMENTATION_MODIFIED → containerStore re-derives the Member with
   * the new name. Marks the container dirty.
   */
  renameMember(memberId: string, name: string): void {
    if (!memberId) return;
    if (typeof name !== 'string') {
      throw new Error('[containerService] renameMember: name must be a string');
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('[containerService] renameMember: name cannot be empty');
    }
    const found = findMemberContainer(memberId);
    if (!found) {
      throw new Error(`[containerService] renameMember: unknown memberId ${memberId}`);
    }
    const { container, member } = found;
    if (member.name === trimmed) return;
    if (!member.csSegmentationId || !Number.isInteger(member.segmentIndex) || member.segmentIndex! <= 0) {
      return;
    }
    deps.renameSegment(member.csSegmentationId, member.segmentIndex!, trimmed);
    containerBridge.setDirty(container.id, true);
  },

  /**
   * Recolor a member. Updates Cornerstone's per-segment color; the
   * containerStore re-derives the Member via the next color-mod event
   * (or on the next SEGMENTATION_MODIFIED). Marks the container dirty.
   */
  recolorMember(memberId: string, color: RGB): void {
    if (!memberId) return;
    const found = findMemberContainer(memberId);
    if (!found) {
      throw new Error(`[containerService] recolorMember: unknown memberId ${memberId}`);
    }
    const { container, member } = found;
    if (!member.csSegmentationId || !Number.isInteger(member.segmentIndex) || member.segmentIndex! <= 0) {
      return;
    }
    const colorRgba: [number, number, number, number] = [color[0], color[1], color[2], 255];
    deps.setSegmentColor(member.csSegmentationId, member.segmentIndex!, colorRgba);
    containerBridge.setDirty(container.id, true);
  },
  setRoiType: () => notImplementedYet('setRoiType', 'Phase 3.8 ROI type badge'),

  /**
   * Set the visibility mode on a member (D7.3) — updates bridge state
   * AND applies through to Cornerstone. Idempotent on no-op (same mode).
   * Visibility mode is session-only (D7.10) so does NOT mark the
   * container dirty.
   */
  setMemberVisibility(memberId: string, mode: VisibilityMode): void {
    if (!memberId) return;
    const found = findMemberContainer(memberId);
    if (!found) {
      throw new Error(`[containerService] setMemberVisibility: unknown memberId ${memberId}`);
    }
    const { container, member } = found;
    if (member.visibility === mode) return;

    member.visibility = mode;
    member.modifiedAt = Date.now();

    if (member.csSegmentationId && Number.isInteger(member.segmentIndex) && member.segmentIndex! > 0) {
      applyMemberVisibilityMode(
        memberVisibilityDeps,
        member.csSegmentationId,
        member.segmentIndex!,
        mode,
      );
    }

    // Notify the store sync so the UI re-renders. Visibility-mode is
    // session-only per §D7.10 — explicitly NOT calling `dirty = true`.
    containerBridge.notifyChange(container.id);
  },

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

  /**
   * Set the active member globally (D7.5). Updates both:
   *   - the new containerSelectionStore (multi-viewport-aware surface);
   *   - the legacy useSegmentationStore (activeSegmentationId +
   *     activeSegmentIndex), so existing tools and the autoSave
   *     pipeline keep working unchanged during the transitional period.
   *
   * Pass null to clear (no active member; B3 blocks drawing).
   */
  setActiveMember(memberId: string | null): void {
    if (memberId === null) {
      useContainerSelectionStore.getState().setActive(null);
      // Don't clear legacy state — leaving it gives the legacy panels
      // their own behavior continuity. Phase 6 collapses legacy panels.
      return;
    }
    const found = findMemberContainer(memberId);
    if (!found) {
      throw new Error(`[containerService] setActiveMember: unknown memberId ${memberId}`);
    }
    const { member } = found;
    useContainerSelectionStore.getState().setActive(memberId);

    // Mirror to the legacy store so segmentationService.* and the
    // existing tools see the same active state. Only set the bits that
    // map cleanly: the cs segmentation + segment index.
    if (member.csSegmentationId) {
      useSegmentationStore.setState({
        activeSegmentationId: member.csSegmentationId,
      });
    }
    if (Number.isInteger(member.segmentIndex) && member.segmentIndex! > 0) {
      useSegmentationStore.setState({
        activeSegmentIndex: member.segmentIndex!,
      });
    }
  },

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
