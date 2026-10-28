/**
 * A compute job in progress (SegWorks parity branch 4, C2): shown in the preview bar's slot
 * on the viewport it was started from, with its progress and Cancel.
 *
 * Jobs on different workers can run at once (a solve and a Volume Cleanup, O8): the slot shows
 * the latest, and when it ends, the one it covered — still running — is shown again.
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
  /** What started it, when that operation shows the run itself (Cleanup's footer, O8). */
  source?: 'cleanup';
}

interface ComputeStore {
  /** The job shown: the latest of those running. */
  job: ComputeJobState | null;
  /** Every job running, oldest first. */
  jobs: ComputeJobState[];
  /** Show a job; returns its id, which progress() and end() take. */
  start: (label: string, viewportId: string, cancel?: () => void, source?: ComputeJobState['source']) => number;
  /** Progress of job `id` (default: the one shown). */
  progress: (fraction: number, id?: number) => void;
  /** Job `id` is over (default: the one shown). */
  end: (id?: number) => void;
}

let nextId = 1;
const withJobs = (jobs: ComputeJobState[]) => ({ jobs, job: jobs[jobs.length - 1] ?? null });
const target = (s: ComputeStore, id?: number) => id ?? s.job?.id;

export const useComputeStore = create<ComputeStore>((set) => ({
  job: null,
  jobs: [],
  start: (label, viewportId, cancel, source) => {
    const id = nextId++;
    set((s) => withJobs([...s.jobs, { label, viewportId, fraction: 0, cancel, id, source }]));
    return id;
  },
  progress: (fraction, id) => set((s) => {
    const t = target(s, id);
    return s.jobs.some((j) => j.id === t) ? withJobs(s.jobs.map((j) => (j.id === t ? { ...j, fraction } : j))) : s;
  }),
  end: (id) => set((s) => {
    const t = target(s, id);
    return s.jobs.some((j) => j.id === t) ? withJobs(s.jobs.filter((j) => j.id !== t)) : s;
  }),
}));
