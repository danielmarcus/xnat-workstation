/**
 * Contour-clipboard subsystem for the segmentation service.
 *
 * Owns the in-memory clipboard for copy/paste of contour-segmentation
 * annotations (Ctrl-C / Ctrl-V via the hotkey service), the geometry
 * helpers used to translate them across slices, and the selection-sync
 * handler that keeps the active container/segment in step with the user's
 * canvas-side annotation selection.
 *
 * Extracted from segmentationService.ts (Phase 0.5.B).
 *
 * Service-layer dependencies are injected via `wireContourClipboard()` to
 * avoid a circular import with segmentationService.ts. The orchestrator
 * calls `wireContourClipboard()` once during `segmentationService.initialize()`.
 *
 * What lives here:
 *   - The `contourClipboard` module-state.
 *   - Pure Point3 math helpers (toPoint3, addPoint3, ...).
 *   - Predicates and accessors (isContourAnnotation, getSelectedContourAnnotation).
 *   - Image-plane / viewport-context resolution helpers used by paste.
 *   - The history-memo push that lets undo/redo reverse a paste.
 *   - The exported `copySelected()`, `pasteToActiveSlice()`,
 *     `syncSelectedContourAnnotation()` entry points consumed by the
 *     orchestrator.
 *
 * What does NOT live here (kept in the orchestrator and injected):
 *   - `getSegmentationType` (used widely outside this subsystem).
 *   - `getSegmentLocked`, `setActiveSegmentIndex`, `activateOnViewport`
 *     (orchestrator service methods).
 *   - `syncSegmentations`, `refreshUndoState`, `scheduleAutoSave`,
 *     `renderAllSegmentationViewports` (orchestrator-private functions).
 */
import {
  cache,
  eventTarget,
  metaData,
  utilities as csUtilities,
  getEnabledElementByViewportId,
} from '@cornerstonejs/core';
import type { Types as CoreTypes } from '@cornerstonejs/core';
import {
  annotation as csAnnotation,
  segmentation as csSegmentation,
  Enums as ToolEnums,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { useViewerStore } from '../../../stores/viewerStore';
import { useSegmentationManagerStore } from '../../../stores/segmentationManagerStore';
import * as contourRep from '../contourRepresentation';
import { getSegmentDisplayLabel } from './historyMemo';
import { resolveContourChainInterpolationUIDWithDeps } from './contourClipboard.helpers';

// `cache` is imported for parity with segmentationService.ts; not currently
// referenced here but kept available so future paste-time image lookups
// don't need a follow-up import dance.
void cache;

// ─── Types ───────────────────────────────────────────────────────

export type Point3 = CoreTypes.Point3;

interface ContourClipboardEntry {
  toolName: string;
  segmentationId: string;
  segmentIndex: number;
  referencedImageId: string;
  frameOfReferenceUID: string | null;
  /**
   * Rendered polyline in world coordinates. For freehand sources this is
   * the source of truth; for spline sources it is a fallback used only if
   * spline reconstruction fails.
   */
  polyline: Point3[];
  closed: boolean;
  handles: Record<string, unknown> | null;
  /**
   * Spline-specific reconstruction data. Populated iff the source
   * annotation was drawn with a spline tool (i.e. its `data.spline` field
   * was present). Cornerstone's `SplineROITool.renderAnnotationInstance`
   * requires `data.spline.{type,instance}` to exist at render time and
   * regenerates the rendered polyline from `data.handles.points` on every
   * render. To roundtrip a spline we therefore need to capture:
   *   - the spline type string,
   *   - a constructor reference (to build a fresh instance on paste),
   *   - the control points in world coordinates (the real source of truth).
   * The constructor is pulled from `instance.constructor` at copy time so
   * we don't depend on Cornerstone's private `_getSplineConfig` API.
   */
  spline: {
    type: string;
    resolution: unknown;
    SplineClass: new () => unknown;
    controlPointsWorld: Point3[];
  } | null;
}

let contourClipboard: ContourClipboardEntry | null = null;

// ─── Dependency injection ────────────────────────────────────────

/**
 * Service-layer dependencies the clipboard module needs from the
 * orchestrator. Wired once at init via `wireContourClipboard`.
 */
export interface ContourClipboardDeps {
  getSegmentationType: (segmentationId: string) => 'labelmap' | 'contour' | 'both';
  getSegmentLocked: (segmentationId: string, segmentIndex: number) => boolean;
  setActiveSegmentIndex: (segmentationId: string, segmentIndex: number) => void;
  activateOnViewport: (viewportId: string, segmentationId: string) => void;
  syncSegmentations: () => void;
  refreshUndoState: () => void;
  scheduleAutoSave: () => void;
  renderAllSegmentationViewports: () => void;
}

/**
 * Default no-op stubs. Replaced by `wireContourClipboard`. Keeping
 * defaults means a missing wireup fails noisily on first paste rather
 * than throwing during module load.
 */
let deps: ContourClipboardDeps = {
  getSegmentationType: () => 'labelmap',
  getSegmentLocked: () => false,
  setActiveSegmentIndex: () => {},
  activateOnViewport: () => {},
  syncSegmentations: () => {},
  refreshUndoState: () => {},
  scheduleAutoSave: () => {},
  renderAllSegmentationViewports: () => {},
};

export function wireContourClipboard(injected: ContourClipboardDeps): void {
  deps = injected;
}

// ─── Point3 math ─────────────────────────────────────────────────

export function toPoint3(value: unknown): Point3 | null {
  // Accept both regular arrays and typed-array-like inputs. Cornerstone's
  // contour-interpolation pipeline emits polyline points as Float32Array(3)
  // via gl-matrix's vec3.create(), which `Array.isArray` rejects. Anything
  // with a numeric `length >= 3` and indexable numeric entries 0/1/2 is a
  // valid Point3 source (regular arrays, Float32Array, Float64Array, etc.).
  if (value == null || typeof value !== 'object') return null;
  const view = value as ArrayLike<unknown>;
  if (typeof view.length !== 'number' || view.length < 3) return null;
  const x = Number(view[0]);
  const y = Number(view[1]);
  const z = Number(view[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z] as Point3;
}

export function addPoint3(a: Point3, b: Point3): Point3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Point3;
}

function subtractPoint3(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as Point3;
}

function dotPoint3(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossPoint3(a: Point3, b: Point3): Point3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ] as Point3;
}

