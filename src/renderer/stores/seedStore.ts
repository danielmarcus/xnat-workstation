/**
 * Seeds — one store for every seeded method (SegWorks parity branch 5, G2;
 * docs/segworks-parity.md §11 design points 2–3): Random Walker (branch 4) and the Seeded
 * segmentation operation's solvers.
 *
 * A seed stroke belongs to a segmentation (container) and a class: a member's segment index,
 * or 0 = Background. Points are world positions (a stroke stays on the slice it was drawn on,
 * in the plane of the view it was drawn on); the brush radius is in mm — round in mm on every
 * plane, however thick the slices — fixed when the stroke is drawn. Session state, written by
 * the seed painters through the services.
 */
import { create } from 'zustand';

export const BACKGROUND = 0;

export interface SeedStroke {
  containerId: string;
  viewportId: string;
  /** A member's segment index, or 0 = Background. */
  cls: number;
  /** Brush radius in mm. */
  radiusMm: number;
  /** The view's plane normal when the stroke was drawn: the stroke lies in that plane. */
  normal?: number[];
  points: number[][];
}

interface SeedState {
  strokes: SeedStroke[];
  /** Each segmentation's seeds as they were when its last solve ran (#115 Restore seeds). */
  lastRun: Record<string, SeedStroke[]>;
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
  /** Keep a segmentation's seeds as a solve on it starts. */
  snapshotForRun: (containerId: string) => void;
  /** Put a segmentation's seeds back as its last solve had them (other segmentations' stay). */
  restore: (containerId: string) => void;
  setPaintClass: (c: number | 'erase' | null) => void;
  setBrushPx: (r: number) => void;
}

const copyStroke = (s: SeedStroke): SeedStroke => ({ ...s, points: s.points.map((p) => [...p]) });

export const useSeedStore = create<SeedState>((set) => ({
  strokes: [],
  lastRun: {},
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
  snapshotForRun: (containerId) => set((st) => ({
    lastRun: { ...st.lastRun, [containerId]: st.strokes.filter((s) => s.containerId === containerId).map(copyStroke) },
  })),
  restore: (containerId) => set((st) => {
    const kept = st.lastRun[containerId];
    return kept ? { strokes: [...st.strokes.filter((s) => s.containerId !== containerId), ...kept.map(copyStroke)] } : st;
  }),
  setPaintClass: (paintClass) => set({ paintClass }),
  setBrushPx: (brushPx) => set({ brushPx }),
}));
