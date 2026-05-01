/**
 * Transport Store — per-container transport state for the H contract.
 *
 * Mirrors what the transport layer reports back to the multi-viewport layer:
 * version tokens (H2), save-in-flight (H4/E2), transient or permanent
 * failures (H5). Components read this store to render container-row
 * indicators (D7.4 dirty marker, transient-failure indicator, conflict
 * marker).
 *
 * Phase 0: skeleton. The transport layer (XNAT integration workstream)
 * writes here; the segmentation list panel reads here. No consumers in
 * Phase 0 — those land in Phase 2 (transport contract impl) and Phase 3
 * (list panel UI).
 *
 * See docs/multiviewport-annotation-requirements.md §H.
 */
import { create } from 'zustand';
import type { VersionToken } from '../types/annotation';

/** Transport-side state for a single container. */
export interface TransportRecord {
  /** H2 version token from the transport, opaque to this layer. */
  versionToken: VersionToken | null;
  /** H4/E2: a save round-trip is in flight. */
  saveInFlight: boolean;
  /** ms since epoch of the last successful save, or null if never saved. */
  lastSavedAt: number | null;
  /** Most recent transport outcome category, or null if no outcome yet. */
  lastOutcome: TransportOutcomeKind | null;
  /** Detail for the last failure (transient or permanent). Null if last outcome was success. */
  lastError: TransportError | null;
  /**
   * H6: the transport has reported a server-side change that has not yet
   * been resolved. Surfaces the conflict marker on the container row (D7.4).
   */
  externalChangePending: boolean;
}

export type TransportOutcomeKind = 'success' | 'conflict' | 'transient-failure' | 'permanent-failure';

export interface TransportError {
  kind: 'transient' | 'permanent';
  /** Display-ready message for the container row. */
  message: string;
  /** Underlying error if available; display-only. */
  cause?: unknown;
  /** ms since epoch. */
  at: number;
}

interface TransportStore {
  /** containerId → record. Containers without an entry default to absent. */
  records: Map<string, TransportRecord>;

  /** Get the record for a container, or null if none exists. */
  get: (containerId: string) => TransportRecord | null;

  /** Mark a save as in flight for a container. Idempotent. */
  beginSave: (containerId: string) => void;

  /**
   * Mark a save complete with a new version token (H5 success path).
   * Clears saveInFlight, lastError, externalChangePending, and updates lastSavedAt.
   */
  finishSaveSuccess: (containerId: string, versionToken: VersionToken) => void;

  /**
   * Mark a save as conflicted (H5 conflict path). Clears saveInFlight;
   * sets externalChangePending so the conflict marker appears.
   */
  finishSaveConflict: (containerId: string) => void;

  /** Mark a save as failed transiently (H5 transient-failure). User can retry. */
  finishSaveTransientFailure: (containerId: string, error: TransportError) => void;

  /** Mark a save as failed permanently (H5 permanent-failure). User must intervene. */
  finishSavePermanentFailure: (containerId: string, error: TransportError) => void;

  /** External change reported by the transport layer (H6). */
  noteExternalChange: (containerId: string) => void;

  /** Clear external-change pending flag once the user has resolved it (H7). */
  clearExternalChange: (containerId: string) => void;

  /** Drop the record for a container (e.g., on container delete). */
  remove: (containerId: string) => void;

  /** Clear the entire store (for tests / sign-out). */
  clear: () => void;
}

function emptyRecord(): TransportRecord {
  return {
    versionToken: null,
    saveInFlight: false,
    lastSavedAt: null,
    lastOutcome: null,
    lastError: null,
    externalChangePending: false,
  };
}

function withRecord(records: Map<string, TransportRecord>, containerId: string, patch: Partial<TransportRecord>): Map<string, TransportRecord> {
  const next = new Map(records);
  const existing = next.get(containerId) ?? emptyRecord();
  next.set(containerId, { ...existing, ...patch });
  return next;
}

export const useTransportStore = create<TransportStore>((set, get) => ({
  records: new Map(),

  get: (containerId) => get().records.get(containerId) ?? null,

  beginSave: (containerId) =>
    set((state) => ({
      records: withRecord(state.records, containerId, {
        saveInFlight: true,
        lastError: null,
      }),
    })),

  finishSaveSuccess: (containerId, versionToken) =>
    set((state) => ({
      records: withRecord(state.records, containerId, {
        saveInFlight: false,
        versionToken,
        lastSavedAt: Date.now(),
        lastOutcome: 'success',
        lastError: null,
        externalChangePending: false,
      }),
    })),

  finishSaveConflict: (containerId) =>
    set((state) => ({
      records: withRecord(state.records, containerId, {
        saveInFlight: false,
        lastOutcome: 'conflict',
        externalChangePending: true,
        lastError: null,
      }),
    })),

  finishSaveTransientFailure: (containerId, error) =>
    set((state) => ({
      records: withRecord(state.records, containerId, {
        saveInFlight: false,
        lastOutcome: 'transient-failure',
        lastError: { ...error, kind: 'transient' },
      }),
    })),

  finishSavePermanentFailure: (containerId, error) =>
    set((state) => ({
      records: withRecord(state.records, containerId, {
        saveInFlight: false,
        lastOutcome: 'permanent-failure',
        lastError: { ...error, kind: 'permanent' },
      }),
    })),

  noteExternalChange: (containerId) =>
    set((state) => ({
      records: withRecord(state.records, containerId, {
        externalChangePending: true,
      }),
    })),

  clearExternalChange: (containerId) =>
    set((state) => ({
      records: withRecord(state.records, containerId, {
        externalChangePending: false,
      }),
    })),

  remove: (containerId) =>
    set((state) => {
      if (!state.records.has(containerId)) return {};
      const next = new Map(state.records);
      next.delete(containerId);
      return { records: next };
    }),

  clear: () => set({ records: new Map() }),
}));
