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
}

export const DEFAULT_SPLINE_SETTINGS: SplineSettings = {
  algorithm: 'centripetalCR',
  samplesPerSegment: DEFAULT_SPLINE_OPTIONS.samplesPerSegment,
  tension: DEFAULT_SPLINE_OPTIONS.tension,
  preventSelfIntersection: false,
  editMode: 'global',
  fitMultiplier: 1,
  fitMargin: 0.3, // SegWorks roiFitMargin
};

export interface ContourToolSettings {
  livewire: LivewireSettings;
  spline: SplineSettings;
}

let settings: ContourToolSettings = { livewire: { ...DEFAULT_LIVEWIRE_SETTINGS }, spline: { ...DEFAULT_SPLINE_SETTINGS } };
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

export function subscribeContourToolSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Back to the defaults (E2E isolation and "Reset"). */
export function resetContourToolSettings(): void {
  settings = { livewire: { ...DEFAULT_LIVEWIRE_SETTINGS }, spline: { ...DEFAULT_SPLINE_SETTINGS } };
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
let splineActions: SplineActions | null = null;
export function registerSplineActions(a: SplineActions | null): void { splineActions = a; }
export function getSplineActions(): SplineActions | null { return splineActions; }
