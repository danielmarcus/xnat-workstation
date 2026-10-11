/**
 * The 3D QC sheet's state (SegWorks parity branch 7, D9): render settings, the component
 * report from the last build, what is hidden or selected, and the layout to restore when
 * the sheet closes. The meshes and vtk actors live in lib/cornerstone/qc3dService.
 */
import { create } from 'zustand';
import type { UnifiedLayout } from './unifiedLayoutStore';

export interface Qc3dSettings {
  resolution: 128 | 192 | 256;
  renderer: 'blocky' | 'smooth';
  /** Taubin iterations (0 = off). */
  smoothIterations: number;
  thinBoost: boolean;
  /** A component this size or smaller (voxels) is a stray island; this or smaller, a speck. */
  strayVoxels: number;
  speckVoxels: number;
  showStrays: boolean;
  hideLargest: boolean;
  /** Surface lighting, 0–1. */
  brightness: number;
  ambient: number;
  autoRotate: boolean;
}

/** One component in the report (index space unless noted). */
export interface Qc3dComponentRow {
  id: number;
  voxels: number;
  volumeCc: number;
  bbox: [number, number, number, number, number, number];
  centroidWorld: [number, number, number];
}

export interface Qc3dLabelReport {
  segmentIndex: number;
  label: string;
  color: [number, number, number];
  components: Qc3dComponentRow[];
}

interface Qc3dState {
  settings: Qc3dSettings;
  /** The container the surfaces were built from. */
  containerId: string | null;
  report: Qc3dLabelReport[];
  /** A build in progress (0–1), or null. */
  building: number | null;
  /** The labelmap changed since the last build. */
  stale: boolean;
  hiddenSegments: number[];
  selected: { segmentIndex: number; componentId: number } | null;
  /** The layout the sheet replaced; restored on close. */
  restoreLayout: UnifiedLayout | null;
  message: string | null;
  setSettings: (p: Partial<Qc3dSettings>) => void;
  set: (p: Partial<Omit<Qc3dState, 'settings' | 'setSettings' | 'set'>>) => void;
}

export const DEFAULT_QC3D_SETTINGS: Qc3dSettings = {
  resolution: 192, renderer: 'smooth', smoothIterations: 10, thinBoost: false,
  strayVoxels: 500, speckVoxels: 20, showStrays: true, hideLargest: false,
  brightness: 0.8, ambient: 0.25, autoRotate: false,
};

export const useQc3dStore = create<Qc3dState>((set) => ({
  settings: DEFAULT_QC3D_SETTINGS,
  containerId: null,
  report: [],
  building: null,
  stale: false,
  hiddenSegments: [],
  selected: null,
  restoreLayout: null,
  message: null,
  setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  set: (p) => set(p),
}));
