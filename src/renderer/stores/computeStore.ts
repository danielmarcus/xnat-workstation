/**
 * A compute job in progress (SegWorks parity branch 4, C2): shown in the preview bar's slot
 * on the viewport it was started from, with its progress and Cancel.
 */
import { create } from 'zustand';

export interface ComputeJobState {
  label: string;
  viewportId: string;
  fraction: number;
  /** How to cancel it, when it is not a compute-worker job (a module run, branch 9). */
  cancel?: () => void;
}

interface ComputeStore {
  job: ComputeJobState | null;
  start: (label: string, viewportId: string, cancel?: () => void) => void;
  progress: (fraction: number) => void;
  end: () => void;
}

export const useComputeStore = create<ComputeStore>((set) => ({
  job: null,
  start: (label, viewportId, cancel) => set({ job: { label, viewportId, fraction: 0, cancel } }),
  progress: (fraction) => set((s) => (s.job ? { job: { ...s.job, fraction } } : s)),
  end: () => set({ job: null }),
}));
