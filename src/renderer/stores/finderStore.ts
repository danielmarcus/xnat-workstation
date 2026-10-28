/** Whether the ⌘K finder is open (annotation-panel-modes R4-A). */
import { create } from 'zustand';

interface FinderState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useFinderStore = create<FinderState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
