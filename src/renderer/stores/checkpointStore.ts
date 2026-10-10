/** Checkpoint listings per Segmentation and the save dialog's target (SegWorks parity D8). */
import { create } from 'zustand';
import type { CheckpointMeta } from '@shared/types/checkpoint';

interface CheckpointState {
  lists: Record<string, CheckpointMeta[]>;
  /** Container whose "Save checkpoint…" dialog is open. */
  savingFor: string | null;
  setList: (containerId: string, list: CheckpointMeta[]) => void;
  setSavingFor: (containerId: string | null) => void;
}

export const useCheckpointStore = create<CheckpointState>((set) => ({
  lists: {},
  savingFor: null,
  setList: (containerId, list) => set((s) => ({ lists: { ...s.lists, [containerId]: list } })),
  setSavingFor: (savingFor) => set({ savingFor }),
}));
