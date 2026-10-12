/**
 * The transient viewport readout (SegWorks parity R2 — "mask-mode HUD"): a one-line
 * confirmation shown briefly on the active viewport when a hotkey changes the tool, the
 * add/remove mode, the brush size, mask visibility or Hide PHI. Not a toast: it is part
 * of the image surface, carries no action and needs no dismissal.
 */
import { create } from 'zustand';

interface HudState {
  text: string | null;
  /** Bumped on every show, so the same text twice restarts the fade. */
  seq: number;
  show: (text: string) => void;
  clear: () => void;
}

export const useHudStore = create<HudState>((set) => ({
  text: null,
  seq: 0,
  show: (text) => set((s) => ({ text, seq: s.seq + 1 })),
  clear: () => set({ text: null }),
}));
