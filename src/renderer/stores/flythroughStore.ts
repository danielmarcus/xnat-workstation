/**
 * Auto Review flythrough (SegWorks parity D6, #213–221): the run state the player shows
 * and the settings it edits. Settings persist for the session.
 */
import { create } from 'zustand';

export interface FlythroughSettings {
  /** Segments whose extent sets the range (empty = every segment of the container). */
  segmentIndices: number[];
  /** The container `segmentIndices` was chosen in — another container's review ignores it. */
  segmentIndicesFor?: string | null;
  direction: 'forward' | 'backward';
  startFrom: 'bounds' | 'current';
  /** Flicker the masks off then on at each slice to compare with the anatomy. */
  flicker: boolean;
  /** How long the anatomy is shown without the masks (ms). */
  anatomyMs: number;
  /** How long each slice dwells with the masks shown (ms). */
  maskMs: number;
}

export interface FlythroughState extends FlythroughSettings {
  running: boolean;
  paused: boolean;
  viewportId: string | null;
  containerId: string | null;
  /** Displayed slice range being reviewed (0-based, inclusive). */
  lo: number;
  hi: number;
  /** Position within the run (1-based) and its length. */
  step: number;
  steps: number;
  /** Showing the anatomy (masks off) in the current flicker. */
  anatomyPhase: boolean;
  settingsOpen: boolean;
  setSettings: (patch: Partial<FlythroughSettings>) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useFlythroughStore = create<FlythroughState>((set) => ({
  segmentIndices: [],
  segmentIndicesFor: null,
  direction: 'forward',
  startFrom: 'bounds',
  flicker: true,
  anatomyMs: 400,
  maskMs: 800,
  running: false,
  paused: false,
  viewportId: null,
  containerId: null,
  lo: 0,
  hi: 0,
  step: 0,
  steps: 0,
  anatomyPhase: false,
  settingsOpen: false,
  setSettings: (patch) => set((s) => (patch.segmentIndices ? { ...patch, segmentIndicesFor: s.containerId } : patch)),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
