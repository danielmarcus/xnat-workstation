import { describe, it, expect, beforeEach } from 'vitest';
import { useApprovalStore } from '../approvalStore';

const reset = () => useApprovalStore.getState().reset();

describe('useApprovalStore', () => {
  beforeEach(reset);

  it('reads absent containers as unapproved', () => {
    expect(useApprovalStore.getState().isApproved('seg-1')).toBe(false);
    expect(useApprovalStore.getState().approvalOf('seg-1')).toEqual({
      approved: false,
      reviewerName: null,
      reviewedAt: null,
    });
  });

  it('approves with reviewer + timestamp and records the audit entry', () => {
    useApprovalStore.getState().setApproval('seg-1', true, 'Marcus^Daniel', 1000);
    expect(useApprovalStore.getState().isApproved('seg-1')).toBe(true);
    expect(useApprovalStore.getState().approvalOf('seg-1')).toEqual({
      approved: true,
      reviewerName: 'Marcus^Daniel',
      reviewedAt: 1000,
    });
    expect(useApprovalStore.getState().history['seg-1']).toEqual([
      { action: 'approve', by: 'Marcus^Daniel', at: 1000 },
    ]);
  });

  it('revoking clears the record but KEEPS the audit trail, and re-approval appends', () => {
    const s = () => useApprovalStore.getState();
    s().setApproval('seg-1', true, 'a', 1000);
    s().setApproval('seg-1', false, 'b', 2000);
    expect(s().isApproved('seg-1')).toBe(false);
    s().setApproval('seg-1', true, 'c', 3000);
    expect(s().isApproved('seg-1')).toBe(true);
    expect(s().history['seg-1'].map((e) => e.action)).toEqual(['approve', 'revoke', 'approve']);
  });

  it('seeding from a loaded file sets state WITHOUT an audit entry (not a user action)', () => {
    useApprovalStore.getState().seedApproval('seg-2', {
      approved: true,
      reviewerName: 'Other^Reviewer',
      reviewedAt: 500,
    });
    expect(useApprovalStore.getState().isApproved('seg-2')).toBe(true);
    expect(useApprovalStore.getState().history['seg-2']).toBeUndefined();
  });

  it('removing a container drops both its record and its history', () => {
    const s = () => useApprovalStore.getState();
    s().setApproval('seg-1', true, 'a', 1000);
    s().remove('seg-1');
    expect(s().approvals['seg-1']).toBeUndefined();
    expect(s().history['seg-1']).toBeUndefined();
    expect(s().isApproved('seg-1')).toBe(false);
  });

  it('keeps containers independent', () => {
    const s = () => useApprovalStore.getState();
    s().setApproval('seg-1', true, 'a', 1000);
    expect(s().isApproved('sr:measurements')).toBe(false);
    s().setApproval('sr:measurements', true, 'a', 1000);
    s().setApproval('seg-1', false, 'a', 1100);
    expect(s().isApproved('sr:measurements')).toBe(true);
  });
});
