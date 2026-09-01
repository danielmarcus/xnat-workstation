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
  /** Cornerstone annotation visibility (drives the member eye icon). Set by syncAnnotations;
   *  optional so existing fixtures need no change — measurementMember defaults it to true. */
  visible?: boolean;
  /** Cornerstone annotation lock state (drives the member lock icon). Defaults to false. */
  locked?: boolean;
  /** The measurement's display color (RGBA), read from the Cornerstone annotation
   *  style. Drives the member color swatch; undefined ⇒ swatch shows grey. */
  color?: [number, number, number, number];
  /** The XNAT session active when this measurement was authored. Drives session-
   *  scoping of the default Measurements container (the explicit-container case uses
   *  the container's own sessionId). Empty/undefined = no session (local fixtures). */
  sessionId?: string;
}

/** A user-created Measurement (SR) container (D7.1). Measurements drawn while it is
 *  the active SR container are routed into it (srAffiliation). */
export interface SrContainerSummary {
  id: string;
  label: string;
  /** The XNAT session this container belongs to, so the panel scopes it to its
   *  session (A13: one study at a time) — mirrors a SEG's xnatOrigin.sessionId.
   *  Empty/undefined = session-agnostic (local fixtures). */
  sessionId?: string;
}

interface AnnotationStore {
  /** All annotation summaries, synced from Cornerstone state */
  annotations: AnnotationSummary[];

  /** Currently selected annotation UID (highlighted on viewport) */
  selectedUID: string | null;

  /** User-created SR (Measurement) containers, newest last (D7.1). */
  srContainers: SrContainerSummary[];
  /** The SR container new measurements route into; null = the default "Measurements". */
  activeSrContainerId: string | null;
  /** annotationUID → SR container id. Set when a measurement is drawn while an SR
   *  container is active; unaffiliated measurements fall into the default container. */
  srAffiliation: Record<string, string>;

  /** Internal: sync annotation list from annotationService. New measurements drawn
   *  while an SR container is active are auto-affiliated to it. */
  _sync: (annotations: AnnotationSummary[]) => void;

  /** Select an annotation by UID (or null to deselect) */
  select: (uid: string | null) => void;

  /** Create a new empty SR container, make it active, and return its id (D7.1).
   *  Pass the current XNAT session so the container is session-scoped in the panel. */
  createSrContainer: (label: string, sessionId?: string) => string;
  /** Rename a created SR container. */
  renameSrContainer: (id: string, label: string) => void;
  /** Remove a created SR container (its measurements fall back to the default). */
  removeSrContainer: (id: string) => void;
  /** Set which SR container new measurements route into (null = default). */
  setActiveSrContainer: (id: string | null) => void;
}

let srCounter = 0;

export const useAnnotationStore = create<AnnotationStore>((set) => ({
  annotations: [],
  selectedUID: null,
  srContainers: [],
  activeSrContainerId: null,
  srAffiliation: {},

  _sync: (annotations) =>
    set((s) => {
      if (!s.activeSrContainerId) return { annotations };
      // Auto-route newly-drawn measurements into the active SR container.
      let affiliation = s.srAffiliation;
      let changed = false;
      for (const a of annotations) {
        if (!(a.annotationUID in affiliation)) {
          if (!changed) { affiliation = { ...affiliation }; changed = true; }
          affiliation[a.annotationUID] = s.activeSrContainerId;
        }
      }
      return changed ? { annotations, srAffiliation: affiliation } : { annotations };
    }),

  select: (uid) => set({ selectedUID: uid }),

  createSrContainer: (label, sessionId) => {
    const id = `sr:local:${++srCounter}`;
    set((s) => ({ srContainers: [...s.srContainers, { id, label, sessionId }], activeSrContainerId: id }));
    return id;
  },

  renameSrContainer: (id, label) =>
    set((s) => ({ srContainers: s.srContainers.map((c) => (c.id === id ? { ...c, label } : c)) })),

  removeSrContainer: (id) =>
    set((s) => {
      const { [id]: _drop, ...restAffiliation } = Object.fromEntries(
        Object.entries(s.srAffiliation).filter(([, srId]) => srId !== id),
      );
      void _drop;
      return {
        srContainers: s.srContainers.filter((c) => c.id !== id),
        activeSrContainerId: s.activeSrContainerId === id ? null : s.activeSrContainerId,
        srAffiliation: restAffiliation,
      };
    }),

  setActiveSrContainer: (id) => set({ activeSrContainerId: id }),
}));
