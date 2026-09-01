/**
 * approval — container-level approval state (requirements D7.11, design §2.6) and
 * its DICOM mapping.
 *
 * An approved container is a regulatory-grade edit lock: no geometry edits, member
 * adds/deletes, renames or colour changes until the user explicitly revokes. The
 * state must survive save/load, so it is persisted in the DICOM object via the RT
 * Approval attributes — `ApprovalStatus (300E,0002)` plus `ReviewerName (300E,0008)`
 * / `ReviewDate (300E,0004)` / `ReviewTime (300E,0005)` for the audit trail. All
 * three container kinds (SEG / RTSTRUCT / SR) carry these at the top level of the
 * dataset, so one module serves every export path.
 *
 * Pure: no store, no Cornerstone, no clock reads (callers pass the timestamp).
 */
import type { XnatConnectionInfo } from '@shared/types/xnat';
import type { ApprovalRecord } from '@shared/types/annotation';

export type { ApprovalRecord, ApprovalEvent } from '@shared/types/annotation';

export const UNAPPROVED_RECORD: ApprovalRecord = {
  approved: false,
  reviewerName: null,
  reviewedAt: null,
};

/** The DICOM approval attributes written into a derived dataset. */
export interface ApprovalModule {
  ApprovalStatus: 'APPROVED' | 'UNAPPROVED';
  ReviewerName?: string;
  ReviewDate?: string;
  ReviewTime?: string;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** DICOM DA (0008,0020-style): YYYYMMDD, local time — DA/TM carry no timezone. */
function toDicomDate(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** DICOM TM: HHMMSS (second resolution — the fractional part is not needed here). */
function toDicomTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Parse DICOM DA + TM back to epoch ms; null if either is malformed/absent. */
function fromDicomDateTime(date: unknown, time: unknown): number | null {
  const da = typeof date === 'string' ? date.trim() : '';
  const tm = typeof time === 'string' ? time.trim() : '';
  if (!/^\d{8}$/.test(da)) return null;
  const year = Number(da.slice(0, 4));
  const month = Number(da.slice(4, 6));
  const day = Number(da.slice(6, 8));
  // TM is optional; a malformed one degrades to midnight rather than losing the date.
  const hh = /^\d{2}/.test(tm) ? Number(tm.slice(0, 2)) : 0;
  const mm = /^\d{4}/.test(tm) ? Number(tm.slice(2, 4)) : 0;
  const ss = /^\d{6}/.test(tm) ? Number(tm.slice(4, 6)) : 0;
  const ms = new Date(year, month - 1, day, hh, mm, ss).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** dcmjs naturalized datasets wrap some values in arrays — take the first. */
function scalar(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/** The DICOM attributes for a record. UNAPPROVED carries no review stamps. */
export function buildApprovalModule(record: ApprovalRecord): ApprovalModule {
  if (!record.approved) return { ApprovalStatus: 'UNAPPROVED' };
  const module: ApprovalModule = { ApprovalStatus: 'APPROVED' };
  if (record.reviewerName) module.ReviewerName = record.reviewerName;
  if (record.reviewedAt != null && Number.isFinite(record.reviewedAt)) {
    module.ReviewDate = toDicomDate(record.reviewedAt);
    module.ReviewTime = toDicomTime(record.reviewedAt);
  }
  return module;
}

/**
 * Read the approval state out of a (naturalized) dataset. An absent ApprovalStatus
 * means UNAPPROVED — the DICOM default and the state of every file we didn't write.
 * `REJECTED` exists in the standard; this app never writes it and treats it as
 * not-approved (so the container stays editable) rather than inventing a third UI state.
 */
export function parseApprovalModule(
  dataset: Record<string, unknown> | Partial<ApprovalModule> | undefined,
): ApprovalRecord {
  const fields = dataset as Record<string, unknown> | undefined;
  const raw = scalar(fields?.ApprovalStatus);
  const status = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (status !== 'APPROVED') return { ...UNAPPROVED_RECORD };
  const reviewer = scalar(fields?.ReviewerName);
  return {
    approved: true,
    reviewerName: typeof reviewer === 'string' && reviewer.trim() ? reviewer.trim() : null,
    reviewedAt: fromDicomDateTime(scalar(fields?.ReviewDate), scalar(fields?.ReviewTime)),
  };
}

/**
 * DICOM person-name form of the logged-in XNAT user (`Last^First`), falling back to
 * the username. Null when there is no identity — approval still records the time,
 * per D7.11 ("current user identity, if available").
 */
export function formatReviewerName(
  connection: Pick<XnatConnectionInfo, 'username'> & Partial<Pick<XnatConnectionInfo, 'firstName' | 'lastName'>> | undefined,
): string | null {
  if (!connection) return null;
  const last = connection.lastName?.trim();
  const first = connection.firstName?.trim();
  if (last || first) return `${last ?? ''}^${first ?? ''}`.replace(/\^$/, '');
  const username = connection.username?.trim();
  return username ? username : null;
}
