/**
 * Annotation Service — bridges Cornerstone3D annotation events to the
 * React annotation store (Zustand).
 *
 * Subscribes to ANNOTATION_COMPLETED, ANNOTATION_MODIFIED, ANNOTATION_REMOVED
 * events on the Cornerstone eventTarget. On each event, rebuilds a lightweight
 * summary list from Cornerstone's annotation state and pushes it to the store.
 *
 * Also exposes methods for removing, clearing, and selecting annotations.
 */
import { eventTarget } from '@cornerstonejs/core';
import {
  annotation as csAnnotation,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import { getRenderingEngines } from '@cornerstonejs/core';
import { useAnnotationStore } from '../../stores/annotationStore';
import type { AnnotationSummary } from '../../stores/annotationStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useApprovalStore } from '../../stores/approvalStore';
import { readApprovalFromArrayBuffer } from '../dicom/readApproval';
import { TOOL_DISPLAY_NAMES, ToolName } from '@shared/types/viewer';

type RGBA = [number, number, number, number];

/** annotationUID → the XNAT session active when the measurement was first synced.
 *  Persisted so a measurement keeps its authoring session even after the viewer
 *  switches sessions (drives session-scoping of the default Measurements container). */
const annotationSessionByUid = new Map<string, string>();

/** Cycles the settings color sequence as new measurements get their default color. */
let measurementColorCounter = 0;

function hexToRgba(hex: string): RGBA | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function rgbStringToRgba(s: string | undefined): RGBA | undefined {
  if (!s) return undefined;
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), 255] : undefined;
}