function normalizePoint3(point: Point3): Point3 | null {
  const magnitude = Math.hypot(point[0], point[1], point[2]);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return [point[0] / magnitude, point[1] / magnitude, point[2] / magnitude] as Point3;
}

/**
 * Production-wired wrapper of `resolveContourChainInterpolationUIDWithDeps`
 * (defined in `./contourClipboard.helpers`). Reads from Cornerstone's
 * annotation state and uses its uuidv4 helper.
 */
export function resolveContourChainInterpolationUID(params: {
  segmentationId: string;
  segmentIndex: number;
  viewPlaneNormal: Point3 | undefined;
  viewUp: Point3 | undefined;
}): string {
  return resolveContourChainInterpolationUIDWithDeps(params, {
    getAllAnnotations: () =>
      (csAnnotation.state as { getAllAnnotations?: () => unknown[] }).getAllAnnotations?.() ?? [],
    mintUID: () => csUtilities.uuidv4(),
  });
}

// ─── Polyline / handle helpers ───────────────────────────────────

function clonePolyline(polyline: unknown): Point3[] {
  if (!Array.isArray(polyline)) return [];
  return polyline
    .map((point) => toPoint3(point))
    .filter((point): point is Point3 => point !== null);
}

function cloneHandlesWithOffset(handles: unknown, delta: Point3): Record<string, unknown> | null {
  if (!handles || typeof handles !== 'object') return null;

  const next: Record<string, unknown> = { ...(handles as Record<string, unknown>) };
  const rawPoints = (handles as { points?: unknown[] }).points;
  if (Array.isArray(rawPoints)) {
    next.points = rawPoints.map((point) => {
      const normalized = toPoint3(point);
      return normalized ? addPoint3(normalized, delta) : point;
    });
  }

  const textBox = (handles as { textBox?: Record<string, unknown> }).textBox;
  if (textBox && typeof textBox === 'object') {
    const nextTextBox: Record<string, unknown> = { ...textBox };
    const worldPosition = toPoint3(textBox.worldPosition);
    if (worldPosition) {
      nextTextBox.worldPosition = addPoint3(worldPosition, delta);
    }
    const worldBoundingBox = textBox.worldBoundingBox;
    if (worldBoundingBox && typeof worldBoundingBox === 'object') {
      const nextBoundingBox: Record<string, unknown> = { ...worldBoundingBox };
      for (const key of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) {
        const normalized = toPoint3((worldBoundingBox as Record<string, unknown>)[key]);
        if (normalized) {
          nextBoundingBox[key] = addPoint3(normalized, delta);
        }
      }
      nextTextBox.worldBoundingBox = nextBoundingBox;
    }
    next.textBox = nextTextBox;
  }

  return next;
}

