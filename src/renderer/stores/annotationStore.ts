/**
 * Annotation Store — reactive UI state for annotations/measurements.
 *
 * Cornerstone3D's built-in annotation state is the source of truth.
 * This store holds lightweight summaries synced from Cornerstone events
 * via annotationService, enabling React components to reactively display
 * the annotation list without polling Cornerstone directly.
 */
import { create } from 'zustand';

/** Lightweight summary of a Cornerstone annotation for UI display */
export interface AnnotationSummary {
  annotationUID: string;
  toolName: string;        // Cornerstone tool class name (e.g. 'Length', 'Angle')
  displayName: string;     // Human-readable tool name (e.g. 'Length', 'Ellipse ROI')
  displayText: string;     // Formatted measurement (e.g. '12.5 mm', '45.2°')
  label: string;           // User-provided label (ArrowAnnotate) or empty
}

interface AnnotationStore {
  /** All annotation summaries, synced from Cornerstone state */
  annotations: AnnotationSummary[];

  /** Currently selected annotation UID (highlighted on viewport) */
  selectedUID: string | null;

  /** Whether the annotation list panel is visible */
  showPanel: boolean;

  /** Internal: sync annotation list from annotationService */
  _sync: (annotations: AnnotationSummary[]) => void;

  /** Select an annotation by UID (or null to deselect) */
  select: (uid: string | null) => void;

  /** Toggle annotation list panel visibility */
  togglePanel: () => void;
}

export const useAnnotationStore = create<AnnotationStore>((set) => ({
  annotations: [],
  selectedUID: null,
  showPanel: false,

  _sync: (annotations) => set({ annotations }),

  select: (uid) => set({ selectedUID: uid }),

  togglePanel: () => set((s) => ({ showPanel: !s.showPanel })),
}));
