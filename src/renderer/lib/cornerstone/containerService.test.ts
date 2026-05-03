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

import { containerService } from './containerService';
import * as containerBridge from './containerBridge';
import { useSegmentationStore } from '../../stores/segmentationStore';
import type { Member } from '../../types/annotation';

beforeEach(() => {
  containerBridge.clearAll();
  useSegmentationStore.setState({
    activeSegmentationId: null,
    activeSegmentIndex: 0,
  });
});

afterEach(() => {
  containerBridge.clearAll();
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

  it('createMember throws with phase pointer', () => {
    expect(() =>
      containerService.createMember({
        containerId: 'c',
        name: 'M',
        color: [0, 0, 0],
      }),
    ).toThrow(/Phase 3\.2/);
  });

  it('setActiveMember throws with phase pointer', () => {
    expect(() => containerService.setActiveMember('m')).toThrow(/Phase 3\.2/);
  });

  it('setRoiType throws with phase pointer', () => {
    expect(() => containerService.setRoiType('m', 'GTV')).toThrow(/Phase 3\.8/);
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