// ─── Tool-event emit + contour-rep wrappers ──────────────────────

function emitToolEvent(type: string, detail: Record<string, unknown>): void {
  const target = eventTarget as EventTarget & {
    dispatch?: (eventType: string, eventDetail?: unknown) => void;
  };

  if (typeof target.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    target.dispatchEvent(new CustomEvent(type, { detail }));
    return;
  }

  target.dispatch?.(type, detail);
}

function addContourAnnotationToSegmentation(annotation: any): void {
  contourRep.addAnnotation(annotation);
}

function removeContourAnnotationFromSegmentation(annotation: any): void {
  contourRep.removeAnnotation(annotation);
}

// ─── Identity / selection helpers ────────────────────────────────

/**
 * Identity predicate for contour-segmentation annotations.
 *
 * Delegates tool-class + segmentation-metadata checks to
 * `contourRep.isContourSegmentationAnnotation`. Intentionally does NOT
 * check polyline length — callers that need a drawable/copyable shape
 * (e.g. `copySelected()`) must enforce `polyline.length >= 3`
 * themselves.
 *
 * Prior behavior: required `polyline.length >= 3`. That check caused
 * in-progress contours (splines mid-draw, freehand before the 3rd point)
 * to be silently treated as "not a contour", skipping selection sync and
 * other bookkeeping. The check moved to callers that actually need
 * completeness.
 */
export function isContourAnnotation(annotation: any): annotation is {
  annotationUID: string;
  metadata: { toolName?: string; referencedImageId?: string; FrameOfReferenceUID?: string };
  data: {
    contour?: { polyline?: unknown[]; closed?: boolean };
    segmentation?: { segmentationId?: string; segmentIndex?: number };
    handles?: Record<string, unknown>;
  };
} {
  return contourRep.isContourSegmentationAnnotation(annotation);
}

function getSelectedContourAnnotation(): {
  annotationUID: string;
  annotation: any;
} | null {
  const selected = csAnnotation.selection.getAnnotationsSelected?.() ?? [];
  for (let i = selected.length - 1; i >= 0; i--) {
    const annotationUID = selected[i];
    const annotation = csAnnotation.state.getAnnotation?.(annotationUID);
    if (!isContourAnnotation(annotation)) continue;
    return { annotationUID, annotation };
  }
  return null;
}

// ─── Image-plane / viewport-context resolution ───────────────────

function getCurrentImageIdForActiveViewport(): string | null {
  const viewerState = useViewerStore.getState();
  const viewportId = viewerState.activeViewportId;
  const enabledElement = getEnabledElementByViewportId(viewportId) as
    | { viewport?: { getCurrentImageId?: () => string | undefined } }
    | undefined;
  const currentImageId = enabledElement?.viewport?.getCurrentImageId?.();
  if (typeof currentImageId === 'string' && currentImageId.length > 0) {
    return currentImageId;
  }

  const imageIds = viewerState.panelImageIdsMap[viewportId];
  if (!Array.isArray(imageIds) || imageIds.length === 0) return null;

  const viewportState = viewerState.viewports[viewportId];
  const requestedIndex = viewportState?.requestedImageIndex;
  const currentIndex = viewportState?.imageIndex ?? 0;
  const index = Number.isInteger(requestedIndex) ? requestedIndex : currentIndex;
  const clamped = Math.max(0, Math.min(imageIds.length - 1, index));
  return imageIds[clamped] ?? null;
}

