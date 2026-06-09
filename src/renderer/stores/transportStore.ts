/**
 * Transport Store — SKELETON (Phase 0 scaffolding, annotation rebuild).
 *
 * Reactive per-container load/save/recovery state for the rebuilt annotations
 * panel (the autosave row surfaces this in-place; no toasts/banners for routine
 * saves — see CLAUDE.md notification taxonomy). For this slice it is an additive
 * Zustand store with no producers wired yet; segmentationService's existing
 * autoSaveStatus on segmentationStore remains the live source until the
 * transport workstream lands.
 *
 * Follows the create<T>((set) => …) pattern of segmentationStore.ts.
 * Timestamps are passed in by callers (app code uses Date.now()) to keep the
 * store free of nondeterministic clock reads.
 */
import { create } from 'zustand';
import type { ContainerKind } from '@shared/types/annotation';

export type TransportPhase = 'idle' | 'loading' | 'saving' | 'error';

/** Why a save failed — drives the row UX: conflict → H7 prompt; permanent → error badge; transient → retrying. */
export type TransportErrorKind = 'transient' | 'conflict' | 'permanent';

export interface TransportEntry {
  containerId: string;
  kind: ContainerKind;
  phase: TransportPhase;
  /** Last error message, set when phase === 'error'. */
  error?: string;
  /** Classification of the last error (set with phase 'error'). */
  errorKind?: TransportErrorKind;
  /** Server version token of the last successful save (H5/H6 conflict detection). */
  versionToken?: string;
  /** Server's current token when a conflict was detected (H5) — for the H7 prompt. */
  serverVersionToken?: string;
  /** Epoch ms of last successful save (stamped by the caller). */
  lastSavedAt?: number;
}

interface TransportStore {
  /** Per-container transport state, keyed by containerId. */
  entries: Record<string, TransportEntry>;

  /** Set the transport phase for a container (creates the entry if absent). */
  setPhase: (
    containerId: string,
    kind: ContainerKind,
    phase: TransportPhase,
    error?: string,
  ) => void;

  /** Record a save error with its classification (H5) — phase → 'error'. */
  setError: (
    containerId: string,
    kind: ContainerKind,
    errorKind: TransportErrorKind,
    error?: string,
    serverVersionToken?: string,
  ) => void;

  /** Mark a container saved at the given epoch-ms time (+ its new version token); clears error, phase -> idle. */
  markSaved: (containerId: string, at: number, versionToken?: string) => void;

  /** Remove a container's transport entry. */
  remove: (containerId: string) => void;

  /** Clear all transport state. */
  reset: () => void;
}

export const useTransportStore = create<TransportStore>((set) => ({
  entries: {},

  setPhase: (containerId, kind, phase, error) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [containerId]: {
          containerId,
          kind,
          phase,
          error: phase === 'error' ? error : undefined,
          lastSavedAt: s.entries[containerId]?.lastSavedAt,
        },
      },
    })),

  setError: (containerId, kind, errorKind, error, serverVersionToken) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [containerId]: {
          ...s.entries[containerId],
          containerId,
          kind,
          phase: 'error',
          error,
          errorKind,
          serverVersionToken,
          versionToken: s.entries[containerId]?.versionToken,
          lastSavedAt: s.entries[containerId]?.lastSavedAt,
        },
      },
    })),

  markSaved: (containerId, at, versionToken) =>
    set((s) => {
      const prev = s.entries[containerId];
      if (!prev) return {};
      return {
        entries: {
          ...s.entries,
          [containerId]: {
            ...prev,
            phase: 'idle',
            error: undefined,
            errorKind: undefined,
            serverVersionToken: undefined,
            versionToken: versionToken ?? prev.versionToken,
            lastSavedAt: at,
          },
        },
      };
    }),

  remove: (containerId) =>
    set((s) => {
      const { [containerId]: _removed, ...rest } = s.entries;
      return { entries: rest };
    }),

  reset: () => set({ entries: {} }),
}));

/** Selector: is any container currently loading or saving? */
export const selectAnyInFlight = (state: { entries: Record<string, TransportEntry> }): boolean =>
  Object.values(state.entries).some((e) => e.phase === 'loading' || e.phase === 'saving');

/** Selector: container ids currently in a save CONFLICT (drive the H7 resolution prompt). */
export const selectConflicts = (state: { entries: Record<string, TransportEntry> }): string[] =>
  Object.values(state.entries).filter((e) => e.errorKind === 'conflict').map((e) => e.containerId);
