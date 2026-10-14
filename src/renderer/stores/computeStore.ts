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
  /** Which start() this is — a replaced job's late progress or end must not touch the new one. */
  id: number;
}

interface ComputeStore {
  job: ComputeJobState | null;
  /** Show a job; returns its id, which progress() and end() take. */
  start: (label: string, viewportId: string, cancel?: () => void) => number;
  /** Progress of job `id` (ignored once another job has replaced it). */
  progress: (fraction: number, id?: number) => void;
  /** Job `id` is over (ignored once another job has replaced it — its bar stays). */
  end: (id?: number) => void;
}

let nextId = 1;
const current = (s: ComputeStore, id?: number) => !!s.job && (id === undefined || s.job.id === id);

export const useComputeStore = create<ComputeStore>((set) => ({
  job: null,
  start: (label, viewportId, cancel) => {
    const id = nextId++;
    set({ job: { label, viewportId, fraction: 0, cancel, id } });
    return id;
  },
  progress: (fraction, id) => set((s) => (current(s, id) ? { job: { ...s.job!, fraction } } : s)),
  end: (id) => set((s) => (current(s, id) ? { job: null } : s)),
}));