function getActiveViewportContextForContourPaste(targetImageId: string): {
  viewportId: string;
  annotationGroupSelector: unknown;
  viewport:
    | {
        element?: Element;
        getCurrentImageIdIndex?: () => number;
        getViewReference?: (options?: { sliceIndex?: number }) => Record<string, unknown> | undefined;
        getCamera?: () => { viewPlaneNormal?: unknown; viewUp?: unknown } | undefined;
        render?: () => void;
      }
    | null;
  metadata: Record<string, unknown>;
} | null {
  const viewportId = useViewerStore.getState().activeViewportId;
  if (!viewportId) return null;

  const enabledElement = getEnabledElementByViewportId(viewportId) as
    | {
      viewport?: {
        element?: Element;
        getCurrentImageIdIndex?: () => number;
        getViewReference?: (options?: { sliceIndex?: number }) => Record<string, unknown> | undefined;
        getCamera?: () => { viewPlaneNormal?: unknown; viewUp?: unknown } | undefined;
        render?: () => void;
      };
      }
    | undefined;
  const viewport = enabledElement?.viewport ?? null;
  const storeSliceIndex = useViewerStore.getState().viewports[viewportId]?.imageIndex;
  const sliceIndex = viewport?.getCurrentImageIdIndex?.();
  const normalizedSliceIndex = Number.isInteger(sliceIndex)
    ? Number(sliceIndex)
    : (Number.isInteger(storeSliceIndex) ? Number(storeSliceIndex) : null);
  const viewReference = normalizedSliceIndex != null
    ? viewport?.getViewReference?.({ sliceIndex: normalizedSliceIndex })
    : viewport?.getViewReference?.();
  const camera = viewport?.getCamera?.();
  const imagePlane = getImagePlaneInfo(targetImageId);

  const metadata: Record<string, unknown> = {
    referencedImageId: targetImageId,
  };

  const frameOfReferenceUID =
    imagePlane?.frameOfReferenceUID
    ?? (typeof viewReference?.FrameOfReferenceUID === 'string' ? viewReference.FrameOfReferenceUID : null);
  if (frameOfReferenceUID) {
    metadata.FrameOfReferenceUID = frameOfReferenceUID;
  }

  const viewPlaneNormal =
    toPoint3((viewReference as { viewPlaneNormal?: unknown } | undefined)?.viewPlaneNormal)
    ?? toPoint3(camera?.viewPlaneNormal);
  if (viewPlaneNormal) {
    metadata.viewPlaneNormal = viewPlaneNormal;
  }

  const viewUp =
    toPoint3((viewReference as { viewUp?: unknown } | undefined)?.viewUp)
    ?? toPoint3(camera?.viewUp);
  if (viewUp) {
    metadata.viewUp = viewUp;
  }

  const referencedSliceIndex = Number.isInteger((viewReference as { sliceIndex?: unknown } | undefined)?.sliceIndex)
    ? Number((viewReference as { sliceIndex?: number }).sliceIndex)
    : normalizedSliceIndex;
  if (referencedSliceIndex != null) {
    metadata.sliceIndex = referencedSliceIndex;
  }

  return {
    viewportId,
    annotationGroupSelector: viewport?.element ?? viewportId,
    viewport,
    metadata,
  };
}

function getImagePlaneInfo(imageId: string): {
  imagePositionPatient: Point3;
  normal: Point3;
  frameOfReferenceUID: string | null;
} | null {
  const plane = metaData.get('imagePlaneModule', imageId) as
    | {
        imagePositionPatient?: unknown;
        rowCosines?: unknown;
        columnCosines?: unknown;
        frameOfReferenceUID?: string;
      }
    | undefined;
  const imagePositionPatient = toPoint3(plane?.imagePositionPatient);
  const rowCosines = toPoint3(plane?.rowCosines);
  const columnCosines = toPoint3(plane?.columnCosines);
  if (!imagePositionPatient || !rowCosines || !columnCosines) return null;

  const normal = normalizePoint3(crossPoint3(rowCosines, columnCosines));
  if (!normal) return null;

  return {
    imagePositionPatient,
    normal,
    frameOfReferenceUID: plane?.frameOfReferenceUID ?? null,
  };
}