const rgbaToRgbString = (c: RGBA): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** Next default measurement color from the settings color sequence (so a drawn
 *  measurement renders in a real color, not Cornerstone's green-active/yellow-default).
 *  Falls back to red if the sequence is empty/unavailable. */
function nextDefaultMeasurementColor(): RGBA {
  let palette: RGBA[] = [];
  try {
    const seq = usePreferencesStore.getState().preferences?.annotation?.defaultColorSequence ?? [];
    palette = seq.map(hexToRgba).filter((c): c is RGBA => c !== null);
  } catch { /* preferences unavailable — fall through to the fallback */ }
  if (palette.length === 0) return [255, 0, 0, 255];
  return palette[measurementColorCounter++ % palette.length];
}

/** Set a measurement annotation's display color in Cornerstone (all states → one
 *  color, so it's stable while active/selected/locked, not green-then-yellow). */
function applyMeasurementColor(uid: string, rgba: RGBA): void {
  const rgb = rgbaToRgbString(rgba);
  try {
    csAnnotation.config.style.setAnnotationStyles(uid, {
      color: rgb, colorHighlighted: rgb, colorSelected: rgb, colorLocked: rgb,
    } as never);
  } catch (err) {
    console.warn('[annotationService] setAnnotationStyles failed:', err);
  }
}

/** Read a measurement annotation's current display color (rgba) or undefined. */
function readMeasurementColor(uid: string): RGBA | undefined {
  try {
    const styles = (csAnnotation.config.style as {
      getAnnotationToolStyles?: (u: string) => { color?: string } | undefined;
    }).getAnnotationToolStyles?.(uid);
    return rgbStringToRgba(styles?.color);
  } catch {
    return undefined;
  }
}

/** The active XNAT session, mirrored from viewerStore via a runtime subscription set
 *  up in initialize(). Kept as a local (not a static `import { useViewerStore }`) so
 *  this cornerstone service doesn't pull the viewerStore→unifiedToolService→tools
 *  graph into its module load — that coupling broke the service's unit-test mock.
 *  Empty until the subscription is wired (local fixtures / pre-init) ⇒ session-agnostic. */
let currentSessionId = '';

const Events = ToolEnums.Events;

/** Map Cornerstone tool class name → our ToolName enum (for display name lookup) */
const CS_NAME_TO_TOOL_NAME: Record<string, ToolName> = {
  Length: ToolName.Length,
  Angle: ToolName.Angle,
  Bidirectional: ToolName.Bidirectional,
  EllipticalROI: ToolName.EllipticalROI,
  RectangleROI: ToolName.RectangleROI,
  CircleROI: ToolName.CircleROI,
  Probe: ToolName.Probe,
  ArrowAnnotate: ToolName.ArrowAnnotate,
  PlanarFreehandROI: ToolName.PlanarFreehandROI,
};

/**
 * Extract a human-readable measurement string from an annotation's cached stats.
 * Each tool type stores stats differently in `data.cachedStats`.
 */
function formatDisplayText(ann: any): string {
  const toolName = ann.metadata?.toolName ?? '';
  const stats = ann.data?.cachedStats;

  if (!stats) {
    // ArrowAnnotate has no stats
    if (ann.data?.label) return ann.data.label;
    return '';
  }

  // Stats are keyed by targetId — grab the first entry
  const targetIds = Object.keys(stats);
  if (targetIds.length === 0) return '';
  const s = stats[targetIds[0]];
  if (!s) return '';

  switch (toolName) {
    case 'Length':
      return s.length != null ? `${Number(s.length).toFixed(1)} ${s.unit ?? 'mm'}` : '';

    case 'Angle':
      return s.angle != null ? `${Number(s.angle).toFixed(1)}°` : '';

    case 'Bidirectional':
      if (s.length != null && s.width != null) {
        return `${Number(s.length).toFixed(1)} × ${Number(s.width).toFixed(1)} ${s.unit ?? 'mm'}`;
      }
      return '';

    case 'EllipticalROI':
    case 'RectangleROI':
    case 'PlanarFreehandROI': {
      const parts: string[] = [];
      if (s.area != null) parts.push(`${Number(s.area).toFixed(1)} ${s.areaUnit ?? 'mm²'}`);
      if (s.mean != null) parts.push(`μ=${Number(s.mean).toFixed(1)}`);
      return parts.join(', ');
    }

    case 'CircleROI': {
      const parts: string[] = [];
      if (s.area != null) parts.push(`${Number(s.area).toFixed(1)} ${s.areaUnit ?? 'mm²'}`);
      if (s.radius != null) parts.push(`r=${Number(s.radius).toFixed(1)} ${s.radiusUnit ?? 'mm'}`);
      if (s.mean != null) parts.push(`μ=${Number(s.mean).toFixed(1)}`);
      return parts.join(', ');
    }

    case 'Probe':
      return s.value != null ? `${Number(s.value).toFixed(1)} ${s.Modality === 'CT' ? 'HU' : ''}`.trim() : '';

    default:
      return '';
  }
}

/**
 * Rebuild annotation summaries from Cornerstone's global annotation state
 * and push to the Zustand store.
 */
function syncAnnotations(): void {
  try {
    const allAnnotations = csAnnotation.state.getAllAnnotations();
    const summaries: AnnotationSummary[] = [];

    for (const ann of allAnnotations) {
      const toolName = ann.metadata?.toolName ?? '';
      // Only include our annotation tools (skip internal tools like CrosshairsTool, etc.)
      if (!(toolName in CS_NAME_TO_TOOL_NAME)) continue;

      const tn = CS_NAME_TO_TOOL_NAME[toolName];
      const uid = ann.annotationUID ?? '';
      // Record the authoring session once (first sight); reuse thereafter so the
      // measurement keeps its session across later viewer session switches.
      if (uid && !annotationSessionByUid.has(uid)) annotationSessionByUid.set(uid, currentSessionId);
      // Resolve the measurement's color: a user/previously-assigned style, else assign
      // one from the settings sequence on first sight (so it's not green/yellow default).
      let color = uid ? readMeasurementColor(uid) : undefined;
      if (uid && !color) {
        color = nextDefaultMeasurementColor();
        applyMeasurementColor(uid, color);
      }
      summaries.push({
        annotationUID: uid,
        toolName,
        displayName: tn ? TOOL_DISPLAY_NAMES[tn] : toolName,
        displayText: formatDisplayText(ann),
        label: ann.data?.label ?? '',
        // Source the member eye/lock icons from the live Cornerstone annotation state.
        visible: uid ? csAnnotation.visibility.isAnnotationVisible(uid) !== false : true,
        locked: uid ? csAnnotation.locking.isAnnotationLocked(uid) === true : false,
        sessionId: uid ? annotationSessionByUid.get(uid) : undefined,
        color,
      });
    }

    useAnnotationStore.getState()._sync(summaries);
  } catch (err) {
    console.error('[annotationService] Failed to sync annotations:', err);
  }
}

/**
 * Mark the SR (Measurement) container a just-changed measurement belongs to as
 * dirty, so the per-container Save icon enables + autosave fires (the save/autosave
 * paths are dirty-gated). Resolve the container from the affiliation map (set by
 * _sync for new measurements) → active SR container → the default "Measurements".
 * Only our measurement tools count (skip crosshairs/etc.). dirty is cleared
 * generically on save success (segmentationService onPhase 'idle' → clearDirty).
 */
function markSrContainerDirty(evt: Event): void {
  try {
    const ann = (evt as CustomEvent<{ annotation?: { annotationUID?: string; metadata?: { toolName?: string } } }>)
      .detail?.annotation;
    const uid = ann?.annotationUID;
    const toolName = ann?.metadata?.toolName ?? '';
    if (!uid || !(toolName in CS_NAME_TO_TOOL_NAME)) return;
    const { srAffiliation, activeSrContainerId } = useAnnotationStore.getState();
    const containerId = srAffiliation[uid] ?? activeSrContainerId ?? 'sr:measurements';
    useSegmentationManagerStore.getState().markDirty(containerId);
  } catch (err) {
    console.warn('[annotationService] markSrContainerDirty failed:', err);
  }
}

/** Re-render all viewports so an annotation visibility/lock/label change shows
 *  immediately (these mutations don't emit a Cornerstone event that repaints). */
function renderAnnotations(): void {
  try {
    for (const engine of getRenderingEngines() ?? []) engine?.render();
  } catch {
    /* no engine yet — nothing to repaint */
  }
}

/** Event handler — sync on any annotation change, then mark its SR container dirty. */
function onAnnotationEvent(evt: Event): void {
  syncAnnotations(); // assigns affiliation for a new measurement UID first
  markSrContainerDirty(evt); // …then the affiliation resolves to the right container
}

function onAnnotationSelectionChange(evt: Event): void {
  const detail = (evt as CustomEvent<{ selection?: string[] }>).detail;
  const selection = Array.isArray(detail?.selection) ? detail.selection : [];
  const selectedUid = selection.length > 0 ? selection[selection.length - 1] ?? null : null;
  annotationService.selectAnnotation(selectedUid);
}

let initialized = false;

export const annotationService = {
  /**
   * Subscribe to Cornerstone annotation events.
   * Call once after toolService.initialize().
   */
  initialize(): void {
    if (initialized) return;

    eventTarget.addEventListener(Events.ANNOTATION_COMPLETED, onAnnotationEvent);
    eventTarget.addEventListener(Events.ANNOTATION_MODIFIED, onAnnotationEvent);
    eventTarget.addEventListener(Events.ANNOTATION_REMOVED, onAnnotationEvent);
    eventTarget.addEventListener(Events.ANNOTATION_SELECTION_CHANGE, onAnnotationSelectionChange);

    // Mirror the active session for measurement session-scoping. Dynamic import keeps
    // viewerStore (and its tool graph) out of this module's static import graph.
    void import('../../stores/viewerStore')
      .then(({ useViewerStore }) => {
        currentSessionId = useViewerStore.getState().sessionId ?? '';
        useViewerStore.subscribe((s) => { currentSessionId = s.sessionId ?? ''; });
      })
      .catch(() => { /* viewerStore unavailable (tests) — session stays agnostic */ });

    initialized = true;
    console.log('[annotationService] Initialized — listening for annotation events');
  },

  /**
   * Remove a single annotation by UID.
   * Removes from Cornerstone state and re-syncs the store.
   */
  removeAnnotation(uid: string): void {
    try {
      csAnnotation.state.removeAnnotation(uid);
      annotationSessionByUid.delete(uid);
      syncAnnotations();
      // Repaint so the deleted measurement actually leaves the viewport — removeAnnotation
      // mutates state but emits no render event, so without this the SVG overlay lingers.
      renderAnnotations();
    } catch (err) {
      console.error('[annotationService] Failed to remove annotation:', err);
    }
  },

  /** Set a measurement annotation's display color by UID (member color swatch),
   *  then re-sync (swatch reflects it) + repaint (the drawn measurement recolors). */
  setAnnotationColor(uid: string, color: RGBA): void {
    try {
      applyMeasurementColor(uid, color);
      syncAnnotations();
      renderAnnotations();
    } catch (err) {
      console.error('[annotationService] Failed to set annotation color:', err);
    }
  },

  /** Rename a measurement annotation (sets its label) by UID, then re-sync. */
  setAnnotationLabel(uid: string, label: string): void {
    try {
      const ann = csAnnotation.state.getAnnotation(uid);
      if (ann) {
        ann.data = ann.data ?? {};
        (ann.data as { label?: string }).label = label;
        syncAnnotations();
        renderAnnotations();
      }
    } catch (err) {
      console.error('[annotationService] Failed to set annotation label:', err);
    }
  },

  /** Show/hide a measurement annotation by UID (member eye icon), then re-sync. */
  setAnnotationVisibility(uid: string, visible: boolean): void {
    try {
      csAnnotation.visibility.setAnnotationVisibility(uid, visible);
      syncAnnotations();
      renderAnnotations();
    } catch (err) {
      console.error('[annotationService] Failed to set annotation visibility:', err);
    }
  },

  /** Lock/unlock a measurement annotation by UID (member lock icon), then re-sync. */
  setAnnotationLocked(uid: string, locked: boolean): void {
    try {
      csAnnotation.locking.setAnnotationLocked(uid, locked);
      syncAnnotations();
      renderAnnotations();
    } catch (err) {
      console.error('[annotationService] Failed to set annotation lock:', err);
    }
  },

  /**
   * Remove all annotations from Cornerstone state and re-sync.
   */
  removeAllAnnotations(): void {
    try {
      csAnnotation.state.removeAllAnnotations();
      annotationSessionByUid.clear();
      measurementColorCounter = 0;
      syncAnnotations();
    } catch (err) {
      console.error('[annotationService] Failed to clear annotations:', err);
    }
  },

  /**
   * Select/highlight an annotation on the viewport.
   * Sets `highlighted` on the target annotation and clears others.
   */
  selectAnnotation(uid: string | null): void {
    try {
      const allAnnotations = csAnnotation.state.getAllAnnotations();
      for (const ann of allAnnotations) {
        ann.highlighted = ann.annotationUID === uid;
      }
      useAnnotationStore.getState().select(uid);
    } catch (err) {
      console.error('[annotationService] Failed to select annotation:', err);
    }
  },

  /**
   * Load measurements from a DICOM-SR ArrayBuffer into a NEW SR (Measurement)
   * container (SR-D import — the production reload path, used by App.tsx for both
   * the local-file and XNAT-scan SR routes). Reconstructs the annotations
   * (srImport, adapter-owned), affiliates them with the container, re-syncs the
   * panel, and clears the load-induced dirty (a reload is not a local edit). If the
   * SR carried no reconstructable measurements the empty container is dropped.
   * Returns the container id and the number of measurements loaded.
   */
  async loadMeasurementsFromArrayBuffer(
    arrayBuffer: ArrayBuffer,
    sourceImageIds: string[],
    options: { label?: string; xnatScanId?: string } = {},
  ): Promise<{ containerId: string; count: number }> {
    // Lazy-load srImport so the heavy @cornerstonejs/adapters package (which runs
    // module-init side effects against @cornerstonejs/core) is only pulled in when an
    // SR is actually imported — not at annotationService module-load time.
    const { importMeasurementsFromDicomSr } = await import('./srImport');
    const store = useAnnotationStore.getState();
    const containerId = store.createSrContainer(
      options.label ?? 'Measurements',
      currentSessionId || undefined,
      options.xnatScanId,
    );
    const addedUIDs = importMeasurementsFromDicomSr(arrayBuffer, sourceImageIds);

    if (addedUIDs.length === 0) {
      store.removeSrContainer(containerId);
      syncAnnotations();
      return { containerId, count: 0 };
    }

    // Deterministically affiliate the reconstructed annotations with the container
    // (createSrContainer made it active, so syncAnnotations would also auto-route
    // them — this makes the mapping explicit and load-order-independent).
    useAnnotationStore.setState((s) => {
      const aff = { ...s.srAffiliation };
      for (const uid of addedUIDs) aff[uid] = containerId;
      return { srAffiliation: aff };
    });
    syncAnnotations();
    useSegmentationManagerStore.getState().clearDirty(containerId);
    // D7.11: an SR saved as approved arrives edit-locked.
    useApprovalStore.getState().seedApproval(containerId, readApprovalFromArrayBuffer(arrayBuffer));
    return { containerId, count: addedUIDs.length };
  },

  /**
   * Force a re-sync of annotation summaries (e.g. after viewport changes).
   */
  sync: syncAnnotations,

  /**
   * Remove event listeners and clean up.
   */
  dispose(): void {
    if (!initialized) return;

    eventTarget.removeEventListener(Events.ANNOTATION_COMPLETED, onAnnotationEvent);
    eventTarget.removeEventListener(Events.ANNOTATION_MODIFIED, onAnnotationEvent);
    eventTarget.removeEventListener(Events.ANNOTATION_REMOVED, onAnnotationEvent);
    eventTarget.removeEventListener(Events.ANNOTATION_SELECTION_CHANGE, onAnnotationSelectionChange);

    initialized = false;
    console.log('[annotationService] Disposed');
  },
};
