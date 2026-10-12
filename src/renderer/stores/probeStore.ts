/** Whether the hold-to-probe key is down (SegWorks parity R3). Set by the hotkey service. */
import { create } from 'zustand';

interface ProbeState {
  holding: boolean;
  setHolding: (holding: boolean) => void;
}

export const useProbeStore = create<ProbeState>((set) => ({
  holding: false,
  setHolding: (holding) => set({ holding }),
}));
