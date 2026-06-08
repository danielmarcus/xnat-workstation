/**
 * Unified layout store (Phase 1) — the active viewport-layout preset for the
 * new (multiviewport) path. Pure reactive state (zustand only); preset → panel
 * specs is computed by viewportLayoutService, and useViewportLayout bridges the
 * two for components. (§2: stores import nothing outward.)
 */
import { create } from 'zustand';

export type LayoutPreset = 'single' | 'mpr-2x2';

interface UnifiedLayoutStore {
  preset: LayoutPreset;
  setPreset: (preset: LayoutPreset) => void;
}

export const useUnifiedLayoutStore = create<UnifiedLayoutStore>((set) => ({
  preset: 'single',
  setPreset: (preset) => set({ preset }),
}));
