/**
 * The cleanup operations the Cleanup sheet offers (SegWorks #188–205), declared once:
 * label, parameters (rendered by the sheet from this schema), and the plane function.
 * Defaults and ranges follow SegWorks v2.0.610's Clean panel, with areas/distances in
 * mm / mm² and kernel radii in pixels.
 */
import type { MaskPlane } from './plane';
import type { PlaneOpContext, PlaneOpOutput } from './scope';
import { snakeRefine, type SnakeVariant } from '../contours/snake';
import {
  anisotropicDiffusion,
  magnetBridge,
  closeMask,
  fillHoles,
  gaussianSmooth,
  keepLargest,
  medianSmooth,
  openMask,
  removeSpeckles,
  removeStrays,
  smoothEdges,
} from './cleanup';

export type ParamSpec =
  | { key: string; label: string; kind: 'number'; min: number; max: number; step: number; default: number; unit?: string; advanced?: boolean; hint?: string }
  | { key: string; label: string; kind: 'select'; options: Array<{ value: string; label: string }>; default: string; advanced?: boolean; hint?: string };

export type ParamValues = Record<string, number | string>;

/** What a two-segment operation sees on one slice. */
export interface PairOpContext {
  spacing: PlaneOpContext['spacing'];
  /** Pixels of every OTHER member (not source, not target). */
  others: Uint8Array;
  /** Pixels of members that may not be changed (locked): never crossed or claimed. */
  protectedMask: Uint8Array;
}

export interface PairOpResult {
  /** New source plane; omitted when the operation leaves the source alone. */
  source?: MaskPlane;
  target: MaskPlane;
  /** Pixels taken from other members (their owners lose them). */
  claimed?: Uint8Array;
}

export interface CleanupOp {
  id: string;
  label: string;
  /** Picker group: per-segment cleanup, or operations between segments. */
  group: 'clean' | 'segments';
  /** One line for the sheet, under the operation picker. */
  description: string;
  params: ParamSpec[];
  /** Needs the source image under the plane. */
  usesImage?: boolean;
  /** Single-segment operation over each member in the label scope. */
  run?: (plane: MaskPlane, ctx: PlaneOpContext, params: ParamValues) => PlaneOpOutput;
  /** With these parameters the operation may claim pixels of other members (so they are written too). */
  claims?: (params: ParamValues) => boolean;
  /** Two-segment operation: the active member (source) and an "Into" member (target). */
  runPair?: (source: MaskPlane, target: MaskPlane, ctx: PairOpContext, params: ParamValues) => PairOpResult;
}

const num = (p: ParamValues, k: string) => Number(p[k]);

