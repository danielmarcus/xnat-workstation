/**
 * Tests for the Phase 3.1 containerService implementation surface.
 *
 * Phase 3.1 implements: read methods (getActiveContainer, getActiveMember,
 * getApprovalHistory) and metadata mutations (renameContainer,
 * approveContainer, revokeApproval). All operate on the containerBridge's
 * Container summary state — no Cornerstone interaction.
 *
 * The bridge's auto-track listener is mocked away (we register containers
 * directly via the public API) so these tests don't depend on a real
 * Cornerstone event target.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEventTarget } = vi.hoisted(() => ({
  mockEventTarget: new EventTarget(),
}));

vi.mock('@cornerstonejs/core', () => ({
  eventTarget: mockEventTarget,
}));

vi.mock('@cornerstonejs/tools', () => ({
  Enums: {
    Events: {
      SEGMENTATION_ADDED: 'CS_SEGMENTATION_ADDED',
      SEGMENTATION_REMOVED: 'CS_SEGMENTATION_REMOVED',
    },
  },
  segmentation: {
    state: {
      getSegmentation: vi.fn((id: string) => ({ label: id })),
    },
  },
}));

import {
  containerService,
  resetContainerServiceWiring,
  wireContainerService,
} from './containerService';
import * as containerBridge from './containerBridge';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useContainerSelectionStore } from '../../stores/containerSelectionStore';
import type { Member } from '../../types/annotation';

beforeEach(() => {
  containerBridge.clearAll();
  useSegmentationStore.setState({
    activeSegmentationId: null,
    activeSegmentIndex: 0,
  });
  useContainerSelectionStore.getState().setActive(null);
  useContainerSelectionStore.getState().clearSelection();
  useContainerSelectionStore.getState().setHover(null);
});

afterEach(() => {
  containerBridge.clearAll();
  useContainerSelectionStore.getState().setActive(null);
  useContainerSelectionStore.getState().clearSelection();
  useContainerSelectionStore.getState().setHover(null);
});

// ─── renameContainer ──────────────────────────────────────────────────

describe('renameContainer', () => {
  it('updates the container’s name', () => {
    const id = containerBridge.register('seg_1', { name: 'Original' });
    containerService.renameContainer(id, 'New name');
    expect(containerBridge.getContainer(id)?.name).toBe('New name');
  });

  it('marks the container dirty (rename is a persisted-state mutation)', () => {
    const id = containerBridge.register('seg_1', { name: 'Original' });
    containerService.renameContainer(id, 'New name');
    expect(containerBridge.getContainer(id)?.dirty).toBe(true);
  });

  it('trims whitespace', () => {
    const id = containerBridge.register('seg_1', { name: 'Original' });
    containerService.renameContainer(id, '  spaces around  ');
    expect(containerBridge.getContainer(id)?.name).toBe('spaces around');
  });

  it('idempotent on no-op rename — does not flip dirty', () => {
    const id = containerBridge.register('seg_1', { name: 'Same' });
    // Reset dirty (in case register set it; it doesn't, but be defensive)
    containerBridge.setDirty(id, false);
    containerService.renameContainer(id, 'Same');
    expect(containerBridge.getContainer(id)?.dirty).toBe(false);
  });

  it('throws on empty name', () => {
    const id = containerBridge.register('seg_1');
    expect(() => containerService.renameContainer(id, '   ')).toThrow(/empty/);
  });

  it('throws on unknown containerId', () => {
    expect(() => containerService.renameContainer('container-unknown', 'X')).toThrow(/unknown/);
  });

  it('no-op on empty containerId', () => {
    expect(() => containerService.renameContainer('', 'X')).not.toThrow();
  });
});

// ─── approveContainer / revokeApproval / getApprovalHistory ──────────

describe('approveContainer', () => {
  it('flips approved=true, records reviewer + timestamp + audit event', () => {
    const id = containerBridge.register('seg_1');
    containerService.approveContainer(id, 'dr.smith');
    const approval = containerBridge.getContainer(id)!.approval;
    expect(approval.approved).toBe(true);
    expect(approval.reviewerName).toBe('dr.smith');
    expect(approval.reviewedAt).toBeTypeOf('number');
    expect(approval.history).toHaveLength(1);
    expect(approval.history[0]).toMatchObject({ action: 'approve', by: 'dr.smith' });
  });

  it('marks the container dirty', () => {
    const id = containerBridge.register('seg_1');
    containerService.approveContainer(id, null);
    expect(containerBridge.getContainer(id)?.dirty).toBe(true);
  });

  it('idempotent on already-approved container — no duplicate audit entry', () => {
    const id = containerBridge.register('seg_1');
    containerService.approveContainer(id, 'dr.smith');
    containerService.approveContainer(id, 'dr.jones');
    expect(containerBridge.getContainer(id)?.approval.history).toHaveLength(1);
    expect(containerBridge.getContainer(id)?.approval.reviewerName).toBe('dr.smith');
  });

  it('accepts null reviewer (transport-layer identity not available)', () => {
    const id = containerBridge.register('seg_1');
    containerService.approveContainer(id, null);
    const approval = containerBridge.getContainer(id)!.approval;
    expect(approval.approved).toBe(true);
    expect(approval.reviewerName).toBeNull();
  });

  it('throws on unknown containerId', () => {
    expect(() => containerService.approveContainer('nope', null)).toThrow(/unknown/);
  });
});

describe('revokeApproval', () => {
  it('flips approved=false, records audit event, clears reviewedAt + reviewerName', () => {
    const id = containerBridge.register('seg_1');
    containerService.approveContainer(id, 'dr.smith');
    containerService.revokeApproval(id, 'dr.smith');
    const approval = containerBridge.getContainer(id)!.approval;
    expect(approval.approved).toBe(false);
    expect(approval.reviewerName).toBeNull();
    expect(approval.reviewedAt).toBeNull();
  });

  it('preserves prior approval events in history (audit trail is append-only)', () => {
    const id = containerBridge.register('seg_1');
    containerService.approveContainer(id, 'dr.smith');
    containerService.revokeApproval(id, 'dr.jones');
    const history = containerBridge.getContainer(id)!.approval.history;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ action: 'approve', by: 'dr.smith' });
    expect(history[1]).toMatchObject({ action: 'revoke', by: 'dr.jones' });
  });

  it('marks the container dirty', () => {
    const id = containerBridge.register('seg_1');
    containerService.approveContainer(id, 'dr.smith');
    // Re-clear dirty to verify revoke marks it dirty too
    containerBridge.setDirty(id, false);
    containerService.revokeApproval(id, 'dr.smith');
    expect(containerBridge.getContainer(id)?.dirty).toBe(true);
  });

  it('idempotent on already-unapproved container — no duplicate revoke entry', () => {
    const id = containerBridge.register('seg_1');
    containerService.revokeApproval(id, 'dr.smith');
    expect(containerBridge.getContainer(id)?.approval.history).toHaveLength(0);
  });

  it('re-approve after revoke creates a new audit event', () => {
    const id = containerBridge.register('seg_1');
    containerService.approveContainer(id, 'dr.smith');
    containerService.revokeApproval(id, 'dr.smith');
    containerService.approveContainer(id, 'dr.jones');
    const history = containerBridge.getContainer(id)!.approval.history;
    expect(history).toHaveLength(3);
    expect(history.map((e) => e.action)).toEqual(['approve', 'revoke', 'approve']);
  });

  it('throws on unknown containerId', () => {
    expect(() => containerService.revokeApproval('nope', null)).toThrow(/unknown/);
  });
});

describe('getApprovalHistory', () => {
  it('returns a copy of the audit trail', () => {
    const id = containerBridge.register('seg_1');
    containerService.approveContainer(id, 'a');
    containerService.revokeApproval(id, 'b');
    const history = containerService.getApprovalHistory(id);
    expect(history).toHaveLength(2);
  });

  it('mutating the returned array does not affect bridge state', () => {
    const id = containerBridge.register('seg_1');
    containerService.approveContainer(id, 'a');
    const history = containerService.getApprovalHistory(id);
    history.push({ action: 'approve', by: 'forged', at: 0 });
    // Bridge still has only the original entry.
    expect(containerBridge.getContainer(id)?.approval.history).toHaveLength(1);
  });

  it('returns empty array for unknown container', () => {
    expect(containerService.getApprovalHistory('nope')).toEqual([]);
  });

  it('returns empty array for empty containerId', () => {
    expect(containerService.getApprovalHistory('')).toEqual([]);
  });
});

// ─── getActiveContainer / getActiveMember ─────────────────────────────

describe('getActiveContainer', () => {
  it('returns null when no active segmentation is set', () => {
    expect(containerService.getActiveContainer()).toBeNull();
  });

  it('resolves the active segmentation through the bridge', () => {
    const id = containerBridge.register('seg_1', { name: 'Active' });
    useSegmentationStore.setState({ activeSegmentationId: 'seg_1' });
    expect(containerService.getActiveContainer()?.id).toBe(id);
    expect(containerService.getActiveContainer()?.name).toBe('Active');
  });

  it('returns null when active segmentation has no bridge entry', () => {
    useSegmentationStore.setState({ activeSegmentationId: 'unregistered' });
    expect(containerService.getActiveContainer()).toBeNull();
  });
});

describe('getActiveMember', () => {
  it('returns null when no active container', () => {
    expect(containerService.getActiveMember()).toBeNull();
  });

  it('returns null when bridge Container.members is empty (Phase 3.2 wires sync)', () => {
    containerBridge.register('seg_1');
    useSegmentationStore.setState({ activeSegmentationId: 'seg_1', activeSegmentIndex: 1 });
    expect(containerService.getActiveMember()).toBeNull();
  });

  it('returns the matching member when found by segmentIndex', () => {
    const id = containerBridge.register('seg_1');
    const container = containerBridge.getContainer(id)!;
    // Phase 3.2 will populate this automatically; for the read test, inject directly.
    const member: Member = {
      id: 'member_1',
      name: 'Tumor',
      color: [255, 0, 0],
      visibility: 'filled',
      locked: false,
      provenance: 'manual',
      roiType: null,
      roiNumber: null,
      interpolationState: null,
      segmentIndex: 1,
      segmentDescription: null,
      segmentedPropertyCategory: null,
      segmentedPropertyType: null,
      poiPoints: null,
      algebra: null,
      algebraSources: null,
      algebraOutOfDate: false,
      algebraManualOverride: false,
      csAnnotationUIDs: null,
      csSegmentationId: 'seg_1',
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };
    container.members.push(member);
    useSegmentationStore.setState({ activeSegmentationId: 'seg_1', activeSegmentIndex: 1 });
    expect(containerService.getActiveMember()?.id).toBe('member_1');
  });

  it('returns null when active segmentIndex is 0 or invalid', () => {
    containerBridge.register('seg_1');
    useSegmentationStore.setState({ activeSegmentationId: 'seg_1', activeSegmentIndex: 0 });
    expect(containerService.getActiveMember()).toBeNull();
  });
});

// ─── Stubs for not-yet-implemented methods ────────────────────────────

describe('not-yet-implemented methods', () => {
  it('createContainer throws with phase pointer', () => {
    expect(() =>
      containerService.createContainer({
        kind: 'SEG',
        name: 'X',
        referencedSeriesUID: 'S',
        referencedFrameOfReferenceUID: 'F',
      }),
    ).toThrow(/Phase 3\.6/);
  });

});

// ─── Phase 3.5a: setActiveMember ──────────────────────────────────────

describe('setActiveMember', () => {
  function injectMember(csSegId: string, memberId: string, segIdx = 1): void {
    const containerId = containerBridge.register(csSegId);
    containerBridge.getContainer(containerId)!.members.push({
      id: memberId,
      name: 'M',
      color: [255, 0, 0],
      visibility: 'filled',
      locked: false,
      provenance: 'manual',
      roiType: null,
      roiNumber: null,
      interpolationState: null,
      segmentIndex: segIdx,
      segmentDescription: null,
      segmentedPropertyCategory: null,
      segmentedPropertyType: null,
      poiPoints: null,
      algebra: null,
      algebraSources: null,
      algebraOutOfDate: false,
      algebraManualOverride: false,
      csAnnotationUIDs: null,
      csSegmentationId: csSegId,
      createdAt: 0,
      modifiedAt: 0,
    });
  }

  it('updates the containerSelectionStore active member', () => {
    injectMember('seg_1', 'm1');
    containerService.setActiveMember('m1');
    expect(useContainerSelectionStore.getState().activeMemberId).toBe('m1');
  });

  it('mirrors to the legacy useSegmentationStore for tool compatibility', () => {
    injectMember('seg_1', 'm1', 3);
    containerService.setActiveMember('m1');
    expect(useSegmentationStore.getState().activeSegmentationId).toBe('seg_1');
    expect(useSegmentationStore.getState().activeSegmentIndex).toBe(3);
  });

  it('null clears the selection-store active member but leaves legacy state intact', () => {
    injectMember('seg_1', 'm1');
    containerService.setActiveMember('m1');
    expect(useSegmentationStore.getState().activeSegmentationId).toBe('seg_1');

    containerService.setActiveMember(null);
    expect(useContainerSelectionStore.getState().activeMemberId).toBeNull();
    // Legacy state preserved during transitional period (Phase 6 collapses).
    expect(useSegmentationStore.getState().activeSegmentationId).toBe('seg_1');
  });

  it('throws on unknown memberId', () => {
    expect(() => containerService.setActiveMember('nope')).toThrow(/unknown/);
  });
});

// ─── Phase 3.6: member CRUD ─────────────────────────────────────────────

describe('member CRUD (Phase 3.6)', () => {
  // Mock CRUD deps so we don't depend on Cornerstone state.
  const addSegmentMock = vi.fn().mockResolvedValue(2);
  const removeSegmentMock = vi.fn();
  const renameSegmentMock = vi.fn();
  const setSegmentColorMock = vi.fn();

  beforeEach(() => {
    addSegmentMock.mockReset().mockResolvedValue(2);
    removeSegmentMock.mockReset();
    renameSegmentMock.mockReset();
    setSegmentColorMock.mockReset();
    wireContainerService({
      addSegment: addSegmentMock,
      removeSegment: removeSegmentMock,
      renameSegment: renameSegmentMock,
      setSegmentColor: setSegmentColorMock,
    });
  });

  afterEach(() => {
    resetContainerServiceWiring();
  });

  function injectMember(csSegId: string, memberId: string, segIdx = 1): string {
    const containerId = containerBridge.register(csSegId);
    containerBridge.getContainer(containerId)!.members.push({
      id: memberId,
      name: 'Original',
      color: [255, 0, 0],
      visibility: 'filled',
      locked: false,
      provenance: 'manual',
      roiType: null,
      roiNumber: null,
      interpolationState: null,
      segmentIndex: segIdx,
      segmentDescription: null,
      segmentedPropertyCategory: null,
      segmentedPropertyType: null,
      poiPoints: null,
      algebra: null,
      algebraSources: null,
      algebraOutOfDate: false,
      algebraManualOverride: false,
      csAnnotationUIDs: null,
      csSegmentationId: csSegId,
      createdAt: 0,
      modifiedAt: 0,
    });
    return containerId;
  }

  // ─── createMember ────────────────────────────────────────────────────

  describe('createMember', () => {
    it('calls addSegment on the container’s cs segmentation', async () => {
      const containerId = containerBridge.register('seg_1');
      await containerService.createMember({
        containerId,
        name: 'Tumor',
        color: [255, 0, 0],
      });
      expect(addSegmentMock).toHaveBeenCalledWith('seg_1', 'Tumor', [255, 0, 0, 255]);
    });

    it('returns the new segmentIndex from addSegment', async () => {
      const containerId = containerBridge.register('seg_1');
      addSegmentMock.mockResolvedValueOnce(7);
      const segIdx = await containerService.createMember({
        containerId,
        name: 'X',
        color: [0, 0, 0],
      });
      expect(segIdx).toBe(7);
    });

    it('marks the container dirty', async () => {
      const containerId = containerBridge.register('seg_1');
      containerBridge.setDirty(containerId, false);
      await containerService.createMember({
        containerId,
        name: 'X',
        color: [0, 0, 0],
      });
      expect(containerBridge.getContainer(containerId)?.dirty).toBe(true);
    });

    it('trims the name and falls back to "New segment" on empty', async () => {
      const containerId = containerBridge.register('seg_1');
      await containerService.createMember({
        containerId,
        name: '   ',
        color: [0, 0, 0],
      });
      expect(addSegmentMock).toHaveBeenCalledWith('seg_1', 'New segment', [0, 0, 0, 255]);
    });

    it('throws on empty containerId', async () => {
      await expect(
        containerService.createMember({
          containerId: '',
          name: 'X',
          color: [0, 0, 0],
        }),
      ).rejects.toThrow(/containerId/);
    });

    it('throws on unknown containerId', async () => {
      await expect(
        containerService.createMember({
          containerId: 'unknown',
          name: 'X',
          color: [0, 0, 0],
        }),
      ).rejects.toThrow(/unknown/);
    });
  });

  // ─── deleteMember ────────────────────────────────────────────────────

  describe('deleteMember', () => {
    it('calls removeSegment on the underlying cs segmentation', () => {
      injectMember('seg_1', 'm1', 3);
      containerService.deleteMember('m1');
      expect(removeSegmentMock).toHaveBeenCalledWith('seg_1', 3);
    });

    it('marks the container dirty', () => {
      const containerId = injectMember('seg_1', 'm1');
      containerBridge.setDirty(containerId, false);
      containerService.deleteMember('m1');
      expect(containerBridge.getContainer(containerId)?.dirty).toBe(true);
    });

    it('idempotent on unknown memberId (no-op, no throw)', () => {
      expect(() => containerService.deleteMember('unknown')).not.toThrow();
      expect(removeSegmentMock).not.toHaveBeenCalled();
    });

    it('skips when member has no segmentIndex (graceful no-op)', () => {
      const containerId = containerBridge.register('seg_1');
      containerBridge.getContainer(containerId)!.members.push({
        id: 'broken',
        name: 'X',
        color: [0, 0, 0],
        visibility: 'filled',
        locked: false,
        provenance: 'manual',
        roiType: null,
        roiNumber: null,
        interpolationState: null,
        segmentIndex: null,
        segmentDescription: null,
        segmentedPropertyCategory: null,
        segmentedPropertyType: null,
        poiPoints: null,
        algebra: null,
        algebraSources: null,
        algebraOutOfDate: false,
        algebraManualOverride: false,
        csAnnotationUIDs: null,
        csSegmentationId: 'seg_1',
        createdAt: 0,
        modifiedAt: 0,
      });
      containerService.deleteMember('broken');
      expect(removeSegmentMock).not.toHaveBeenCalled();
    });
  });

  // ─── renameMember ────────────────────────────────────────────────────

  describe('renameMember', () => {
    it('calls renameSegment with trimmed name', () => {
      injectMember('seg_1', 'm1', 3);
      containerService.renameMember('m1', '  Renamed  ');
      expect(renameSegmentMock).toHaveBeenCalledWith('seg_1', 3, 'Renamed');
    });

    it('marks the container dirty', () => {
      const containerId = injectMember('seg_1', 'm1');
      containerBridge.setDirty(containerId, false);
      containerService.renameMember('m1', 'Renamed');
      expect(containerBridge.getContainer(containerId)?.dirty).toBe(true);
    });

    it('idempotent on no-op rename', () => {
      injectMember('seg_1', 'm1');
      containerBridge.getContainer(containerBridge.getContainerId('seg_1')!)!.members[0].name = 'Same';
      containerService.renameMember('m1', 'Same');
      expect(renameSegmentMock).not.toHaveBeenCalled();
    });

    it('throws on empty name', () => {
      injectMember('seg_1', 'm1');
      expect(() => containerService.renameMember('m1', '   ')).toThrow(/empty/);
    });

    it('throws on unknown memberId', () => {
      expect(() => containerService.renameMember('unknown', 'X')).toThrow(/unknown/);
    });
  });

  // ─── recolorMember ───────────────────────────────────────────────────

  describe('recolorMember', () => {
    it('calls setSegmentColor with RGBA (alpha=255)', () => {
      injectMember('seg_1', 'm1', 2);
      containerService.recolorMember('m1', [10, 20, 30]);
      expect(setSegmentColorMock).toHaveBeenCalledWith('seg_1', 2, [10, 20, 30, 255]);
    });

    it('marks the container dirty', () => {
      const containerId = injectMember('seg_1', 'm1');
      containerBridge.setDirty(containerId, false);
      containerService.recolorMember('m1', [1, 2, 3]);
      expect(containerBridge.getContainer(containerId)?.dirty).toBe(true);
    });

    it('throws on unknown memberId', () => {
      expect(() => containerService.recolorMember('unknown', [0, 0, 0])).toThrow(/unknown/);
    });
  });

  // ─── reorderMember (issue #79, spec §4.5 drag-handle reorder) ─────────

  describe('reorderMember', () => {
    function injectThree(): string {
      const containerId = containerBridge.register('seg_three');
      const c = containerBridge.getContainer(containerId)!;
      c.members.push(
        { ...c.members[0], id: 'm1', name: 'A', segmentIndex: 1, csSegmentationId: 'seg_three' } as Member,
        { ...c.members[0], id: 'm2', name: 'B', segmentIndex: 2, csSegmentationId: 'seg_three' } as Member,
        { ...c.members[0], id: 'm3', name: 'C', segmentIndex: 3, csSegmentationId: 'seg_three' } as Member,
      );
      return containerId;
    }

    beforeEach(() => {
      // Drop anything injected by an earlier injectMember call so the
      // three-member container can construct its members[] from scratch.
      containerBridge.clearAll();
    });

    it('moves a member forward in the list', () => {
      // Need 3 valid members up front; reuse injectMember for the seed then
      // append two more. The describe-level injectMember pushes onto the
      // same container, giving us three members on `seg_three`.
      injectMember('seg_three', 'm1');
      const c = containerBridge.getContainer(containerBridge.register('seg_three'))!;
      c.members.push(
        { ...c.members[0], id: 'm2', name: 'B', segmentIndex: 2 } as Member,
        { ...c.members[0], id: 'm3', name: 'C', segmentIndex: 3 } as Member,
      );

      containerService.reorderMember('m1', 2);

      const reordered = containerBridge.getContainer(c.id)!.members.map((m) => m.id);
      expect(reordered).toEqual(['m2', 'm3', 'm1']);
    });

    it('moves a member backward in the list', () => {
      injectMember('seg_three', 'm1');
      const c = containerBridge.getContainer(containerBridge.register('seg_three'))!;
      c.members.push(
        { ...c.members[0], id: 'm2', name: 'B', segmentIndex: 2 } as Member,
        { ...c.members[0], id: 'm3', name: 'C', segmentIndex: 3 } as Member,
      );

      containerService.reorderMember('m3', 0);

      const reordered = containerBridge.getContainer(c.id)!.members.map((m) => m.id);
      expect(reordered).toEqual(['m3', 'm1', 'm2']);
    });

    it('clamps toIndex to a valid range', () => {
      injectMember('seg_clamp', 'm1');
      const c = containerBridge.getContainer(containerBridge.register('seg_clamp'))!;
      c.members.push(
        { ...c.members[0], id: 'm2', name: 'B', segmentIndex: 2 } as Member,
      );

      // toIndex = 99 → clamps to length-1 (= 1).
      containerService.reorderMember('m1', 99);
      expect(containerBridge.getContainer(c.id)!.members.map((m) => m.id)).toEqual(['m2', 'm1']);

      // toIndex = -5 → clamps to 0.
      containerService.reorderMember('m1', -5);
      expect(containerBridge.getContainer(c.id)!.members.map((m) => m.id)).toEqual(['m1', 'm2']);
    });

    it('is a no-op when toIndex equals current index', () => {
      injectMember('seg_noop', 'm1');
      const containerId = containerBridge.register('seg_noop');
      containerBridge.setDirty(containerId, false);

      containerService.reorderMember('m1', 0);

      expect(containerBridge.getContainer(containerId)?.dirty).toBe(false);
    });

    it('marks the container dirty after a real reorder', () => {
      injectMember('seg_dirty', 'm1');
      const c = containerBridge.getContainer(containerBridge.register('seg_dirty'))!;
      c.members.push({ ...c.members[0], id: 'm2', name: 'B', segmentIndex: 2 } as Member);
      containerBridge.setDirty(c.id, false);

      containerService.reorderMember('m1', 1);

      expect(containerBridge.getContainer(c.id)?.dirty).toBe(true);
    });

    it('refuses to reorder when the container is approved (§D7.11)', () => {
      injectMember('seg_approved', 'm1');
      const c = containerBridge.getContainer(containerBridge.register('seg_approved'))!;
      c.members.push({ ...c.members[0], id: 'm2', name: 'B', segmentIndex: 2 } as Member);
      c.approval.approved = true;

      expect(() => containerService.reorderMember('m1', 1)).toThrow(/approved/);
    });

    it('throws on unknown memberId', () => {
      expect(() => containerService.reorderMember('unknown', 0)).toThrow(/unknown/);
    });
  });
});

// ─── Phase 3.7b: setA2cOptedIn ──────────────────────────────────────────

describe('setA2cOptedIn', () => {
  it('flips the container’s a2cOptedIn flag', () => {
    const id = containerBridge.register('seg_1');
    expect(containerBridge.getContainer(id)?.a2cOptedIn).toBe(false);
    containerService.setA2cOptedIn(id, true);
    expect(containerBridge.getContainer(id)?.a2cOptedIn).toBe(true);
    containerService.setA2cOptedIn(id, false);
    expect(containerBridge.getContainer(id)?.a2cOptedIn).toBe(false);
  });

  it('does NOT mark the container dirty (presentation state per §D7.10)', () => {
    const id = containerBridge.register('seg_1');
    containerBridge.setDirty(id, false);
    containerService.setA2cOptedIn(id, true);
    expect(containerBridge.getContainer(id)?.dirty).toBe(false);
  });

  it('idempotent on no-op', () => {
    const id = containerBridge.register('seg_1');
    containerService.setA2cOptedIn(id, true);
    let notifyCount = 0;
    const unsub = containerBridge.subscribe(() => {
      notifyCount++;
    });
    containerService.setA2cOptedIn(id, true); // no-op
    unsub();
    expect(notifyCount).toBe(0);
  });

  it('throws on unknown containerId', () => {
    expect(() => containerService.setA2cOptedIn('unknown', true)).toThrow(/unknown/);
  });

  it('skips empty containerId', () => {
    expect(() => containerService.setA2cOptedIn('', true)).not.toThrow();
  });
});

// ─── Phase 3.8b: setRoiType ─────────────────────────────────────────────

describe('setRoiType', () => {
  function injectRtstructMember(
    csSegId: string,
    memberId: string,
    initial: import('../../types/annotation').RTROIInterpretedType | null = null,
  ): string {
    const containerId = containerBridge.register(csSegId, { kind: 'RTSTRUCT' });
    containerBridge.getContainer(containerId)!.members.push({
      id: memberId,
      name: 'M',
      color: [255, 0, 0],
      visibility: 'outlined',
      locked: false,
      provenance: 'manual',
      roiType: initial,
      roiNumber: 1,
      interpolationState: null,
      segmentIndex: 1,
      segmentDescription: null,
      segmentedPropertyCategory: null,
      segmentedPropertyType: null,
      poiPoints: null,
      algebra: null,
      algebraSources: null,
      algebraOutOfDate: false,
      algebraManualOverride: false,
      csAnnotationUIDs: null,
      csSegmentationId: csSegId,
      createdAt: 0,
      modifiedAt: 0,
    });
    return containerId;
  }

  it('updates roiType on RTSTRUCT member', () => {
    const id = injectRtstructMember('rtstruct_1', 'm1');
    containerService.setRoiType('m1', 'GTV');
    expect(containerBridge.getContainer(id)!.members[0].roiType).toBe('GTV');
  });

  it('marks the container dirty (RTROIInterpretedType round-trips per signal 18)', () => {
    const id = injectRtstructMember('rtstruct_1', 'm1');
    containerBridge.setDirty(id, false);
    containerService.setRoiType('m1', 'PTV');
    expect(containerBridge.getContainer(id)?.dirty).toBe(true);
  });

  it('idempotent on no-op (same type)', () => {
    const id = injectRtstructMember('rtstruct_1', 'm1', 'GTV');
    containerBridge.setDirty(id, false);
    containerService.setRoiType('m1', 'GTV');
    expect(containerBridge.getContainer(id)?.dirty).toBe(false);
  });

  it('no-op for non-RTSTRUCT containers (kind=SEG)', () => {
    const containerId = containerBridge.register('seg_1', { kind: 'SEG' });
    containerBridge.getContainer(containerId)!.members.push({
      id: 'm-seg',
      name: 'X',
      color: [0, 0, 0],
      visibility: 'filled',
      locked: false,
      provenance: 'manual',
      roiType: null,
      roiNumber: null,
      interpolationState: null,
      segmentIndex: 1,
      segmentDescription: null,
      segmentedPropertyCategory: null,
      segmentedPropertyType: null,
      poiPoints: null,
      algebra: null,
      algebraSources: null,
      algebraOutOfDate: false,
      algebraManualOverride: false,
      csAnnotationUIDs: null,
      csSegmentationId: 'seg_1',
      createdAt: 0,
      modifiedAt: 0,
    });
    containerService.setRoiType('m-seg', 'GTV');
    expect(containerBridge.getContainer(containerId)?.members[0].roiType).toBeNull();
  });

  it('throws on unknown memberId', () => {
    expect(() => containerService.setRoiType('unknown', 'GTV')).toThrow(/unknown/);
  });
});

// ─── Phase 3.4: setMemberVisibility ────────────────────────────────────

describe('setMemberVisibility', () => {
  function injectMember(
    csSegId: string,
    memberId: string,
    visibility: import('../../types/annotation').VisibilityMode = 'filled',
  ): { containerId: string; csSegmentationId: string } {
    const containerId = containerBridge.register(csSegId);
    const container = containerBridge.getContainer(containerId)!;
    container.members.push({
      id: memberId,
      name: 'M',
      color: [255, 0, 0],
      visibility,
      locked: false,
      provenance: 'manual',
      roiType: null,
      roiNumber: null,
      interpolationState: null,
      segmentIndex: 1,
      segmentDescription: null,
      segmentedPropertyCategory: null,
      segmentedPropertyType: null,
      poiPoints: null,
      algebra: null,
      algebraSources: null,
      algebraOutOfDate: false,
      algebraManualOverride: false,
      csAnnotationUIDs: null,
      csSegmentationId: csSegId,
      createdAt: 0,
      modifiedAt: 0,
    });
    return { containerId, csSegmentationId: csSegId };
  }

  it('mutates the member’s visibility field on the bridge', () => {
    const { containerId } = injectMember('seg_1', 'm1', 'filled');
    containerService.setMemberVisibility('m1', 'outlined');
    const c = containerBridge.getContainer(containerId)!;
    expect(c.members[0].visibility).toBe('outlined');
  });

  it('updates modifiedAt on the member', () => {
    injectMember('seg_1', 'm1', 'filled');
    const before = containerBridge.getContainer(containerBridge.getContainerId('seg_1')!)!.members[0].modifiedAt;
    containerService.setMemberVisibility('m1', 'hidden');
    const after = containerBridge.getContainer(containerBridge.getContainerId('seg_1')!)!.members[0].modifiedAt;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('does NOT mark the container dirty (visibility is session-only per §D7.10)', () => {
    const { containerId } = injectMember('seg_1', 'm1', 'filled');
    containerBridge.setDirty(containerId, false);
    containerService.setMemberVisibility('m1', 'hidden');
    expect(containerBridge.getContainer(containerId)?.dirty).toBe(false);
  });

  it('idempotent on no-op (same mode)', () => {
    injectMember('seg_1', 'm1', 'outlined');
    const before = containerBridge.getContainer(containerBridge.getContainerId('seg_1')!)!.members[0].modifiedAt;
    containerService.setMemberVisibility('m1', 'outlined');
    const after = containerBridge.getContainer(containerBridge.getContainerId('seg_1')!)!.members[0].modifiedAt;
    expect(after).toBe(before); // no mutation
  });

  it('throws on unknown memberId', () => {
    expect(() => containerService.setMemberVisibility('unknown', 'hidden')).toThrow(/unknown/);
  });

  it('skips empty memberId without throwing', () => {
    expect(() => containerService.setMemberVisibility('', 'hidden')).not.toThrow();
  });
});

// ─── setMemberLock (C5) ─────────────────────────────────────────────────

describe('setMemberLock', () => {
  function injectMember(
    csSegId: string,
    memberId: string,
    locked = false,
  ): string {
    const containerId = containerBridge.register(csSegId);
    const container = containerBridge.getContainer(containerId)!;
    container.members.push({
      id: memberId,
      name: 'M',
      color: [255, 0, 0],
      visibility: 'filled',
      locked,
      provenance: 'manual',
      roiType: null,
      roiNumber: null,
      interpolationState: null,
      segmentIndex: 1,
      segmentDescription: null,
      segmentedPropertyCategory: null,
      segmentedPropertyType: null,
      poiPoints: null,
      algebra: null,
      algebraSources: null,
      algebraOutOfDate: false,
      algebraManualOverride: false,
      csAnnotationUIDs: null,
      csSegmentationId: csSegId,
      createdAt: 0,
      modifiedAt: 0,
    });
    return containerId;
  }

  const setSegmentLockedMock = vi.fn();
  beforeEach(() => {
    setSegmentLockedMock.mockReset();
    wireContainerService({ setSegmentLocked: setSegmentLockedMock });
  });
  afterEach(() => {
    resetContainerServiceWiring();
  });

  it('mutates the member’s locked field on the bridge', () => {
    const containerId = injectMember('seg_1', 'm1', false);
    containerService.setMemberLock('m1', true);
    expect(containerBridge.getContainer(containerId)!.members[0].locked).toBe(true);
  });

  it('mirrors to Cornerstone via setSegmentLocked dep', () => {
    injectMember('seg_1', 'm1', false);
    containerService.setMemberLock('m1', true);
    expect(setSegmentLockedMock).toHaveBeenCalledWith('seg_1', 1, true);
  });

  it('does NOT mark the container dirty (lock is session-only per §D7.10)', () => {
    const containerId = injectMember('seg_1', 'm1', false);
    containerBridge.setDirty(containerId, false);
    containerService.setMemberLock('m1', true);
    expect(containerBridge.getContainer(containerId)?.dirty).toBe(false);
  });

  it('idempotent on no-op (same value)', () => {
    injectMember('seg_1', 'm1', true);
    containerService.setMemberLock('m1', true);
    expect(setSegmentLockedMock).not.toHaveBeenCalled();
  });

  it('refuses on approved containers (§D7.11 supersedes per-member lock)', () => {
    const containerId = injectMember('seg_1', 'm1', false);
    const container = containerBridge.getContainer(containerId)!;
    container.approval = { ...container.approval, approved: true };
    expect(() => containerService.setMemberLock('m1', true)).toThrow(/approved/);
  });

  it('throws on unknown memberId', () => {
    expect(() => containerService.setMemberLock('unknown', true)).toThrow(/unknown/);
  });

  it('skips empty memberId without throwing', () => {
    expect(() => containerService.setMemberLock('', true)).not.toThrow();
  });
});

// ─── Phase 4.1: setMemberProvenance / setMemberInterpolationState ──────

describe('setMemberProvenance', () => {
  function injectMember(
    csSegId: string,
    memberId: string,
    provenance: import('../../types/annotation').Provenance = 'manual',
  ): string {
    const containerId = containerBridge.register(csSegId);
    const container = containerBridge.getContainer(containerId)!;
    container.members.push({
      id: memberId,
      name: 'M',
      color: [255, 0, 0],
      visibility: 'outlined',
      locked: false,
      provenance,
      roiType: null,
      roiNumber: null,
      interpolationState: null,
      segmentIndex: 1,
      segmentDescription: null,
      segmentedPropertyCategory: null,
      segmentedPropertyType: null,
      poiPoints: null,
      algebra: null,
      algebraSources: null,
      algebraOutOfDate: false,
      algebraManualOverride: false,
      csAnnotationUIDs: null,
      csSegmentationId: csSegId,
      createdAt: 0,
      modifiedAt: 0,
    });
    return containerId;
  }

  it('mutates the member’s provenance field', () => {
    const containerId = injectMember('seg_1', 'm1', 'manual');
    containerService.setMemberProvenance('m1', 'interpolated');
    expect(containerBridge.getContainer(containerId)!.members[0].provenance).toBe('interpolated');
  });

  it('updates modifiedAt on the member', () => {
    const containerId = injectMember('seg_1', 'm1', 'manual');
    const before = containerBridge.getContainer(containerId)!.members[0].modifiedAt;
    containerService.setMemberProvenance('m1', 'interpolated');
    const after = containerBridge.getContainer(containerId)!.members[0].modifiedAt;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('does NOT mark the container dirty (session-only per §D7.10)', () => {
    const containerId = injectMember('seg_1', 'm1', 'manual');
    containerBridge.setDirty(containerId, false);
    containerService.setMemberProvenance('m1', 'interpolated');
    expect(containerBridge.getContainer(containerId)!.dirty).toBe(false);
  });

  it('idempotent on no-op (same value)', () => {
    const containerId = injectMember('seg_1', 'm1', 'interpolated');
    const before = containerBridge.getContainer(containerId)!.members[0].modifiedAt;
    containerService.setMemberProvenance('m1', 'interpolated');
    const after = containerBridge.getContainer(containerId)!.members[0].modifiedAt;
    expect(after).toBe(before);
  });

  it('does NOT enforce the §D7.11 approval edit-lock', () => {
    // Phase 4.4 needs to flip provenance from 'interpolated' back to
    // 'manual' on a manual edit; that flip can land regardless of approval
    // state because the underlying geometry edit (which is the actual
    // mutation) is already locked at its own assertNotApproved site.
    const containerId = injectMember('seg_1', 'm1', 'interpolated');
    const container = containerBridge.getContainer(containerId)!;
    container.approval = { ...container.approval, approved: true };
    expect(() => containerService.setMemberProvenance('m1', 'manual')).not.toThrow();
    expect(containerBridge.getContainer(containerId)!.members[0].provenance).toBe('manual');
  });

  it('silently no-ops on unknown memberId', () => {
    // The setter is fire-and-forget metadata; throwing on unknown ids
    // would force callers (the event handler in provenance.ts) to wrap
    // every call in a try/catch. Silent no-op is the right contract.
    expect(() => containerService.setMemberProvenance('unknown', 'interpolated')).not.toThrow();
  });

  it('no-op on empty memberId', () => {
    expect(() => containerService.setMemberProvenance('', 'interpolated')).not.toThrow();
  });
});

describe('setMemberInterpolationState', () => {
  function injectMember(
    csSegId: string,
    memberId: string,
    state: import('../../types/annotation').Member['interpolationState'] = null,
  ): string {
    const containerId = containerBridge.register(csSegId);
    const container = containerBridge.getContainer(containerId)!;
    container.members.push({
      id: memberId,
      name: 'M',
      color: [255, 0, 0],
      visibility: 'outlined',
      locked: false,
      provenance: 'manual',
      roiType: null,
      roiNumber: null,
      interpolationState: state,
      segmentIndex: 1,
      segmentDescription: null,
      segmentedPropertyCategory: null,
      segmentedPropertyType: null,
      poiPoints: null,
      algebra: null,
      algebraSources: null,
      algebraOutOfDate: false,
      algebraManualOverride: false,
      csAnnotationUIDs: null,
      csSegmentationId: csSegId,
      createdAt: 0,
      modifiedAt: 0,
    });
    return containerId;
  }

  it('mutates the member’s interpolationState field', () => {
    const containerId = injectMember('seg_1', 'm1', null);
    containerService.setMemberInterpolationState('m1', 'has-interpolated');
    expect(containerBridge.getContainer(containerId)!.members[0].interpolationState).toBe('has-interpolated');
  });

  it('does NOT mark the container dirty (session-only per §D7.10)', () => {
    const containerId = injectMember('seg_1', 'm1', null);
    containerBridge.setDirty(containerId, false);
    containerService.setMemberInterpolationState('m1', 'has-interpolated');
    expect(containerBridge.getContainer(containerId)!.dirty).toBe(false);
  });

  it('clears back to none', () => {
    const containerId = injectMember('seg_1', 'm1', 'has-interpolated');
    containerService.setMemberInterpolationState('m1', 'none');
    expect(containerBridge.getContainer(containerId)!.members[0].interpolationState).toBe('none');
  });

  it('idempotent on no-op', () => {
    const containerId = injectMember('seg_1', 'm1', 'has-interpolated');
    const before = containerBridge.getContainer(containerId)!.members[0].modifiedAt;
    containerService.setMemberInterpolationState('m1', 'has-interpolated');
    const after = containerBridge.getContainer(containerId)!.members[0].modifiedAt;
    expect(after).toBe(before);
  });

  it('silently no-ops on unknown memberId', () => {
    expect(() => containerService.setMemberInterpolationState('unknown', 'has-interpolated')).not.toThrow();
  });
});

// ─── Phase 4.5: clearContainerInterpolationStates ──────────────────────

describe('clearContainerInterpolationStates', () => {
  function injectContainerWithMembers(
    csSegId: string,
    states: Array<import('../../types/annotation').Member['interpolationState']>,
  ): string {
    const containerId = containerBridge.register(csSegId);
    const container = containerBridge.getContainer(containerId)!;
    states.forEach((state, i) => {
      container.members.push({
        id: `m${i + 1}`,
        name: `M${i + 1}`,
        color: [255, 0, 0],
        visibility: 'outlined',
        locked: false,
        provenance: state === 'has-interpolated' ? 'interpolated' : 'manual',
        roiType: null,
        roiNumber: null,
        interpolationState: state,
        segmentIndex: i + 1,
        segmentDescription: null,
        segmentedPropertyCategory: null,
        segmentedPropertyType: null,
        poiPoints: null,
        algebra: null,
        algebraSources: null,
        algebraOutOfDate: false,
        algebraManualOverride: false,
        csAnnotationUIDs: null,
        csSegmentationId: csSegId,
        createdAt: 0,
        modifiedAt: 0,
      });
    });
    return containerId;
  }

  it('clears interpolationState on every member that was has-interpolated', () => {
    const id = injectContainerWithMembers('seg_1', [
      'has-interpolated',
      'has-interpolated',
      null,
    ]);
    containerService.clearContainerInterpolationStates(id);
    const members = containerBridge.getContainer(id)!.members;
    expect(members.map((m) => m.interpolationState)).toEqual(['none', 'none', null]);
  });

  it('preserves provenance — only the marker fades on save (per §B5)', () => {
    const id = injectContainerWithMembers('seg_1', ['has-interpolated']);
    containerService.clearContainerInterpolationStates(id);
    expect(containerBridge.getContainer(id)!.members[0].provenance).toBe('interpolated');
  });

  it('does NOT mark the container dirty', () => {
    const id = injectContainerWithMembers('seg_1', ['has-interpolated']);
    containerBridge.setDirty(id, false);
    containerService.clearContainerInterpolationStates(id);
    expect(containerBridge.getContainer(id)!.dirty).toBe(false);
  });

  it('idempotent — no-op when no members are has-interpolated', () => {
    const id = injectContainerWithMembers('seg_1', [null, 'none']);
    const beforeMods = containerBridge.getContainer(id)!.members.map((m) => m.modifiedAt);
    containerService.clearContainerInterpolationStates(id);
    const afterMods = containerBridge.getContainer(id)!.members.map((m) => m.modifiedAt);
    expect(afterMods).toEqual(beforeMods);
  });

  it('no-op on unknown containerId', () => {
    expect(() => containerService.clearContainerInterpolationStates('nope')).not.toThrow();
  });

  it('no-op on empty containerId', () => {
    expect(() => containerService.clearContainerInterpolationStates('')).not.toThrow();
  });
});
