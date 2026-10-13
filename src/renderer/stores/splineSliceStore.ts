/**
 * The spline slice workflow's state for the toolbox (branch 6 F5): whether a spline is in hand
 * (⏎ commits, ⎋ discards) and whether the last spline commit can be undone for editing.
 * Written by splineSliceService only.
 */
import { create } from 'zustand';

interface SplineSliceState {
  inHand: boolean;
  canUndoEdit: boolean;
  /** A propagation is moving to the next slice. */
  busy: boolean;
}

export const useSplineSliceStore = create<SplineSliceState>(() => ({ inHand: false, canUndoEdit: false, busy: false }));
