/**
 * Segmentation toolbox tab + operation sheet state (SegWorks parity D1/D2).
 *
 * The SEG toolbox shows one of four tabs; the Process tab lists operations, and opening
 * one shows its sheet between the member list and the toolbox. Kept in a store (not
 * component state) because hotkeys switch the tab and open sheets too. Parameter values
 * and scope persist per operation for the session, so reopening a sheet resumes where
 * the user left it.
 */
import { create } from 'zustand';
/** Parameter values of one operation (mirrors maskOps/catalog's ParamValues; stores import no lib code). */
type ParamValues = Record<string, number | string>;

export type SegToolboxTab = 'paint' | 'shape' | 'smart' | 'process';
export type OperationSheetId = 'cleanup';

export interface SheetScope {
  slices: 'current' | 'range' | 'volume';
  /** Range ends as the viewport DISPLAYS them (1-based, "8 / 16"). */
  from: number;
  to: number;
  labels: 'active' | 'all';
}

interface OperationSheetState {
  segTab: SegToolboxTab;
  openSheet: OperationSheetId | null;
  cleanupOpId: string;
  /** Parameter values per cleanup op id. */
  params: Record<string, ParamValues>;
  scope: SheetScope;
  /** Advanced section expanded, per op id. */
  advancedOpen: Record<string, boolean>;
  /** One-line in-sheet status (never a toast): "Nothing to change", lock reasons, … */
  message: string | null;
  /** Leaving the sheet with a pending preview asks first, inline. */
  confirmingLeave: boolean;

  setSegTab: (tab: SegToolboxTab) => void;
  openOperation: (id: OperationSheetId) => void;
  closeSheet: () => void;
  setCleanupOp: (opId: string) => void;
  setParam: (opId: string, key: string, value: number | string) => void;
  setScope: (patch: Partial<SheetScope>) => void;
  toggleAdvanced: (opId: string) => void;
  setMessage: (message: string | null) => void;
  setConfirmingLeave: (v: boolean) => void;
}

export const useOperationSheetStore = create<OperationSheetState>((set) => ({
  segTab: 'paint',
  openSheet: null,
  cleanupOpId: 'fillHoles',
  params: {},
  scope: { slices: 'current', from: 1, to: 1, labels: 'active' },
  advancedOpen: {},
  message: null,
  confirmingLeave: false,

  setSegTab: (segTab) => set({ segTab }),
  openOperation: (openSheet) => set({ openSheet, segTab: 'process', message: null, confirmingLeave: false }),
  closeSheet: () => set({ openSheet: null, message: null, confirmingLeave: false }),
  setCleanupOp: (cleanupOpId) => set({ cleanupOpId, message: null }),
  setParam: (opId, key, value) => set((s) => ({ params: { ...s.params, [opId]: { ...s.params[opId], [key]: value } }, message: null })),
  setScope: (patch) => set((s) => ({ scope: { ...s.scope, ...patch }, message: null })),
  toggleAdvanced: (opId) => set((s) => ({ advancedOpen: { ...s.advancedOpen, [opId]: !s.advancedOpen[opId] } })),
  setMessage: (message) => set({ message }),
  setConfirmingLeave: (confirmingLeave) => set({ confirmingLeave }),
}));
