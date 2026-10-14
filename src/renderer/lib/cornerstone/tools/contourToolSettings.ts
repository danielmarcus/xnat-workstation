/**
 * Settings of the contour drawing tools — Live Wire and Spline (SegWorks parity branch 6,
 * docs/segworks-parity.md §10) — shared by the Structure tools and Contour Fill's boundary
 * modes.
 *
 * Plain module state with a subscription, not a store: the tool classes are registered
 * with Cornerstone during init and read these at the moment they need them, so they stay
 * free of the store / service graph (as semiAutoBridge does for the Smart tools). The
 * toolbox's controls read and write them through useContourToolSettings.
 */
import { DEFAULT_LIVEWIRE_COST, type LivewireCostOptions } from '../../segmentation/contours/livewireCost';
import { DEFAULT_SPLINE_OPTIONS, type SplineAlgorithm } from '../../segmentation/contours/splines';
import type { ContourFillMode } from '@shared/types/viewer';

export interface LivewireSettings extends LivewireCostOptions {
  /** Basic = Cornerstone's own cost; Advanced = the weighted cost of #75–79. */
  mode: 'basic' | 'advanced';
  /** How close (screen px) a click must be to the first anchor to close the contour (#80). */
  closeTolerancePx: number;
  /** Chaikin passes applied to the closed contour when it is committed (#81); 0 = none. */
  commitSmoothing: number;
}

export const DEFAULT_LIVEWIRE_SETTINGS: LivewireSettings = {
  ...DEFAULT_LIVEWIRE_COST,
  mode: 'basic',
  closeTolerancePx: 10, // Cornerstone's own click distance
  commitSmoothing: 0,
};

export interface SplineSettings {
  /** Curve family for new splines (#93–99); 'linear' is Cornerstone's polygon. */
  algorithm: SplineAlgorithm | 'linear';
  /** Samples between two control points (SegWorks 8–64, default 22). */
  samplesPerSegment: number;
  /** Tension of local Catmull-Rom+ / tension spline / ROI active spline. */
  tension: number;
  /** Refuse a point, drag or close that would make the curve cross itself (#100). */
  preventSelfIntersection: boolean;
  /** Global: edit anywhere. Local ROI: add and move points only inside the ROI limit (#90–91). */
  editMode: 'global' | 'localRoi';
  /** Fit to ROI (#92): ROI size × multiplier, plus a margin (fraction of the ROI). */
  fitMultiplier: number;
  fitMargin: number;
  /**
   * How Propagate ◀ ▶ carries the spline to the next slice (#87–89): its control points pulled
   * onto that slice's edges, the region propagated as a mask, or the mask then refined by the
   * morphological snake.
   */
  propagateTrack: PropagateTrack;
}

export type PropagateTrack = 'deform' | 'mask' | 'maskSnake';
export const PROPAGATE_TRACKS: ReadonlyArray<{ id: PropagateTrack; label: string }> = [
  { id: 'deform', label: 'Deform spline' },
  { id: 'mask', label: 'Mask' },
  { id: 'maskSnake', label: 'Mask + snake' },
];

export const DEFAULT_SPLINE_SETTINGS: SplineSettings = {
  algorithm: 'centripetalCR',
  samplesPerSegment: DEFAULT_SPLINE_OPTIONS.samplesPerSegment,
  tension: DEFAULT_SPLINE_OPTIONS.tension,
  preventSelfIntersection: false,
  editMode: 'global',
  fitMultiplier: 1,
  fitMargin: 0.3, // SegWorks roiFitMargin
  propagateTrack: 'deform',
};

/** Contour Fill's boundary (D3): how the outline that fills the active segment is drawn. */
export type { ContourFillMode };

export interface ContourToolSettings {
  livewire: LivewireSettings;
  spline: SplineSettings;
  contourFillMode: ContourFillMode;
}

const defaults = (): ContourToolSettings => ({
  livewire: { ...DEFAULT_LIVEWIRE_SETTINGS },
  spline: { ...DEFAULT_SPLINE_SETTINGS },
  contourFillMode: 'freehand',
});

let settings: ContourToolSettings = defaults();
const listeners = new Set<() => void>();

export function getContourToolSettings(): ContourToolSettings {
  return settings;
}

export function setLivewireSettings(patch: Partial<LivewireSettings>): void {
  settings = { ...settings, livewire: { ...settings.livewire, ...patch } };
  for (const l of listeners) l();
}

export function setSplineSettings(patch: Partial<SplineSettings>): void {
  settings = { ...settings, spline: { ...settings.spline, ...patch } };
  for (const l of listeners) l();
}

export function setContourFillMode(contourFillMode: ContourFillMode): void {
  settings = { ...settings, contourFillMode };
  for (const l of listeners) l();
}

export function subscribeContourToolSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Back to the defaults (E2E isolation and "Reset"). */
export function resetContourToolSettings(): void {
  settings = defaults();
  for (const l of listeners) l();
}

// ─── Bridges filled in at run time (keep the tool classes dependency-free) ────

/** World corners of the ROI limit (branch 4) and the viewport it was drawn on, or null. */
export type RoiProvider = () => { viewportId: string; corners: number[][] } | null;
let roiProvider: RoiProvider = () => null;
export function setContourRoiProvider(p: RoiProvider): void { roiProvider = p; }
export function getContourRoi(): ReturnType<RoiProvider> { return roiProvider(); }

/** What the Spline tool exposes to the toolbox's buttons while a spline is being drawn. */
export interface SplineActions {
  /** Remove the last control point (#83); false when no spline is being drawn. */
  undoLastPoint(): boolean;
  /** Discard the spline being drawn (#84); false when none is. */
  clear(): boolean;
}
/**
 * Every Spline tool registers (the Structure Spline and Contour Fill's Spline boundary); an
 * action goes to whichever one is drawing — the others answer false.
 */
const splineActionProviders = new Set<SplineActions>();
export function registerSplineActions(a: SplineActions): () => void {
  splineActionProviders.add(a);
  return () => splineActionProviders.delete(a);
}
export function getSplineActions(): SplineActions | null {
  if (!splineActionProviders.size) return null;
  const all = [...splineActionProviders];
  return {
    undoLastPoint: () => all.some((p) => p.undoLastPoint()),
    clear: () => all.some((p) => p.clear()),
  };
}

/**
 * Splines in hand (F5), by annotation UID. A held spline is a preview: its placement and the
 * edits to it are not edits to the container — only its commit is (#99) — so the dirty /
 * autosave tracking skips annotation events for these.
 */
const splinesInHand = new Set<string>();
export function setSplineInHand(uid: string, inHand: boolean): void {
  if (inHand) splinesInHand.add(uid);
  else splinesInHand.delete(uid);
}
export function isSplineInHand(uid: string | undefined): boolean {
  return !!uid && splinesInHand.has(uid);
}

/**
 * Whether a spline in hand is being rendered. Cornerstone's contour-segmentation tools fire
 * SEGMENTATION_DATA_MODIFIED (which carries no annotation) from rendering an edited contour;
 * for a held spline that is not an edit either.
 */
let heldSplineRenders = 0;
export function whileRenderingSplineInHand<T>(render: () => T): T {
  heldSplineRenders++;
  try {
    return render();
  } finally {
    heldSplineRenders--;
  }
}
export function isRenderingSplineInHand(): boolean {
  return heldSplineRenders > 0;
}
