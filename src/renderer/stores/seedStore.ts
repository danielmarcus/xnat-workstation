/**
 * Seeds — one store for every seeded method (SegWorks parity branch 5, G2;
 * docs/segworks-parity.md §11 design points 2–3): Random Walker (branch 4) and the Seeded
 * segmentation operation's solvers.
 *
 * A seed stroke belongs to a segmentation (container) and a class: a member's segment index,
 * or 0 = Background. Points are world positions (a stroke stays on the slice it was drawn on),
 * the brush radius is in the grid's in-plane pixels, fixed when the stroke is drawn. Session
 * state, written by the seed painters through the services.
 */
import { create } from 'zustand';

export const BACKGROUND = 0;

export interface SeedStroke {
  containerId: string;
  viewportId: string;
  /** A member's segment index, or 0 = Background. */
  cls: number;
  radiusPx: number;
  points: number[][];
}

interface SeedState {
  strokes: SeedStroke[];
  /** The seeds as they were when the last solve ran (#115 Restore seeds). */
  lastRun: SeedStroke[] | null;
  /** What the solver painter lays: a member, Background (0), or erase; null = the active member. */
  paintClass: number | 'erase' | null;
  /** The solver painter's brush radius (px; SegWorks 8, 2–40). */
  brushPx: number;
  addStroke: (s: SeedStroke) => void;
  /** Extend the stroke being drawn (the last one). */
  extendStroke: (point: number[]) => void;
  setStrokes: (strokes: SeedStroke[]) => void;
  /** Drop a container's seeds (all of them with no id). */
  clear: (containerId?: string) => void;
  snapshotForRun: () => void;
  restore: () => void;
  setPaintClass: (c: number | 'erase' | null) => void;
  setBrushPx: (r: number) => void;
}

export const useSeedStore = create<SeedState>((set) => ({
  strokes: [],
  lastRun: null,
  paintClass: null,
  brushPx: 8,
  addStroke: (s) => set((st) => ({ strokes: [...st.strokes, s] })),
  extendStroke: (point) => set((st) => {
    if (!st.strokes.length) return st;
    const strokes = st.strokes.slice();
    const last = strokes[strokes.length - 1];
    strokes[strokes.length - 1] = { ...last, points: [...last.points, point] };
    return { strokes };
  }),
  setStrokes: (strokes) => set({ strokes }),
  clear: (containerId) => set((st) => ({ strokes: containerId ? st.strokes.filter((s) => s.containerId !== containerId) : [] })),
  snapshotForRun: () => set((st) => ({ lastRun: st.strokes.map((s) => ({ ...s, points: s.points.map((p) => [...p]) })) })),
  restore: () => set((st) => (st.lastRun ? { strokes: st.lastRun.map((s) => ({ ...s, points: s.points.map((p) => [...p]) })) } : st)),
  setPaintClass: (paintClass) => set({ paintClass }),
  setBrushPx: (brushPx) => set({ brushPx }),
}));
