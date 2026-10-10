/**
 * Smart-tab tool settings and state (SegWorks parity branch 4): Level Trace and Smart
 * Brush options, Random Walker seeds and parameters, and the ROI limit. Session state.
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
}

export interface SmartBrushSettings {
  radiusMm: number;
  tolerance: number;
  spacingPx: number;
}

export interface RandomWalkerSettings {
  beta: number;
  seedRadiusPx: number;
  /** Padding (px) added around the seeds' bounding box for the solve. */
  paddingPx: number;
}

/** World-space seed points for Random Walker, on one viewport's slice. */
export interface SeedStroke {
  kind: 'fg' | 'bg';
  points: number[][];
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
  seeds: { viewportId: string; strokes: SeedStroke[] } | null;
  roi: RoiLimit | null;
  /** The last Smart-tool outcome worth telling the user (shown in place in the controls). */
  message: string | null;
  setMessage: (m: string | null) => void;
  setLevelTrace: (p: Partial<LevelTraceSettings>) => void;
  setSmartBrush: (p: Partial<SmartBrushSettings>) => void;
  setRandomWalker: (p: Partial<RandomWalkerSettings>) => void;
  addSeedStroke: (viewportId: string, stroke: SeedStroke) => void;
  extendSeedStroke: (point: number[]) => void;
  clearSeeds: () => void;
  setRoi: (roi: RoiLimit | null) => void;
}

export const useSemiAutoStore = create<SemiAutoState>((set) => ({
  levelTrace: {
    modality: null, huTolerance: 100, sigmaK: 2.2, window: 7, growth: 'binary', fuzzyThreshold: 0.5,
    edgeGuard: 'off', edgeOperator: 'sobel', polarity: 'auto', airGuard: true, fillHoles: true,
    smoothing: 'none', simplifyPx: 0, roundCorners: 0,
  },
  smartBrush: { radiusMm: 6, tolerance: 80, spacingPx: 2 },
  randomWalker: { beta: 90, seedRadiusPx: 2, paddingPx: 20 },
  seeds: null,
  roi: null,
  message: null,
  setMessage: (message) => set({ message }),
  setLevelTrace: (p) => set((s) => ({ levelTrace: { ...s.levelTrace, ...p } })),
  setSmartBrush: (p) => set((s) => ({ smartBrush: { ...s.smartBrush, ...p } })),
  setRandomWalker: (p) => set((s) => ({ randomWalker: { ...s.randomWalker, ...p } })),
  addSeedStroke: (viewportId, stroke) => set((s) => ({
    seeds: { viewportId, strokes: [...(s.seeds?.viewportId === viewportId ? s.seeds.strokes : []), stroke] },
  })),
  extendSeedStroke: (point) => set((s) => {
    if (!s.seeds?.strokes.length) return s;
    const strokes = s.seeds.strokes.slice();
    const last = strokes[strokes.length - 1];
    strokes[strokes.length - 1] = { ...last, points: [...last.points, point] };
    return { seeds: { ...s.seeds, strokes } };
  }),
  clearSeeds: () => set({ seeds: null }),
  setRoi: (roi) => set({ roi }),
}));
