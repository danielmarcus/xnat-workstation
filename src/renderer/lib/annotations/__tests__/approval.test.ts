import { describe, it, expect } from 'vitest';
import {
  buildApprovalModule,
  parseApprovalModule,
  formatReviewerName,
  UNAPPROVED_RECORD,
} from '../approval';

// 2026-03-04T15:06:07Z local-independent construction: the module formats in LOCAL
// time (DICOM DA/TM carry no timezone), so build the expectation from the same Date.
const AT = new Date(2026, 2, 4, 15, 6, 7).getTime();

describe('buildApprovalModule', () => {
  it('writes UNAPPROVED with no review attributes when not approved', () => {
    expect(buildApprovalModule(UNAPPROVED_RECORD)).toEqual({ ApprovalStatus: 'UNAPPROVED' });
  });

  it('writes APPROVED with reviewer + DICOM DA/TM review stamps', () => {
    expect(
      buildApprovalModule({ approved: true, reviewerName: 'Marcus^Daniel', reviewedAt: AT }),
    ).toEqual({
      ApprovalStatus: 'APPROVED',
      ReviewerName: 'Marcus^Daniel',
      ReviewDate: '20260304',
      ReviewTime: '150607',
    });
  });

  it('omits the reviewer when identity is unknown, but still stamps the time', () => {
    const mod = buildApprovalModule({ approved: true, reviewerName: null, reviewedAt: AT });
    expect(mod.ApprovalStatus).toBe('APPROVED');
    expect(mod.ReviewerName).toBeUndefined();
    expect(mod.ReviewDate).toBe('20260304');
  });

  it('omits the review stamps when approved without a timestamp', () => {
    expect(buildApprovalModule({ approved: true, reviewerName: null, reviewedAt: null })).toEqual({
      ApprovalStatus: 'APPROVED',
    });
  });
});

describe('parseApprovalModule', () => {
  it('round-trips an approved record', () => {
    const record = { approved: true, reviewerName: 'Marcus^Daniel', reviewedAt: AT };
    const parsed = parseApprovalModule(buildApprovalModule(record));
    expect(parsed.approved).toBe(true);
    expect(parsed.reviewerName).toBe('Marcus^Daniel');
    // Second-resolution round-trip (DICOM TM has no milliseconds).
    expect(parsed.reviewedAt).toBe(Math.floor(AT / 1000) * 1000);
  });

  it('treats a missing ApprovalStatus as unapproved (the DICOM default)', () => {
    expect(parseApprovalModule({})).toEqual(UNAPPROVED_RECORD);
    expect(parseApprovalModule(undefined)).toEqual(UNAPPROVED_RECORD);
  });

  it('treats REJECTED as not approved (the app never writes it, but files carry it)', () => {
    expect(parseApprovalModule({ ApprovalStatus: 'REJECTED' }).approved).toBe(false);
  });

  it('is case-insensitive and tolerates padded values from other writers', () => {
    expect(parseApprovalModule({ ApprovalStatus: ' approved ' }).approved).toBe(true);
  });

  it('survives a malformed review date/time rather than producing an invalid timestamp', () => {
    const parsed = parseApprovalModule({ ApprovalStatus: 'APPROVED', ReviewDate: 'not-a-date', ReviewTime: '??' });
    expect(parsed.approved).toBe(true);
    expect(parsed.reviewedAt).toBeNull();
  });

  it('reads dcmjs array-valued elements (naturalized datasets wrap some values)', () => {
    expect(parseApprovalModule({ ApprovalStatus: ['APPROVED'] }).approved).toBe(true);
  });
});

describe('formatReviewerName', () => {
  it('builds a DICOM person name from the XNAT identity', () => {
    expect(formatReviewerName({ username: 'dmarcus', lastName: 'Marcus', firstName: 'Daniel' })).toBe(
      'Marcus^Daniel',
    );
  });

  it('falls back to the username when no real name is known', () => {
    expect(formatReviewerName({ username: 'dmarcus' })).toBe('dmarcus');
  });

  it('is null with no identity at all (offline / local files)', () => {
    expect(formatReviewerName(undefined)).toBeNull();
    expect(formatReviewerName({ username: '' })).toBeNull();
  });
});