// ─── Paste history-memo ──────────────────────────────────────────

const { DefaultHistoryMemo } = (csUtilities as any).HistoryMemo;

function pushContourPasteHistoryMemo(annotation: any, annotationGroupSelector: unknown, viewportId: string): void {
  const segmentationId = annotation?.data?.segmentation?.segmentationId;
  const segmentIndex = Number(annotation?.data?.segmentation?.segmentIndex);
  if (!segmentationId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) {
    return;
  }

  let deleting = false;
  DefaultHistoryMemo?.push?.({
    id: annotation.annotationUID,
    operationType: 'annotation',
    segmentationId,
    segmentIndex,
    label: getSegmentDisplayLabel(segmentationId, segmentIndex),
    restoreMemo: () => {
      if (!deleting) {
        deleting = true;
        const currentAnnotation = csAnnotation.state.getAnnotation?.(annotation.annotationUID) ?? annotation;
        currentAnnotation.highlighted = false;
        currentAnnotation.isSelected = false;
        removeContourAnnotationFromSegmentation(currentAnnotation);
        csAnnotation.selection.setAnnotationSelected?.(annotation.annotationUID, false, false);
        csAnnotation.state.removeAnnotation(annotation.annotationUID);
        return;
      }

      deleting = false;
      annotation.highlighted = true;
      annotation.isSelected = true;
      annotation.invalidated = true;
      addContourAnnotationToSegmentation(annotation);
      csAnnotation.state.addAnnotation?.(annotation, annotationGroupSelector as any);
      csAnnotation.selection.setAnnotationSelected?.(annotation.annotationUID, true, false);
      useSegmentationStore.getState().setActiveSegmentation(segmentationId);
      csSegmentation.segmentIndex.setActiveSegmentIndex?.(segmentationId, segmentIndex);
      try {
        csSegmentation.activeSegmentation.setActiveSegmentation?.(viewportId, segmentationId);
      } catch (err) {
        console.debug('[segmentationService] Failed to reactivate pasted contour segmentation:', err);
      }
      emitToolEvent(ToolEnums.Events.ANNOTATION_COMPLETED, { annotation });
    },
  });
}

// ─── Public entry points (consumed by the orchestrator) ──────────

/**
 * Copy the currently selected contour annotation component.
 * Returns true when a contour annotation is available for paste.
 */
