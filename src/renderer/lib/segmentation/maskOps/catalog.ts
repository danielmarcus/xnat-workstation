/**
 * The cleanup operations the Cleanup sheet offers (SegWorks #188–205), declared once:
 * label, parameters (rendered by the sheet from this schema), and the plane function.
 * Defaults and ranges follow SegWorks v2.0.610's Clean panel, with areas/distances in
 * mm / mm² and kernel radii in pixels.
 */
import type { MaskPlane } from './plane';
import type { PlaneOpContext } from './scope';
import {
  anisotropicDiffusion,
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

export interface CleanupOp {
  id: string;
  label: string;
  /** One line for the sheet, under the operation picker. */
  description: string;
  params: ParamSpec[];
  /** Needs the source image under the plane. */
  usesImage?: boolean;
  run(plane: MaskPlane, ctx: PlaneOpContext, params: ParamValues): MaskPlane;
}

const num = (p: ParamValues, k: string) => Number(p[k]);

export const CLEANUP_OPS: CleanupOp[] = [
  {
    id: 'fillHoles',
    label: 'Fill holes',
    description: 'Fill enclosed empty regions inside the segment.',
    params: [
      { key: 'maxHoleAreaMm2', label: 'Largest hole', kind: 'number', min: 0, max: 5000, step: 10, default: 0, unit: 'mm²', hint: '0 = fill every enclosed hole' },
    ],
    run: (plane, ctx, p) => fillHoles(plane, ctx.spacing, { maxHoleAreaMm2: num(p, 'maxHoleAreaMm2') > 0 ? num(p, 'maxHoleAreaMm2') : undefined }),
  },
  {
    id: 'keepLargest',
    label: 'Keep largest',
    description: 'Delete every island except the largest on each slice.',
    params: [
      { key: 'alsoKeepPct', label: 'Also keep islands ≥', kind: 'number', min: 0, max: 100, step: 5, default: 0, unit: '% of largest', advanced: true },
    ],
    run: (plane, _ctx, p) => keepLargest(plane, { alsoKeepPct: num(p, 'alsoKeepPct') }),
  },
  {
    id: 'removeSpeckles',
    label: 'Remove speckles',
    description: 'Remove islands smaller than a minimum area.',
    params: [{ key: 'minAreaMm2', label: 'Smaller than', kind: 'number', min: 1, max: 1000, step: 1, default: 10, unit: 'mm²' }],
    run: (plane, ctx, p) => removeSpeckles(plane, ctx.spacing, { minAreaMm2: num(p, 'minAreaMm2') }),
  },
  {
    id: 'removeStrays',
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
    label: 'Median smooth',
    description: 'Majority vote in a neighbourhood; keeps edges fairly crisp.',
    params: [{ key: 'radius', label: 'Radius', kind: 'number', min: 1, max: 5, step: 1, default: 2, unit: 'px' }],
    run: (plane, _ctx, p) => medianSmooth(plane, { radius: num(p, 'radius') }),
  },
  {
    id: 'gaussian',
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
    label: 'Smooth edges',
    description: 'A light local vote that rounds isolated jagged pixels.',
    params: [{ key: 'strength', label: 'Strength', kind: 'number', min: 0.1, max: 1.5, step: 0.1, default: 0.5 }],
    run: (plane, _ctx, p) => smoothEdges(plane, { strength: num(p, 'strength') }),
  },
  {
    id: 'open',
    label: 'Morph open',
    description: 'Erode then dilate: removes thin protrusions and weak bridges.',
    params: [{ key: 'radius', label: 'Radius', kind: 'number', min: 1, max: 5, step: 1, default: 1, unit: 'px' }],
    run: (plane, _ctx, p) => openMask(plane, { radius: num(p, 'radius') }),
  },
  {
    id: 'close',
    label: 'Morph close',
    description: 'Dilate then erode: seals narrow grooves and small gaps.',
    params: [{ key: 'radius', label: 'Radius', kind: 'number', min: 1, max: 5, step: 1, default: 1, unit: 'px' }],
    run: (plane, _ctx, p) => closeMask(plane, { radius: num(p, 'radius') }),
  },
  {
    id: 'anisotropic',
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
];

export function cleanupOp(id: string): CleanupOp | undefined {
  return CLEANUP_OPS.find((o) => o.id === id);
}

export function defaultParams(op: CleanupOp): ParamValues {
  return Object.fromEntries(op.params.map((p) => [p.key, p.default]));
}
