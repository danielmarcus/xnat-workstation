/**
 * Operations section state (SegWorks parity D1, amended 2026-10-12).
 *
 * One operation at a time is open in the Operations section, between the member list and
 * the toolbox; it stays open while tools change, and can be collapsed to a one-line
 * summary without ending it (or its preview). Kept in a store (not component state)
 * because hotkeys open operations too. Parameter values and scope persist per operation
 * for the session, so reopening an operation resumes where the user left it.
 */
import { create } from 'zustand';
/** Parameter values of one operation (mirrors maskOps/catalog's ParamValues; stores import no lib code). */
type ParamValues = Record<string, number | string>;

export type BuiltinOperationId = 'cleanup' | 'interpolate' | 'propagate' | 'seeded' | 'regionCompetition' | 'qc3d';
/** A built-in operation, or a module's (branch 9): `module:<module id>`. */
export type OperationSheetId = BuiltinOperationId | `module:${string}`;

export interface PropagateSettings {
  direction: 'forward' | 'backward' | 'both';
  /** null = from the scan's modality. */
  modality: 'ct' | 'mr' | null;
  huTolerance: number;
  sigma: number;
  maxSlices: number;
  stable: boolean;
  growPx: number;
  /** Stop when the area changes by more than this percentage between slices. */
  maxAreaChangePct: number;
  fillHoles: boolean;
  edgeGuard: boolean;
  zSmoothing: boolean;
}

export interface InterpolateSettings {
  method: 'sdfLinear' | 'sdfArea' | 'morphology' | 'components' | 'volumeMorphology' | 'imageGuided';
  distance: 'exact' | 'chamfer';
  fill: 'gaps' | 'current' | 'anchors';
  /** Anchors in the viewport's displayed numbering (1-based); null = unset. */
  anchorA: number | null;
  anchorB: number | null;
}

/** Seeded segmentation (branch 5): Fast GrowCut · Graph Cut · α-expansion, from painted seeds. */
export interface SeededSettings {
  /** Random Walker solves the slice on screen only (2D); the others solve in 3D. */
  method: 'growCut' | 'graphCut' | 'alphaExpansion' | 'randomWalker';
  /** The box solved: around the seeds, the ROI limit, or the whole volume. */
  domain: 'seeded' | 'roi' | 'volume';
  /** Padding round the seeds' box: in-plane pixels and slices (SegWorks α-expansion 24 / 2). */
  padXY: number;
  padZ: number;
  /** Fast GrowCut's intensity gate (#110). */
  gateOn: boolean;
  gateLo: number;
  gateHi: number;
  /** Graph Cut: λ and σ (SegWorks 50 / 30). */
  lambda: number;
  sigma: number;
  /** α-expansion (SegWorks defaults). */
  smooth: number;
  alphaSigma: number;
  sweeps: number;
  uInt: number;
  uLoc: number;
  locality: number;
  intensity: number;
  seedBias: number;
  /** Post-processing (off by default, as in SegWorks). */
  postOn: boolean;
  postKeep: 'off' | 'seed' | 'largest';
  postMinIsland: number;
  postSmooth: number;
  postShrinkGrow: number;
}

/** Region competition, SegWorks' "Chan-Vese" (branch 5, G5): the existing labels compete for voxels. */
export interface RegionSettings {
  mode: 'slice' | 'bounded' | 'extent10' | 'extent20' | 'volume';
  /** Members that may change (segment indices); null = the active one. */
  labels: number[] | null;
  includeBackground: boolean;
  iterations: number;
  smoothXY: number;
  dataWeight: number;
  stay: number;
  edgeWeight: number;
  edgeGate: number;
  /** Islands below this many voxels join a neighbour (0 = off). */
  cleanup: number;
  clipOn: boolean;
  clipLo: number;
  clipHi: number;
  zPad: number;
  smoothZ: number;
  zCoupling: number;
}

export interface SheetScope {
  slices: 'current' | 'range' | 'volume';
  /** Range ends as the viewport DISPLAYS them (1-based, "8 / 16"). */
  from: number;
  to: number;
  labels: 'active' | 'all';
}

interface OperationSheetState {
  openSheet: OperationSheetId | null;
  /** The open operation is folded to its header row; it (and any preview) stays alive. */
  collapsed: boolean;
  cleanupOpId: string;
  /** Parameter values per cleanup op id. */
  params: Record<string, ParamValues>;
  scope: SheetScope;
  /** Advanced section expanded, per op id. */
  advancedOpen: Record<string, boolean>;
  /** One-line status in the open operation (never a toast): "Nothing to change", lock reasons, … */
  message: string | null;
  /** The "Into" member of a two-segment operation (segment index). */
  intoSegmentIndex: number | null;
  /** Smart Cleanup (All segments): protect small and thin segments from eroding ops. */
  smartProtect: boolean;
  /** What protected segments get instead: 'skip' or 'median'. */
  smartSafeAction: string;
  /** The user's edits to the proposed plan, by segment index. Reset when the proposal changes. */
  planOverrides: Record<number, string>;
  /** Closing the operation with a pending preview asks first, inline. */
  confirmingLeave: boolean;
  interp: InterpolateSettings;
  setInterp: (patch: Partial<InterpolateSettings>) => void;
  prop: PropagateSettings;
  setProp: (patch: Partial<PropagateSettings>) => void;
  seeded: SeededSettings;
  setSeeded: (patch: Partial<SeededSettings>) => void;
  region: RegionSettings;
  setRegion: (patch: Partial<RegionSettings>) => void;