export function copySelected(): boolean {
  const selected = getSelectedContourAnnotation();
  if (!selected) {
    return false;
  }

  const { annotation } = selected;
  const segmentationId = annotation.data.segmentation.segmentationId!;
  const segmentIndex = Number(annotation.data.segmentation.segmentIndex);
  const referencedImageId = annotation.metadata?.referencedImageId;
  if (
    typeof referencedImageId !== 'string' ||
    referencedImageId.length === 0 ||
    !Number.isInteger(segmentIndex) ||
    segmentIndex <= 0
  ) {
    console.debug('[segmentationService] copy: missing required metadata', {
      referencedImageId,
      segmentIndex,
      segmentationId,
      toolName: annotation.metadata?.toolName,
    });
    return false;
  }

  // Completeness guard: copy requires a drawable polyline.
  const polyline = clonePolyline(annotation.data.contour?.polyline);
  if (polyline.length < 3) {
    const raw = annotation.data.contour?.polyline;
    console.debug('[segmentationService] copy: polyline too short', {
      polylineLength: polyline.length,
      rawPolylineIsArray: Array.isArray(raw),
      rawPolylineLength: Array.isArray(raw) ? raw.length : 'n/a',
      rawFirstEntry: Array.isArray(raw) && raw.length > 0 ? raw[0] : 'n/a',
      toolName: annotation.metadata?.toolName,
      annotationUID: annotation.annotationUID,
      autoGenerated: annotation.autoGenerated,
      interpolationUID: annotation.interpolationUID,
      parentAnnotationUID: annotation.parentAnnotationUID,
      isLocked: annotation.isLocked,
      handlesPoints: (annotation.data?.handles as any)?.points?.length,
      contourClosed: annotation.data.contour?.closed,
      referencedImageId: annotation.metadata?.referencedImageId,
      sliceIndex: annotation.metadata?.sliceIndex,
    });
    return false;
  }

  // Capture spline-specific reconstruction data if the source is a spline.
  // Presence of `data.spline.instance` is the identity marker (Cornerstone's
  // SplineROITool sets it in `addNewAnnotation`/`createAnnotation`). Without
  // this, pasting a spline-tool annotation used to throw on render because
  // paste built an annotation missing `data.spline`.
  const sourceSpline = (annotation.data as any)?.spline;
  const sourceControlPoints = (annotation.data?.handles as { points?: unknown })?.points;
  const splineInstance = sourceSpline?.instance;
  const splineConstructor = splineInstance?.constructor as (new () => unknown) | undefined;
  const controlPointsWorld = Array.isArray(sourceControlPoints)
    ? (sourceControlPoints.map(toPoint3).filter((p): p is Point3 => p !== null))
    : [];
  const spline = splineInstance
    && typeof splineConstructor === 'function'
    && typeof sourceSpline.type === 'string'
    && controlPointsWorld.length >= 3
    ? {
        type: sourceSpline.type as string,
        resolution: sourceSpline.resolution,
        SplineClass: splineConstructor,
        controlPointsWorld,
      }
    : null;

  contourClipboard = {
    toolName: annotation.metadata?.toolName ?? 'PlanarFreehandContourSegmentationTool',
    segmentationId,
    segmentIndex,
    referencedImageId,
    frameOfReferenceUID: annotation.metadata?.FrameOfReferenceUID ?? null,
    polyline,
    closed: annotation.data.contour?.closed !== false,
    handles: cloneHandlesWithOffset(annotation.data.handles, [0, 0, 0]),
    spline,
  };
  return true;
}

/**
 * Paste the copied contour annotation onto the currently displayed stack slice.
 * Returns true when a new contour annotation was created.
 */
