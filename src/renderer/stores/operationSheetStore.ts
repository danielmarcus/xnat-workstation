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

export type OperationSheetId = 'cleanup' | 'interpolate' | 'propagate' | 'qc3d';

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

  /** Open (or expand) an operation. */
  openOperation: (id: OperationSheetId) => void;
  closeSheet: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setCleanupOp: (opId: string) => void;
  setParam: (opId: string, key: string, value: number | string) => void;
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
  prop: {
    direction: 'both', modality: null, huTolerance: 150, sigma: 2, maxSlices: 50, stable: true, growPx: 0,
    maxAreaChangePct: 60, fillHoles: true, edgeGuard: false, zSmoothing: false,
  },
  setProp: (patch) => set((s) => ({ prop: { ...s.prop, ...patch }, message: null })),

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
