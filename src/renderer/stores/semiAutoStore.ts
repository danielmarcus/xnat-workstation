/**
 * Smart-tab tool settings and state (SegWorks parity branch 4): Level Trace and Smart
 * Brush options, Random Walker parameters, and the ROI limit. Session state. (Seeds live in
 * seedStore, shared with the Seeded segmentation solvers.)
 */
import { create } from 'zustand';

export interface LevelTraceSettings {
  modality: 'ct' | 'mr' | null; // null = from the scan
  huTolerance: number;
  sigmaK: number;
  window: 7 | 11 | 15;
  growth: 'binary' | 'fuzzy';
  fuzzyThreshold: number;
  edgeGuard: 'off' | 'gentle' | 'strong';
  edgeOperator: 'sobel' | 'scharr';
  polarity: 'auto' | 'darkToLight' | 'lightToDark';
  airGuard: boolean;
  fillHoles: boolean;
  smoothing: 'none' | 'gentle' | 'standard' | 'strong';
  simplifyPx: number;
  roundCorners: number;
  /** Intensity guard: only [lo, hi] is taken (null = off). Typed in or read from the ROI limit. */
  guard: { lo: number; hi: number } | null;
}

export interface SmartBrushSettings {
  radiusMm: number;
  tolerance: number;
  spacingPx: number;
}

export interface RandomWalkerSettings {
  beta: number;
  /** Padding (px) added around the seeds' bounding box for the solve. */
  paddingPx: number;
}

/** The ROI limit: a rectangle drawn on a viewport, kept as its four world corners. */
export interface RoiLimit {
  viewportId: string;
  corners: number[][];
}

interface SemiAutoState {
  levelTrace: LevelTraceSettings;
  smartBrush: SmartBrushSettings;
  randomWalker: RandomWalkerSettings;
  roi: RoiLimit | null;
  /** The last Smart-tool outcome worth telling the user (shown in place in the controls). */
  message: string | null;
  setMessage: (m: string | null) => void;
  setLevelTrace: (p: Partial<LevelTraceSettings>) => void;
  setSmartBrush: (p: Partial<SmartBrushSettings>) => void;
  setRandomWalker: (p: Partial<RandomWalkerSettings>) => void;
  setRoi: (roi: RoiLimit | null) => void;
}

/** Defaults — the More fold's changed dot compares against them. */
export const LEVEL_TRACE_DEFAULTS: LevelTraceSettings = {
  modality: null, huTolerance: 100, sigmaK: 2.2, window: 7, growth: 'binary', fuzzyThreshold: 0.5,
  edgeGuard: 'off', edgeOperator: 'sobel', polarity: 'auto', airGuard: true, fillHoles: true,
  smoothing: 'none', simplifyPx: 0, roundCorners: 0, guard: null,
};
export const SMART_BRUSH_DEFAULTS: SmartBrushSettings = { radiusMm: 6, tolerance: 80, spacingPx: 2 };

export const useSemiAutoStore = create<SemiAutoState>((set) => ({
  levelTrace: { ...LEVEL_TRACE_DEFAULTS },
  smartBrush: { ...SMART_BRUSH_DEFAULTS },
  randomWalker: { beta: 90, paddingPx: 20 },
  roi: null,
  message: null,
  setMessage: (message) => set({ message }),
  setLevelTrace: (p) => set((s) => ({ levelTrace: { ...s.levelTrace, ...p } })),
  setSmartBrush: (p) => set((s) => ({ smartBrush: { ...s.smartBrush, ...p } })),
  setRandomWalker: (p) => set((s) => ({ randomWalker: { ...s.randomWalker, ...p } })),
  setRoi: (roi) => set({ roi }),
}));