export function pasteToActiveSlice(): boolean {
  if (!contourClipboard) {
    console.debug('[segmentationService] paste: no clipboard');
    return false;
  }
  // Guard against stale clipboard: the source segmentation may have been
  // deleted/unloaded since copy. Continuing would throw inside Cornerstone's
  // `addContourSegmentationAnnotation` (it reads `segmentation.representationData`
  // without null-checking). Clear the clipboard so future paste attempts
  // fail with a clean "no clipboard" rather than the same throw.
  if (!csSegmentation.state.getSegmentation(contourClipboard.segmentationId)) {
    console.debug('[segmentationService] paste: clipboard segmentation no longer exists', {
      segmentationId: contourClipboard.segmentationId,
    });
    contourClipboard = null;
    return false;
  }
  if (deps.getSegmentLocked(contourClipboard.segmentationId, contourClipboard.segmentIndex)) {
    console.debug('[segmentationService] paste: segment locked', {
      segmentationId: contourClipboard.segmentationId,
      segmentIndex: contourClipboard.segmentIndex,
    });
    return false;
  }

  const targetImageId = getCurrentImageIdForActiveViewport();
  if (!targetImageId) {
    console.debug('[segmentationService] paste: no target imageId for active viewport');
    return false;
  }
  const viewportContext = getActiveViewportContextForContourPaste(targetImageId);
  if (!viewportContext) {
    console.debug('[segmentationService] paste: no viewport context for', targetImageId);
    return false;
  }

  const delta: Point3 = [0, 0, 0];
  if (targetImageId !== contourClipboard.referencedImageId) {
    const sourcePlane = getImagePlaneInfo(contourClipboard.referencedImageId);
    const targetPlane = getImagePlaneInfo(targetImageId);
    if (!sourcePlane || !targetPlane) {
      console.debug('[segmentationService] paste: plane lookup failed', {
        sourceHasPlane: !!sourcePlane,
        targetHasPlane: !!targetPlane,
        sourceImageId: contourClipboard.referencedImageId,
        targetImageId,
      });
      return false;
    }
    if (
      contourClipboard.frameOfReferenceUID &&
      targetPlane.frameOfReferenceUID &&
      contourClipboard.frameOfReferenceUID !== targetPlane.frameOfReferenceUID
    ) {
      console.debug('[segmentationService] paste: FrameOfReferenceUID mismatch', {
        clipboard: contourClipboard.frameOfReferenceUID,
        target: targetPlane.frameOfReferenceUID,
      });
      return false;
    }
    if (Math.abs(dotPoint3(sourcePlane.normal, targetPlane.normal)) < 0.999) {
      console.debug('[segmentationService] paste: plane normals disagree', {
        sourceNormal: sourcePlane.normal,
        targetNormal: targetPlane.normal,
      });
      return false;
    }
    const translation = subtractPoint3(
      targetPlane.imagePositionPatient,
      sourcePlane.imagePositionPatient,
    );
    delta[0] = translation[0];
    delta[1] = translation[1];
    delta[2] = translation[2];
  }

  const annotationUID = (csUtilities as any).uuidv4();
  const translatedPolyline = contourClipboard.polyline.map((point) => addPoint3(point, delta));
  const translatedHandles =
    cloneHandlesWithOffset(contourClipboard.handles, delta)
    ?? {
      points: [],
      activeHandleIndex: null,
    };

  // Reconstruct spline state if the source was a spline tool. Cornerstone's
  // SplineROITool.renderAnnotationInstance requires `data.spline.{type,
  // instance}` at render time and regenerates the rendered polyline from
  // the control points in `data.handles.points` via `_updateSplineInstance`.
  //
  // If reconstruction fails (e.g. the captured constructor is no longer a
  // valid spline class after a Cornerstone upgrade), fall back to pasting
  // as a freehand contour — the rendered polyline is still correct; the
  // user loses spline-edit affordances but the workflow doesn't break.
  let pastedToolName = contourClipboard.toolName;
  let splineData: { type: string; instance: unknown; resolution: unknown } | null = null;
  let splineHandlePoints: Point3[] | null = null;
  if (contourClipboard.spline) {
    try {
      const newInstance = new contourClipboard.spline.SplineClass();
      splineData = {
        type: contourClipboard.spline.type,
        instance: newInstance,
        resolution: contourClipboard.spline.resolution,
      };
      splineHandlePoints = contourClipboard.spline.controlPointsWorld.map(
        (point) => addPoint3(point, delta),
      );
    } catch (err) {
      console.warn(
        '[segmentationService] Spline reconstruction on paste failed; falling back to freehand contour:',
        err,
      );
      pastedToolName = 'PlanarFreehandContourSegmentationTool';
      splineData = null;
      splineHandlePoints = null;
    }
  }

  const finalHandles: Record<string, unknown> = splineHandlePoints
    ? { ...translatedHandles, points: splineHandlePoints }
    : translatedHandles;

  // Harmonize the interpolation chain UID before adding the new annotation.
  // Cornerstone's InterpolationManager.handleAnnotationCompleted only fills
  // in-between rungs when the new annotation shares an `interpolationUID`
  // with at least one existing manual contour on the same chain
  // (segmentationId, segmentIndex, viewPlaneNormal, viewUp). Annotations
  // added through `csAnnotation.state.addAnnotation` directly — the
  // RTSTRUCT loader and the e2e `createTestContour` helper both do this —
  // bypass the tool-completion flow and never get a UID assigned. Without
  // harmonization, paste lands alone on a fresh chain and no interpolation
  // fires.
  const chainUID = resolveContourChainInterpolationUID({
    segmentationId: contourClipboard.segmentationId,
    segmentIndex: contourClipboard.segmentIndex,
    viewPlaneNormal: viewportContext.metadata.viewPlaneNormal as Point3 | undefined,
    viewUp: viewportContext.metadata.viewUp as Point3 | undefined,
  });

  const nextAnnotation: any = {
    annotationUID,
    metadata: {
      toolName: pastedToolName,
      ...viewportContext.metadata,
    },
    data: {
      contour: {
        polyline: translatedPolyline,
        closed: contourClipboard.closed,
      },
      segmentation: {
        segmentationId: contourClipboard.segmentationId,
        segmentIndex: contourClipboard.segmentIndex,
      },
      handles: finalHandles,
      ...(splineData ? { spline: splineData } : {}),
    },
    highlighted: true,
    isSelected: true,
    isLocked: false,
    isVisible: true,
    invalidated: false,
    autoGenerated: false,
    interpolationUID: chainUID,
  };

  try {
    csAnnotation.state.addAnnotation?.(nextAnnotation, viewportContext.annotationGroupSelector as any);
    addContourAnnotationToSegmentation(nextAnnotation);
    pushContourPasteHistoryMemo(
      nextAnnotation,
      viewportContext.annotationGroupSelector,
      viewportContext.viewportId,
    );

    csAnnotation.selection.setAnnotationSelected?.(annotationUID, true, false);
    useSegmentationStore.getState().setActiveSegmentation(contourClipboard.segmentationId);
    deps.setActiveSegmentIndex(contourClipboard.segmentationId, contourClipboard.segmentIndex);
    deps.activateOnViewport(viewportContext.viewportId, contourClipboard.segmentationId);
    emitToolEvent(ToolEnums.Events.ANNOTATION_COMPLETED, { annotation: nextAnnotation });

    deps.syncSegmentations();
    deps.refreshUndoState();
    useSegmentationStore.getState()._markDirty();
    useSegmentationManagerStore.getState().markDirty(contourClipboard.segmentationId);
    deps.scheduleAutoSave();

    const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(contourClipboard.segmentationId);
    const triggerAnnotationRenderForViewportIds = (csToolUtilities as any).triggerAnnotationRenderForViewportIds;
    if (typeof triggerAnnotationRenderForViewportIds === 'function' && viewportIds.length > 0) {
      triggerAnnotationRenderForViewportIds(viewportIds);
    }
    deps.renderAllSegmentationViewports();
    return true;
  } catch (err) {
    console.error('[segmentationService] Failed to paste copied contour annotation:', err);
    return false;
  }
}

