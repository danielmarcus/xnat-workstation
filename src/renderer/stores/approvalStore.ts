/**
 * Approval Store — container-level approval state (requirements D7.11, design §2.6).
 *
 * Session state for a value that is PERSISTED IN DICOM: exports stamp
 * `ApprovalStatus` / `Reviewer*` from here (lib/annotations/approval), and loading a
 * container seeds it from the file, so an already-approved object arrives edit-locked.
 * Keyed by container id, so it serves all three kinds (SEG / RTSTRUCT / `sr:` ids).
 *
 * The audit trail is session-only beyond what DICOM records (design §2.6): revoking
 * keeps the history, and a later re-approval appends to it.
 */
import { create } from 'zustand';
import type { ApprovalEvent, ApprovalRecord } from '@shared/types/annotation';

/** DICOM's default: absent ApprovalStatus reads as UNAPPROVED. */
const UNAPPROVED_RECORD: ApprovalRecord = { approved: false, reviewerName: null, reviewedAt: null };

interface ApprovalStore {
  /** containerId → approval record. Absent means unapproved. */
  approvals: Record<string, ApprovalRecord>;
  /** containerId → session audit trail, oldest first. */
  history: Record<string, ApprovalEvent[]>;

  /** The record for a container (never undefined — absent reads as unapproved). */
  approvalOf: (containerId: string) => ApprovalRecord;
  /** Whether a container is edit-locked by approval. */
  isApproved: (containerId: string) => boolean;

  /**
   * Approve or revoke. `at` and `by` are supplied by the caller (no clock reads in
   * the store) and are appended to the audit trail either way.
   */
  setApproval: (containerId: string, approved: boolean, by: string | null, at: number) => void;

  /** Seed from a loaded DICOM object (no audit entry — this is not a user action). */
  seedApproval: (containerId: string, record: ApprovalRecord) => void;

  /** Drop a container's state (container removed / session cleared). */
  remove: (containerId: string) => void;
  reset: () => void;
}

export const useApprovalStore = create<ApprovalStore>((set, get) => ({
  approvals: {},
  history: {},

  approvalOf: (containerId) => get().approvals[containerId] ?? UNAPPROVED_RECORD,
  isApproved: (containerId) => get().approvals[containerId]?.approved === true,

  setApproval: (containerId, approved, by, at) =>
    set((s) => ({
      approvals: {
        ...s.approvals,
        [containerId]: approved
          ? { approved: true, reviewerName: by, reviewedAt: at }
          : { ...UNAPPROVED_RECORD },
      },
      history: {
        ...s.history,
        [containerId]: [...(s.history[containerId] ?? []), { action: approved ? 'approve' : 'revoke', by, at }],
      },
    })),

  seedApproval: (containerId, record) =>
    set((s) => ({ approvals: { ...s.approvals, [containerId]: { ...record } } })),

  remove: (containerId) =>
    set((s) => {
      const { [containerId]: _dropped, ...approvals } = s.approvals;
      const { [containerId]: _droppedHistory, ...history } = s.history;
      return { approvals, history };
    }),

  reset: () => set({ approvals: {}, history: {} }),
}));