  /** Open (or expand) an operation. */
  openOperation: (id: OperationSheetId) => void;
  closeSheet: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setCleanupOp: (opId: string) => void;
  setParam: (opId: string, key: string, value: number | string) => void;
  /** A module operation's parameter values (module id → values; a manifest may declare booleans). */
  moduleParams: Record<string, Record<string, number | string | boolean>>;
  setModuleParam: (moduleId: string, key: string, value: number | string | boolean) => void;
  /** A module operation's scope (module id → choice). */
  moduleScopes: Record<string, { kind: 'slice' | 'range' | 'volume' | 'roi'; from?: number; to?: number }>;
  setModuleScope: (moduleId: string, scope: { kind: 'slice' | 'range' | 'volume' | 'roi'; from?: number; to?: number }) => void;
  setScope: (patch: Partial<SheetScope>) => void;
  toggleAdvanced: (opId: string) => void;
  setMessage: (message: string | null) => void;
  setInto: (segmentIndex: number | null) => void;
  setSmartProtect: (v: boolean) => void;
  setSmartSafeAction: (v: string) => void;
  setPlanOverride: (segmentIndex: number, action: string) => void;
  clearPlanOverrides: () => void;
  setConfirmingLeave: (v: boolean) => void;
}

/** Defaults — the More fold's changed dot compares against them. */
export const INTERP_DEFAULTS: OperationSheetState['interp'] = { method: 'sdfArea', distance: 'exact', fill: 'gaps', anchorA: null, anchorB: null };
export const PROPAGATE_DEFAULTS: OperationSheetState['prop'] = {
  direction: 'both', modality: null, huTolerance: 150, sigma: 2, maxSlices: 50, stable: true, growPx: 0,
  maxAreaChangePct: 60, fillHoles: true, edgeGuard: false, zSmoothing: false,
};
export const SEEDED_DEFAULTS: SeededSettings = {
  method: 'growCut', domain: 'seeded', padXY: 24, padZ: 2, gateOn: false, gateLo: -150, gateHi: 250,
  lambda: 50, sigma: 30,
  smooth: 6, alphaSigma: 30, sweeps: 2, uInt: 0.75, uLoc: 0.25, locality: 0.65, intensity: 0.35, seedBias: 0.9,
  postOn: false, postKeep: 'seed', postMinIsland: 300, postSmooth: 1, postShrinkGrow: 1,
};

export const useOperationSheetStore = create<OperationSheetState>((set) => ({
  openSheet: null,
  collapsed: false,
  cleanupOpId: 'fillHoles',
  params: {},
  scope: { slices: 'current', from: 1, to: 1, labels: 'active' },
  advancedOpen: {},
  message: null,
  intoSegmentIndex: null,
  smartProtect: true,
  smartSafeAction: 'skip',
  planOverrides: {},
  confirmingLeave: false,
  interp: { method: 'sdfArea', distance: 'exact', fill: 'gaps', anchorA: null, anchorB: null },
  setInterp: (patch) => set((s) => ({ interp: { ...s.interp, ...patch }, message: null })),
  prop: { ...PROPAGATE_DEFAULTS },
  setProp: (patch) => set((s) => ({ prop: { ...s.prop, ...patch }, message: null })),
  seeded: { ...SEEDED_DEFAULTS },
  setSeeded: (patch) => set((s) => ({ seeded: { ...s.seeded, ...patch }, message: null })),
  region: {
    mode: 'bounded', labels: null, includeBackground: true,
    iterations: 18, smoothXY: 2.4, dataWeight: 0.002, stay: 0.35, edgeWeight: 0.012, edgeGate: 35, cleanup: 24,
    clipOn: true, clipLo: -150, clipHi: 250, zPad: 2, smoothZ: 1.1, zCoupling: 0.9,
  },
  setRegion: (patch) => set((s) => ({ region: { ...s.region, ...patch }, message: null })),

  openOperation: (openSheet) => set((s) => ({
    openSheet,
    collapsed: false,
    message: s.openSheet === openSheet ? s.message : null,
    confirmingLeave: false,
  })),
  closeSheet: () => set({ openSheet: null, collapsed: false, message: null, confirmingLeave: false }),
  setCollapsed: (collapsed) => set({ collapsed, confirmingLeave: false }),
  setCleanupOp: (cleanupOpId) => set({ cleanupOpId, message: null, planOverrides: {} }),
  setParam: (opId, key, value) => set((s) => ({ params: { ...s.params, [opId]: { ...s.params[opId], [key]: value } }, message: null })),
  moduleParams: {},
  setModuleParam: (moduleId, key, value) => set((s) => ({ moduleParams: { ...s.moduleParams, [moduleId]: { ...s.moduleParams[moduleId], [key]: value } }, message: null })),
  moduleScopes: {},
  setModuleScope: (moduleId, scope) => set((s) => ({ moduleScopes: { ...s.moduleScopes, [moduleId]: scope }, message: null })),
  setScope: (patch) => set((s) => ({ scope: { ...s.scope, ...patch }, message: null, planOverrides: {} })),
  toggleAdvanced: (opId) => set((s) => ({ advancedOpen: { ...s.advancedOpen, [opId]: !s.advancedOpen[opId] } })),
  setMessage: (message) => set({ message }),
  setInto: (intoSegmentIndex) => set({ intoSegmentIndex, message: null }),
  setSmartProtect: (smartProtect) => set({ smartProtect, planOverrides: {}, message: null }),
  setSmartSafeAction: (smartSafeAction) => set({ smartSafeAction, planOverrides: {}, message: null }),
  setPlanOverride: (segmentIndex, action) => set((s) => ({ planOverrides: { ...s.planOverrides, [segmentIndex]: action }, message: null })),
  clearPlanOverrides: () => set({ planOverrides: {} }),
  setConfirmingLeave: (confirmingLeave) => set({ confirmingLeave }),
}));