/**
 * Selection-change handler. Wired by the orchestrator to the
 * ANNOTATION_SELECTION_CHANGE event. When the user selects a
 * contour-segmentation annotation on canvas, sync the active container/
 * segment to it so subsequent draws target the right structure.
 */
export function syncSelectedContourAnnotation(evt?: Event): void {
  const detail = (evt as CustomEvent<{ selection?: string[] }> | undefined)?.detail;
  const selectedFromEvent = Array.isArray(detail?.selection)
    ? detail.selection[detail.selection.length - 1] ?? null
    : null;
  const resolvedSelection = selectedFromEvent
    ? { annotationUID: selectedFromEvent, annotation: csAnnotation.state.getAnnotation?.(selectedFromEvent) }
    : getSelectedContourAnnotation();
  if (!resolvedSelection || !isContourAnnotation(resolvedSelection.annotation)) return;

  const annotationData = resolvedSelection.annotation.data as {
    segmentation?: { segmentationId?: string; segmentIndex?: number };
  };
  const segmentationId = annotationData.segmentation?.segmentationId;
  if (typeof segmentationId !== 'string') return;
  const segmentIndex = Number(annotationData.segmentation?.segmentIndex);
  if (!Number.isInteger(segmentIndex) || segmentIndex <= 0) return;
  if (deps.getSegmentationType(segmentationId) === 'labelmap') return;

  const viewerState = useViewerStore.getState();
  useSegmentationStore.getState().setActiveSegmentation(segmentationId);
  deps.setActiveSegmentIndex(segmentationId, segmentIndex);
  deps.activateOnViewport(viewerState.activeViewportId, segmentationId);
}

// ─── Internal accessor (test-only) ──────────────────────────────

/**
 * Test-only: read the current clipboard. Returns null if empty.
 * Public consumers should not depend on the clipboard's internal shape.
 */
export function _peekClipboard(): ContourClipboardEntry | null {
  return contourClipboard;
}

/**
 * Test-only: clear the clipboard. Public consumers should let the
 * paste path handle stale-clipboard detection.
 */
export function _clearClipboard(): void {
  contourClipboard = null;
}