export const CLEANUP_OPS: CleanupOp[] = [
  {
    id: 'fillHoles',
    group: 'clean',
    label: 'Fill holes',
    description: 'Fill enclosed empty regions inside the segment.',
    params: [
      { key: 'maxHoleAreaMm2', label: 'Largest hole', kind: 'number', min: 0, max: 5000, step: 10, default: 0, unit: 'mm²', hint: '0 = fill every enclosed hole' },
    ],
    run: (plane, ctx, p) => fillHoles(plane, ctx.spacing, { maxHoleAreaMm2: num(p, 'maxHoleAreaMm2') > 0 ? num(p, 'maxHoleAreaMm2') : undefined }),
  },
  {
    id: 'keepLargest',
    group: 'clean',
    label: 'Keep largest',
    description: 'Delete every island except the largest on each slice.',
    params: [
      { key: 'alsoKeepPct', label: 'Also keep islands ≥', kind: 'number', min: 0, max: 100, step: 5, default: 0, unit: '% of largest', advanced: true },
    ],
    run: (plane, _ctx, p) => keepLargest(plane, { alsoKeepPct: num(p, 'alsoKeepPct') }),
  },
  {
    id: 'removeSpeckles',
    group: 'clean',
    label: 'Remove speckles',
    description: 'Remove islands smaller than a minimum area.',
    params: [{ key: 'minAreaMm2', label: 'Smaller than', kind: 'number', min: 1, max: 1000, step: 1, default: 10, unit: 'mm²' }],
    run: (plane, ctx, p) => removeSpeckles(plane, ctx.spacing, { minAreaMm2: num(p, 'minAreaMm2') }),
  },
  {
    id: 'removeStrays',
    group: 'clean',
    label: 'Remove strays',
    description: 'Remove islands whose centre is far from the largest island.',
    params: [
      { key: 'maxDistanceMm', label: 'Farther than', kind: 'number', min: 5, max: 120, step: 1, default: 30, unit: 'mm' },
      { key: 'protectPct', label: 'Protect islands ≥', kind: 'number', min: 0, max: 100, step: 5, default: 15, unit: '% of largest', advanced: true },
    ],
    run: (plane, ctx, p) => removeStrays(plane, ctx.spacing, { maxDistanceMm: num(p, 'maxDistanceMm'), protectPct: num(p, 'protectPct') }),
  },
  {
    id: 'median',
    group: 'clean',
    label: 'Median smooth',
    description: 'Majority vote in a neighbourhood; keeps edges fairly crisp.',
    params: [{ key: 'radius', label: 'Radius', kind: 'number', min: 1, max: 5, step: 1, default: 2, unit: 'px' }],
    run: (plane, _ctx, p) => medianSmooth(plane, { radius: num(p, 'radius') }),
  },
  {
    id: 'gaussian',
    group: 'clean',
    label: 'Gaussian smooth',
    description: 'Blur and re-threshold; rounds corners and jagged outlines.',
    params: [
      { key: 'sigma', label: 'σ', kind: 'number', min: 0.5, max: 4, step: 0.1, default: 1.2, unit: 'px' },
      { key: 'threshold', label: 'Threshold', kind: 'number', min: 0.2, max: 0.8, step: 0.05, default: 0.45, advanced: true },
    ],
    run: (plane, _ctx, p) => gaussianSmooth(plane, { sigma: num(p, 'sigma'), threshold: num(p, 'threshold') }),
  },
  {
    id: 'smoothEdges',
    group: 'clean',
    label: 'Smooth edges',
    description: 'A light local vote that rounds isolated jagged pixels.',
    params: [{ key: 'strength', label: 'Strength', kind: 'number', min: 0.1, max: 1.5, step: 0.1, default: 0.5 }],
    run: (plane, _ctx, p) => smoothEdges(plane, { strength: num(p, 'strength') }),
  },
  {
    id: 'open',
    group: 'clean',
    label: 'Morph open',
    description: 'Erode then dilate: removes thin protrusions and weak bridges.',
    params: [{ key: 'radius', label: 'Radius', kind: 'number', min: 1, max: 5, step: 1, default: 1, unit: 'px' }],
    run: (plane, _ctx, p) => openMask(plane, { radius: num(p, 'radius') }),
  },
  {
    id: 'close',
    group: 'clean',
    label: 'Morph close',
    description: 'Dilate then erode: seals narrow grooves and small gaps.',
    params: [{ key: 'radius', label: 'Radius', kind: 'number', min: 1, max: 5, step: 1, default: 1, unit: 'px' }],
    run: (plane, _ctx, p) => closeMask(plane, { radius: num(p, 'radius') }),
  },
  {
    id: 'anisotropic',
    group: 'clean',
    label: 'Anisotropic diffusion',
    description: 'Edge-preserving smoothing: keeps boundaries the image supports.',
    usesImage: true,
    params: [
      { key: 'iterations', label: 'Iterations', kind: 'number', min: 1, max: 50, step: 1, default: 10 },
      { key: 'kappa', label: 'κ', kind: 'number', min: 5, max: 200, step: 5, default: 30, hint: 'Edge strength (image units) that stops smoothing' },
      { key: 'conduction', label: 'Conduction', kind: 'select', default: 'exp', options: [{ value: 'exp', label: 'Exponential (gentler)' }, { value: 'quadratic', label: 'Quadratic (sharper)' }], advanced: true },
    ],
    run: (plane, ctx, p) => anisotropicDiffusion(plane, {
      iterations: num(p, 'iterations'),
      kappa: num(p, 'kappa'),
      conduction: p.conduction === 'quadratic' ? 'quadratic' : 'exp',
      image: ctx.image,
    }),
  },
  {
    id: 'snakeRefine',
    group: 'clean',
    label: 'Snake refine',
    description: 'Move the boundary onto the image edges nearby (active contour).',
    usesImage: true,
    params: [
      {
        key: 'variant', label: 'Variant', kind: 'select', default: 'edge',
        options: [
          { value: 'edge', label: 'Edge (Kass)' },
          { value: 'gvf', label: 'Gradient vector flow' },
          { value: 'balloon', label: 'Balloon' },
          { value: 'morph', label: 'Morphological' },
        ],
        hint: 'GVF reaches edges farther away; Balloon also inflates; Morphological is the most robust to noise',
      },
      { key: 'iterations', label: 'Iterations', kind: 'number', min: 1, max: 100, step: 1, default: 20, hint: 'Morphological uses at most 8' },
      { key: 'edgeWeight', label: 'Edge weight', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.55, hint: 'How strongly edges stop the morphological contour' },
      {
        key: 'replaceNeighbours', label: 'Neighbours', kind: 'select', default: 'keep',
        options: [{ value: 'keep', label: 'Keep (default)' }, { value: 'replace', label: 'Replace shared boundary' }],
        hint: 'Replace: pixels of a touching segment along the shared boundary may be taken (never a locked one)',
      },
      { key: 'gvfMu', label: 'GVF μ', kind: 'number', min: 0.05, max: 0.5, step: 0.05, default: 0.2, advanced: true },
      { key: 'gvfIterations', label: 'GVF iterations', kind: 'number', min: 5, max: 100, step: 5, default: 40, advanced: true },
      { key: 'balloon', label: 'Balloon force', kind: 'number', min: -0.5, max: 0.5, step: 0.05, default: 0.15, advanced: true, hint: '> 0 grows, < 0 shrinks' },
    ],
    claims: (p) => p.replaceNeighbours === 'replace',
    run: (plane, ctx, p) => {
      if (!ctx.image) return plane;
      const allowReplace = p.replaceNeighbours === 'replace';
      const out = snakeRefine(plane, ctx.image, {
        variant: String(p.variant) as SnakeVariant,
        iterations: num(p, 'iterations'),
        edgeWeight: num(p, 'edgeWeight'),
        gvfMu: num(p, 'gvfMu'),
        gvfIterations: num(p, 'gvfIterations'),
        balloon: num(p, 'balloon'),
      }, { others: ctx.others, protect: ctx.protect, allowReplace });
      if (!allowReplace || !ctx.others) return out;
      const others = ctx.others;
      return { plane: out, claimed: Uint8Array.from(out.data, (v, i) => (v && others[i] ? 1 : 0)) };
    },
  },
  {
    id: 'clear',
    group: 'segments',
    label: 'Clear',
    description: 'Erase the segment across the scope (Slice + All segments clears the slice).',
    params: [],
    run: (plane) => ({ ...plane, data: new Uint8Array(plane.data.length) }),
  },
  {
    id: 'moveInto',
    group: 'segments',
    label: 'Move into…',
    description: 'Relabel this segment\u2019s voxels as another segment (merge), leaving it empty in the scope.',
    params: [],
    runPair: (src, dst) => {
      const out = new Uint8Array(dst.data);
      for (let i = 0; i < out.length; i++) if (src.data[i]) out[i] = 1;
      return { source: { ...src, data: new Uint8Array(src.data.length) }, target: { ...dst, data: out } };
    },
  },
  {
    id: 'copyInto',
    group: 'segments',
    label: 'Copy into…',
    description: 'Add this segment\u2019s voxels to another segment, keeping both (duplicate into a new member added with +).',
    params: [],
    runPair: (src, dst) => {
      const out = new Uint8Array(dst.data);
      for (let i = 0; i < out.length; i++) if (src.data[i]) out[i] = 1;
      return { target: { ...dst, data: out } };
    },
  },
  {
    id: 'magnetBridge',
    group: 'segments',
    label: 'Magnet bridge…',
    description: 'Grow another segment across a small gap until it meets this one.',
    params: [
      { key: 'maxGapPx', label: 'Max gap', kind: 'number', min: 1, max: 60, step: 1, default: 10, unit: 'px' },
      { key: 'mode', label: 'Mode', kind: 'select', default: 'fill', options: [{ value: 'fill', label: 'Fill gaps only' }, { value: 'overwrite', label: 'Overwrite other segments' }] },
    ],
    runPair: (src, dst, ctx, p) => {
      const r = magnetBridge({
        width: dst.width, height: dst.height, source: src.data, target: dst.data,
        blocked: ctx.others, protectedMask: ctx.protectedMask,
        maxGapPx: num(p, 'maxGapPx'), mode: p.mode === 'overwrite' ? 'overwrite' : 'fill',
      });
      return { target: { ...dst, data: r.target }, claimed: r.claimed };
    },
  },
];

export function cleanupOp(id: string): CleanupOp | undefined {
  return CLEANUP_OPS.find((o) => o.id === id);
}

export function defaultParams(op: CleanupOp): ParamValues {
  return Object.fromEntries(op.params.map((p) => [p.key, p.default]));
}
