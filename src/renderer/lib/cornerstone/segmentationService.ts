/**
 * Segmentation Service — bridges Cornerstone3D segmentation API to the
 * React segmentation store (Zustand).
 *
 * Manages the lifecycle of labelmaps: creation, display, segment management,
 * style configuration, and DICOM SEG loading.
 *
 * Follows the same event-driven sync pattern as annotationService.ts:
 * - Cornerstone3D owns all segmentation data.
 * - This service listens for events, rebuilds lightweight summaries,
 *   and pushes them to the Zustand store for reactive UI updates.
 *
 * Public API:
 *   initialize()              — Subscribe to events (call once after toolService init)
 *   createStackSegmentation() — Create empty labelmap for painting
 *   addSegment()              — Add a new segment to an existing segmentation
 *   removeSegment()           — Remove a segment
 *   removeSegmentation()      — Remove an entire segmentation
 *   removeSegmentationsFromViewport() — Remove all segmentations from a viewport
 *   addToViewport()           — Display segmentation on a viewport
 *   setActiveSegmentIndex()   — Switch which segment the brush paints to
 *   setSegmentColor()         — Change a segment's color
 *   toggleSegmentVisibility() — Toggle individual segment visibility
 *   toggleSegmentLocked()     — Toggle segment lock
 *   updateStyle()             — Update global fill alpha + outline settings
 *   setBrushSize()            — Set brush radius
 *   loadDicomSeg()            — Parse DICOM SEG file and add as segmentation
 *   exportToDicomSeg()        — Export segmentation as DICOM SEG binary (base64)
 *   undo()                    — Undo last segmentation/contour edit
 *   redo()                    — Redo previously undone edit
 *   deleteSelectedContourComponents() — Delete selected contour annotation component(s)
 *   getUndoState()            — Query undo/redo availability
 *   cancelAutoSave()          — Cancel pending auto-save timer
 *   sync()                    — Force re-sync to store
 *   dispose()                 — Remove event listeners
 */
import { eventTarget, metaData, imageLoader, cache, utilities as csUtilities, getEnabledElementByViewportId } from '@cornerstonejs/core';
import type { Types as CoreTypes } from '@cornerstonejs/core';
import {
  annotation as csAnnotation,
  segmentation as csSegmentation,
  Enums as ToolEnums,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import { adaptersSEG, utilities as adaptersUtilities } from '@cornerstonejs/adapters';
// Importing `utilities` triggers the referencedMetadataProvider side-effect,
// which auto-registers StudyData, SeriesData, ImageData metadata modules
// (required by generateSegmentation). We alias it to avoid conflict with
// Cornerstone core utilities and reference it below to prevent tree-shaking.
void adaptersUtilities;
import { data as dcmjsData } from 'dcmjs';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import type { SegmentationSummary, SegmentSummary } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { useTransportStore } from '../../stores/transportStore';
import { useAnnotationSelectionStore } from '../../stores/annotationSelectionStore';
import { rtStructService } from './rtStructService';
import * as contourRep from './contourRepresentation';
import * as sourceImageTracking from './sourceImageTracking';
import * as mlg from './multiLayerGroup';
import * as interpolationAcceptance from './interpolationAcceptance';
import { backupService } from '../backup/backupService';
import {
  hasSegmentPixelsOnSlice,
  interpolateMorphological,
  interpolateNearestSlice,
  interpolateLinearBlend,
  interpolateSDF,
} from './segmentationService/interpolation';
import {
  findFirstNonZeroRef,
  getValidSegmentIndices,
  segmentsToPlainObject,
  hasUsableColor,
  sanitizeSegmentIndices,
  extractLabelmapImageId,
} from './segmentationService/segmentationHelpers';
import { applySourceDicomContextToSegDataset } from './segmentationService/dicomContext';
import {
  serializeDerivedDicomDataset,
  requireSingleStudyReference,
  collectSourceDicomReferences,
} from './dicomExportHelpers';
import {
  formatOperatorsNameForConnection,
  upsertOperatorsName,
} from './operatorsName';
import {
  registerSegmentationServiceEventBindings,
  unregisterSegmentationServiceEventBindings,
} from './segmentationService/eventBindings';
import {
  toPoint3,
  addPoint3,
  subtractPoint3,
  dotPoint3,
  crossPoint3,
  normalizePoint3,
  clonePolyline,
  cloneHandlesWithOffset,
} from './segmentationService/contourGeometry';
import { createUndoHistory } from './segmentationService/undoHistory';
import { createPerContainerHistory } from './segmentationService/perContainerHistory';
import { createSaveQueue, type SaveOutcome } from './segmentationService/saveQueue';
import { createVisibilityControls } from './segmentationService/visibility';
import { createDicomSegExport } from './segmentationService/dicomSegExport';
import { showAlertDialog } from '../../stores/dialogStore';
// NOTE: We use the tool group ID directly here instead of importing from
// toolService to avoid a circular dependency (toolService → segmentationService).
const TOOL_GROUP_ID = 'xnatToolGroup_primary';

// ─── Constants ──────────────────────────────────────────────────

/** Built-in fallback color palette for segments (10 colors, RGBA 0-255, cycles) */
const BUILTIN_DEFAULT_COLORS: [number, number, number, number][] = [
  [220, 50, 50, 255],    // Red
  [50, 200, 50, 255],    // Green
  [50, 100, 220, 255],   // Blue
  [230, 200, 40, 255],   // Yellow
  [200, 50, 200, 255],   // Magenta
  [50, 200, 200, 255],   // Cyan
  [240, 140, 40, 255],   // Orange
  [150, 80, 200, 255],   // Purple
  [50, 220, 130, 255],   // Spring Green
  [255, 130, 130, 255],  // Light Red
];
let DEFAULT_COLORS: [number, number, number, number][] = BUILTIN_DEFAULT_COLORS.map((c) => [...c] as [number, number, number, number]);

function isValidColorTuple(color: unknown): color is [number, number, number, number] {
  if (!Array.isArray(color) || color.length !== 4) return false;
  for (const entry of color) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return false;
    if (entry < 0 || entry > 255) return false;
  }
  return true;
}

let segmentationCounter = 0;

// SEGMENTED_PROPERTY_{CATEGORY,TYPE}_CODE moved to
// ./segmentationService/dicomSegExport (only used by the DICOM SEG export path).

/**
 * Cornerstone3D's built-in undo/redo ring buffer.
 * All segmentation/contour tools automatically push memos here via BaseTool.doneEditMemo().
 */
const { DefaultHistoryMemo } = (csUtilities as any).HistoryMemo;

// History-memo types + helpers (undo/redo) extracted to
// `./segmentationService/undoHistory`. The bound helper set is created below,
// after the segment label/lock helpers it depends on are declared.

// Source-image ID tracking moved to `./sourceImageTracking`. See that module
// for the typed API; the prior module-level `sourceImageIdsMap` is gone.

/**
 * Tracks loaded DICOM SEG colors per segmentation, keyed by segmentationId.
 * Colors are extracted from RecommendedDisplayRGBValue during loadDicomSeg()
 * and consumed (then deleted) in addToViewport() so they override the default palette.
 */
const loadedColorsMap = new Map<string, Map<number, [number, number, number, number]>>();

// ─── Multi-Layer Group Registry ─────────────────────────────────
//
// Each logical segmentation (shown in the UI as one row with N segments)
// is backed by N independent Cornerstone segmentation objects ("sub-segs"),
// one per segment. Each sub-seg has its own set of binary (0/1) Uint8Array
// labelmap images, enabling overlapping segments.

// Multi-layer group types + state moved to `./multiLayerGroup`. The local
// convenience wrappers below delegate to that module; keeping them (rather
// than calling `mlg.isMultiLayerGroup(...)` etc. everywhere) preserves the
// ~24 existing call sites unchanged.
const isMultiLayerGroup = mlg.isMultiLayerGroup;
const getActiveSubSegIds = mlg.getActiveSubSegIds;
const resolveSubSegId = mlg.resolveSubSegId;
function findViewportsWithGroup(groupId: string): string[] {
  return mlg.findViewportsWithGroup(
    groupId,
    (subSegId) => csSegmentation.state.getViewportIdsWithSegmentation(subSegId),
  );
}

function getSegmentDisplayLabel(segmentationId: string, segmentIndex: number): string {
  if (isMultiLayerGroup(segmentationId)) {
    return mlg.getSegmentMetaMap(segmentationId)?.get(segmentIndex)?.label ?? `Segment ${segmentIndex}`;
  }

  const segmentation = csSegmentation.state.getSegmentation(segmentationId) as
    | { segments?: Record<number, { label?: string }> }
    | undefined;
  return segmentation?.segments?.[segmentIndex]?.label ?? `Segment ${segmentIndex}`;
}

function isSegmentLockedInternal(segmentationId: string, segmentIndex: number): boolean {
  if (isMultiLayerGroup(segmentationId)) {
    const subSegId = resolveSubSegId(segmentationId, segmentIndex);
    if (!subSegId) return false;
    try {
      return csSegmentation.segmentLocking.isSegmentIndexLocked(subSegId, 1);
    } catch {
      return false;
    }
  }

  try {
    return csSegmentation.segmentLocking.isSegmentIndexLocked(segmentationId, segmentIndex);
  } catch {
    return false;
  }
}

// ─── Undo / Redo history tracking ───────────────────────
// History-memo helpers extracted to ./segmentationService/undoHistory.
// Bound to the service's segment-label / lock-query / annotation-lookup /
// alert-dialog dependencies; the returned helpers preserve the prior behavior.
// Per-container undo history (A8). Fed additively by the push hook below; the
// global ring still works (toolbar undo / signal 7). Undo/redo here re-mark the
// container dirty so undo past a save point sets the dirty flag again (signal 15).
const perContainerHistory = createPerContainerHistory({
  onContainerDirtied: (containerId) => {
    if (isDirtyTrackingSuppressed()) return;
    useSegmentationManagerStore.getState().markDirty(containerId);
    useSegmentationStore.getState()._markDirty();
  },
});

// ─── Queue-next-save autosave state machine (A9 / E2 / Slice 5) ─────────────
// The per-container queue/debounce/retry POLICY. The transport (`saveContainer`)
// is injected — the real per-container XNAT save is the deferred transport
// workstream; until it lands, the existing session-wide backupService autosave
// (performAutoSave below) remains the live persistence and this queue is inert in
// production (no production caller drives notifyDirty yet — Phase-3 gesture
// interceptor + transport workstream wire it). `isGestureActive` likewise reads a
// flag the Phase-3 gesture interceptor will set. onPhase surfaces per-container
// state into transportStore (silent — no toast/banner; the autosave row reads it).
let gestureActive = false;
// Autosave-to-XNAT opt-in (default OFF). When off, edits flow only to the legacy
// local-fs backup autosave (scheduleAutoSave); when on, edits ALSO drive the
// per-container saveQueue → injected transport (the live transport path). Off by
// default so turning on real server autosave is an explicit choice.
let xnatAutosaveEnabled = false;
let saveTransport: (containerId: string) => Promise<SaveOutcome> = async () =>
  ({ ok: false, kind: 'transient', error: 'save transport not implemented' });

function resolveContainerKind(containerId: string): 'SEG' | 'RTSTRUCT' | 'SR' {
  try {
    return getSegmentationType(containerId) === 'contour' ? 'RTSTRUCT' : 'SEG';
  } catch {
    return 'SEG';
  }
}

const saveQueue = createSaveQueue({
  saveContainer: (containerId) => saveTransport(containerId),
  isGestureActive: () => gestureActive,
  debounceMs: () => {
    const backupPrefs = usePreferencesStore.getState().preferences.backup;
    return backupPrefs.intervalSeconds > 0 ? backupPrefs.intervalSeconds * 1000 : AUTO_SAVE_DELAY;
  },
  isAutoSaveEnabled: () => usePreferencesStore.getState().preferences.backup.enabled,
  onPhase: (containerId, phase) => {
    // The saveQueue's generic phase callback only marks the in-flight 'saving'
    // state. Terminal states are owned by the injected transport's onResult
    // (transportService): success carries the version token, a conflict carries
    // errorKind:'conflict' + serverVersionToken. onResult runs INSIDE
    // saveContainer (before this fires), so writing terminal state here too would
    // clobber those richer fields with a bare phase+error string. In-flight only.
    if (phase === 'saving') {
      useTransportStore.getState().setPhase(containerId, resolveContainerKind(containerId), 'saving');
    }
  },
});

const undoHistory = createUndoHistory({
  getSegmentDisplayLabel,
  isSegmentLocked: isSegmentLockedInternal,
  getAnnotation: (id) =>
    csAnnotation.state.getAnnotation?.(id) as
      | { data?: { segmentation?: { segmentationId?: string; segmentIndex?: number } } }
      | undefined,
  // Wrapped (not passed by reference) so the dialogStore binding is read lazily
  // at call time — matching the original in-function access — rather than at
  // module-init, which would fail against partial dialogStore test mocks.
  showAlertDialog: (opts) => showAlertDialog(opts),
  recordContainerMemo: (memo) => perContainerHistory.record(memo ?? {}),
});
const {
  getTopUndoHistoryEntry,
  getTopRedoHistoryEntry,
  getLockedHistoryTargets,
  showHistoryBlockedDialog,
  installHistoryMemoTracking,
  uninstallHistoryMemoTracking,
} = undoHistory;

// ─── Segment visibility / lock controls ─────────────────
// Extracted to ./segmentationService/visibility. Bound to the service's
// store-sync + lock-query helpers; the public methods below delegate here.
const visibilityControls = createVisibilityControls({
  syncSegmentations,
  isSegmentLocked: isSegmentLockedInternal,
});

// ─── DICOM SEG export ───────────────────────────────────
// Extracted to ./segmentationService/dicomSegExport. Bound to the live default
// color palette (respects setDefaultColorSequence); the public
// exportToDicomSeg / _exportGroupToDicomSeg methods below delegate here.
const dicomSegExport = createDicomSegExport({
  getDefaultColors: () => DEFAULT_COLORS,
});

/**
 * Attach a single sub-segmentation to a viewport: add labelmap representation,
 * populate Cornerstone reference maps, and set the segment color.
 */
async function addSubSegToViewport(
  viewportId: string,
  subSegId: string,
  segColor: [number, number, number, number],
): Promise<void> {
  // Volume viewports (ORTHOGRAPHIC/MPR) need volume-backed labelmaps.
  // If the sub-seg only has stack imageIds, convert it first.
  try {
    const volEl = getEnabledElementByViewportId(viewportId) as any;
    const volVp: any = volEl?.viewport;
    if (volVp && typeof volVp.getAllVolumeIds === 'function') {
      const segObj = csSegmentation.state.getSegmentation(subSegId) as any;
      const labelmap = segObj?.representationData?.Labelmap as any;
      const hasImageIds = Array.isArray(labelmap?.imageIds) && labelmap.imageIds.length > 0;
      const hasVolumeId = typeof labelmap?.volumeId === 'string' && labelmap.volumeId.length > 0;
      if (hasImageIds && !hasVolumeId) {
        try {
          await (csSegmentation.helpers as any).convertStackToVolumeLabelmap({
            segmentationId: subSegId,
          });
          console.log(`[segmentationService] Converted sub-seg ${subSegId} stack→volume labelmap for ${viewportId}`);
        } catch (convErr) {
          console.warn(`[segmentationService] Failed converting ${subSegId} to volume labelmap; continuing with stack path`, convErr);
        }
      }
    }
  } catch {
    // Viewport may not be ready yet — proceed with stack path
  }

  csSegmentation.addLabelmapRepresentationToViewport(viewportId, [
    { segmentationId: subSegId },
  ]);

  // Populate internal reference maps for stack viewports.
  try {
    const seg = csSegmentation.state.getSegmentation(subSegId);
    const lmImageIds: string[] = (seg?.representationData?.Labelmap as any)?.imageIds ?? [];
    const mgr = csSegmentation.defaultSegmentationStateManager as any;
    if (!mgr._stackLabelmapImageIdReferenceMap.has(subSegId)) {
      mgr._stackLabelmapImageIdReferenceMap.set(subSegId, new Map());
    }
    const perSegMap = mgr._stackLabelmapImageIdReferenceMap.get(subSegId);
    for (const lmId of lmImageIds) {
      const lmImg = cache.getImage(lmId);
      const refId = (lmImg as any)?.referencedImageId;
      if (!refId) continue;
      perSegMap.set(refId, lmId);
      const mapKey = `${subSegId}-${refId}`;
      const existing = mgr._labelmapImageIdReferenceMap.get(mapKey);
      if (!existing) {
        mgr._labelmapImageIdReferenceMap.set(mapKey, [lmId]);
      } else if (!existing.includes(lmId)) {
        mgr._labelmapImageIdReferenceMap.set(mapKey, [...existing, lmId]);
      }
    }

    // Also map viewport-specific imageIds (wadouri/wadors format differences).
    const enabledEl = getEnabledElementByViewportId(viewportId) as any;
    const viewport = enabledEl?.viewport as any;
    if (viewport && typeof viewport.getAllVolumeIds !== 'function') {
      const viewportImageIds = viewport.getImageIds?.() as string[] | undefined;
      if (Array.isArray(viewportImageIds)) {
        const srcIds = sourceImageTracking.getSourceImageIds(subSegId) ?? [];
        const count = Math.min(srcIds.length, viewportImageIds.length);
        for (let i = 0; i < count; i++) {
          const vpImgId = viewportImageIds[i];
          if (typeof vpImgId !== 'string' || vpImgId.length === 0) continue;
          const lmId = lmImageIds[i];
          if (!lmId) continue;
          perSegMap.set(vpImgId, lmId);
          const vpMapKey = `${subSegId}-${vpImgId}`;
          const vpExisting = mgr._labelmapImageIdReferenceMap.get(vpMapKey);
          if (!vpExisting) {
            mgr._labelmapImageIdReferenceMap.set(vpMapKey, [lmId]);
          } else if (!vpExisting.includes(lmId)) {
            mgr._labelmapImageIdReferenceMap.set(vpMapKey, [...vpExisting, lmId]);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[segmentationService] Failed to populate reference maps for ${subSegId}:`, err);
  }

  // Set color for segment index 1 on this sub-seg.
  try {
    csSegmentation.config.color.setSegmentIndexColor(
      viewportId,
      subSegId,
      1,
      segColor as any,
    );
  } catch {
    // Color may not be settable yet
  }
}

// ─── Types ──────────────────────────────────────────────────────

export type LoadedDicomSeg = {
  segmentationId: string;
  firstNonZeroReferencedImageId: string | null; // source slice imageId to jump to
  firstNonZeroLabelmapImageId: string | null;   // derived labelmap imageId (debug)
};

// ─── Helpers ────────────────────────────────────────────────────

function getLabelmapImageIdsForSegmentation(segmentationId: string): string[] {
  const seg = csSegmentation.state.getSegmentation(segmentationId);
  const labelmapData: any = (seg?.representationData as any)?.Labelmap;
  if (!labelmapData) return [];

  if (Array.isArray(labelmapData.imageIds) && labelmapData.imageIds.length > 0) {
    return labelmapData.imageIds.filter((id: unknown) => typeof id === 'string' && id.length > 0);
  }

  const mapLike = labelmapData.imageIdReferenceMap;
  if (!mapLike) return [];

  const sourceOrder = sourceImageTracking.getSourceImageIds(segmentationId) ?? [];
  const bySource = new Map<string, string>();

  if (mapLike instanceof Map) {
    for (const [sourceImageId, mappedValue] of mapLike.entries()) {
      const mappedImageId = extractLabelmapImageId(mappedValue);
      if (typeof sourceImageId === 'string' && mappedImageId) {
        bySource.set(sourceImageId, mappedImageId);
      }
    }
  } else if (typeof mapLike === 'object') {
    for (const [sourceImageId, mappedValue] of Object.entries(mapLike)) {
      const mappedImageId = extractLabelmapImageId(mappedValue);
      if (mappedImageId) bySource.set(sourceImageId, mappedImageId);
    }
  }

  if (bySource.size === 0) return [];

  const ordered: string[] = [];
  for (const sourceImageId of sourceOrder) {
    const mapped = bySource.get(sourceImageId);
    if (mapped) ordered.push(mapped);
  }
  if (ordered.length > 0) return ordered;

  return Array.from(new Set(bySource.values()));
}

async function getCachedLabelmapSliceArrays(segmentationId: string): Promise<{
  sliceArrays: ArrayLike<number>[];
  width: number;
  height: number;
} | null> {
  const labelmapImageIds = getLabelmapImageIdsForSegmentation(segmentationId);
  if (!labelmapImageIds.length) return null;

  let width = 0;
  let height = 0;
  const sliceArrays: ArrayLike<number>[] = [];

  for (const imageId of labelmapImageIds) {
    let image: any = cache.getImage(imageId);
    if (!image) {
      try {
        image = await imageLoader.loadAndCacheImage(imageId);
      } catch {
        return null;
      }
    }
    if (!image) return null;

    const scalarData: ArrayLike<number> | undefined =
      image?.voxelManager?.getScalarData?.()
      ?? image?.imageFrame?.pixelData
      ?? image?.getPixelData?.();
    if (!scalarData) return null;

    const w = Number(image.columns ?? image.width ?? image.imageFrame?.columns ?? 0);
    const h = Number(image.rows ?? image.height ?? image.imageFrame?.rows ?? 0);
    if (!w || !h) return null;
    if (!width || !height) {
      width = w;
      height = h;
    } else if (w !== width || h !== height) {
      return null;
    }

    sliceArrays.push(scalarData);
  }

  return { sliceArrays, width, height };
}

// ─── Sync Logic ─────────────────────────────────────────────────

/**
 * After a segmentation is removed, clear its per-seg dirty flag and
 * re-evaluate the global hasUnsavedChanges flag.  If no dirty
 * segmentations remain, the global flag is cleared so that navigation
 * guards and beforeunload no longer block.
 *
 * Note: we set hasUnsavedChanges directly via setState instead of calling
 * _markClean(), because _markClean() uses an async import().then() to call
 * clearAllDirty(). That async state update can fire during React's commit
 * phase and trigger infinite re-render loops. Since we already clear the
 * per-seg dirty flag here, the async clearAllDirty is unnecessary.
 */
function cleanupDirtyStateAfterRemoval(segmentationId: string): void {
  try {
    const mgrStore = useSegmentationManagerStore.getState();
    mgrStore.clearDirty(segmentationId);

    // A removed container's undo history no longer applies (A8).
    perContainerHistory.clear(segmentationId);

    // If no remaining segmentations are dirty, clear the global flag
    if (!mgrStore.hasDirtySegmentations()) {
      useSegmentationStore.setState({ hasUnsavedChanges: false });
    }
  } catch {
    // Non-critical cleanup — don't let it break the removal flow
  }
}

/**
 * Rebuild segmentation summaries from Cornerstone's global state
 * and push to the Zustand store.
 */
function syncSegmentations(): void {
  try {
    const allSegmentations = csSegmentation.state.getSegmentations();
    const summaries: SegmentationSummary[] = [];
    const existingSummaries = useSegmentationStore.getState().segmentations;
    const store = useSegmentationStore.getState();

    // Track which Cornerstone segmentation IDs are sub-segs (skip them in the legacy pass)
    const processedSubSegIds = new Set<string>();

    // Deterministic reference viewport: prefer the active viewport so
    // visibility/color queries return consistent results across calls.
    const activeVpId = useViewerStore.getState().activeViewportId;

    // ─── Pass 1: Multi-layer groups ────────────────────────────
    for (const [groupId, subSegArr] of mlg.iterateGroups()) {
      const segments: SegmentSummary[] = [];
      const priorSummary = existingSummaries.find((s) => s.segmentationId === groupId);
      const priorColorByIndex = new Map<number, [number, number, number, number]>(
        (priorSummary?.segments ?? []).map((s) => [s.segmentIndex, s.color]),
      );
      const cachedPresentation = useSegmentationManagerStore.getState().presentation[groupId];

      for (let i = 0; i < subSegArr.length; i++) {
        const subSegId = subSegArr[i];
        if (subSegId === null) continue; // removed segment slot
        processedSubSegIds.add(subSegId);

        const segmentIndex = i + 1; // 1-based
        const meta = mlg.getSegmentMetaMap(groupId)?.get(segmentIndex);

        // Color: try Cornerstone API on the sub-seg (segment index 1), then meta, then default
        let color: [number, number, number, number] =
          meta?.color ?? DEFAULT_COLORS[(segmentIndex - 1) % DEFAULT_COLORS.length];
        let gotColorFromCS = false;
        const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(subSegId);
        // Prefer active viewport for deterministic reads
        const refVpId = vpIds.includes(activeVpId) ? activeVpId : vpIds[0];
        if (vpIds.length > 0) {
          try {
            const c = csSegmentation.config.color.getSegmentIndexColor(refVpId, subSegId, 1);
            if (hasUsableColor(c)) {
              color = [c[0], c[1], c[2], c.length >= 4 ? c[3] : 255];
              gotColorFromCS = true;
            }
          } catch {
            // fallback
          }
        }
        if (!gotColorFromCS) {
          const loadedColors = loadedColorsMap.get(groupId);
          if (loadedColors?.has(segmentIndex)) {
            color = loadedColors.get(segmentIndex)!;
          } else if (priorColorByIndex.has(segmentIndex)) {
            color = [...priorColorByIndex.get(segmentIndex)!] as [number, number, number, number];
          }
        }

        // Visibility: from sub-seg's segment index 1
        let visible = true;
        const cachedVisible = cachedPresentation?.visibility?.[segmentIndex];
        if (typeof cachedVisible === 'boolean') {
          visible = cachedVisible;
        } else if (vpIds.length > 0) {
          try {
            visible = csSegmentation.config.visibility.getSegmentIndexVisibility(
              refVpId,
              { segmentationId: subSegId, type: ToolEnums.SegmentationRepresentations.Labelmap },
              1,
            );
          } catch {
            // default visible
          }
          // Seed the presentation cache when not yet populated
          if (cachedVisible === undefined) {
            useSegmentationManagerStore.getState().setPresentation(groupId, segmentIndex, { visible });
          }
        }

        // Locked — read directly from Cornerstone to avoid stale-cache lag
        let locked = false;
        try {
          locked = csSegmentation.segmentLocking.isSegmentIndexLocked(subSegId, 1);
        } catch { /* default false */ }

        segments.push({
          segmentIndex,
          label: meta?.label ?? `Segment ${segmentIndex}`,
          color,
          visible,
          locked,
        });
      }

      segments.sort((a, b) => a.segmentIndex - b.segmentIndex);

      summaries.push({
        segmentationId: groupId,
        label: mlg.getGroupLabel(groupId) ?? 'Segmentation',
        segments,
        isActive: groupId === store.activeSegmentationId,
      });
    }

    // ─── Pass 2: Legacy (non-group) segmentations ──────────────
    for (const seg of allSegmentations) {
      if (processedSubSegIds.has(seg.segmentationId)) continue;
      if (mlg.isMultiLayerGroup(seg.segmentationId)) continue; // group ID itself (no CS object)

      const segments: SegmentSummary[] = [];
      const priorSummary = existingSummaries.find((s) => s.segmentationId === seg.segmentationId);
      const priorColorByIndex = new Map<number, [number, number, number, number]>(
        (priorSummary?.segments ?? []).map((s) => [s.segmentIndex, s.color]),
      );

      if (seg.segments) {
        const seen = new Set<number>();
        for (const [idxStr, segment] of Object.entries(seg.segments)) {
          let idx = Number(idxStr);
          if ((!Number.isFinite(idx) || idx <= 0 || !Number.isInteger(idx)) && segment) {
            const fallbackIdx = Number((segment as any).segmentIndex);
            if (Number.isFinite(fallbackIdx) && fallbackIdx > 0 && Number.isInteger(fallbackIdx)) {
              idx = fallbackIdx;
            }
          }
          if (!Number.isFinite(idx) || idx <= 0 || !Number.isInteger(idx)) continue;
          if (!segment) continue;
          if (seen.has(idx)) continue;
          seen.add(idx);

          let color: [number, number, number, number] = DEFAULT_COLORS[(idx - 1) % DEFAULT_COLORS.length];
          let gotColorFromCS = false;
          const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(seg.segmentationId);
          if (viewportIds.length > 0) {
            try {
              const c = csSegmentation.config.color.getSegmentIndexColor(
                viewportIds[0],
                seg.segmentationId,
                idx,
              );
              if (hasUsableColor(c)) {
                color = [c[0], c[1], c[2], c.length >= 4 ? c[3] : 255];
                gotColorFromCS = true;
              }
            } catch {
              // Use default color
            }
          }
          if (!gotColorFromCS) {
            const loadedColors = loadedColorsMap.get(seg.segmentationId);
            if (loadedColors?.has(idx)) {
              color = loadedColors.get(idx)!;
            } else if (priorColorByIndex.has(idx)) {
              color = [...priorColorByIndex.get(idx)!] as [number, number, number, number];
            }
          }

          let visible = true;
          const cachedPresentation = useSegmentationManagerStore.getState().presentation[seg.segmentationId];
          const cachedVisible = cachedPresentation?.visibility?.[idx];
          if (typeof cachedVisible === 'boolean') {
            visible = cachedVisible;
          } else if (csSegmentation.state.getViewportIdsWithSegmentation(seg.segmentationId).length > 0) {
            const vpId = csSegmentation.state.getViewportIdsWithSegmentation(seg.segmentationId)[0];
            try {
              visible = csSegmentation.config.visibility.getSegmentIndexVisibility(
                vpId,
                { segmentationId: seg.segmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
                idx,
              );
            } catch {
              try {
                visible = csSegmentation.config.visibility.getSegmentIndexVisibility(
                  vpId,
                  { segmentationId: seg.segmentationId, type: ToolEnums.SegmentationRepresentations.Contour },
                  idx,
                );
              } catch {
                // default visible
              }
            }
          }

          // Locked — read directly from Cornerstone to avoid stale-cache lag
          let locked = false;
          try {
            locked = csSegmentation.segmentLocking.isSegmentIndexLocked(seg.segmentationId, idx);
          } catch { /* default false */ }

          segments.push({
            segmentIndex: idx,
            label: segment.label || `Segment ${idx}`,
            color,
            visible,
            locked,
          });
        }
      }

      segments.sort((a, b) => a.segmentIndex - b.segmentIndex);

      summaries.push({
        segmentationId: seg.segmentationId,
        label: seg.label || 'Segmentation',
        segments,
        isActive: seg.segmentationId === store.activeSegmentationId,
      });
    }

    useSegmentationStore.getState()._sync(summaries);
  } catch (err) {
    console.error('[segmentationService] Failed to sync:', err);
  }
}

/** Event handler — sync on any segmentation change */
function onSegmentationEvent(): void {
  syncSegmentations();
  refreshUndoState();
}

function onAnnotationHistoryEvent(): void {
  refreshUndoState();
}

/**
 * The active container for undo/redo (A8): the active member's container, from the
 * list-panel selection model. When set, undo/redo is per-container; when null
 * (e.g. the legacy brush flow / E2E), it falls back to the global ring (signal 7).
 */
function activeUndoContainerId(): string | null {
  try {
    return useAnnotationSelectionStore.getState().activeMember?.containerId ?? null;
  } catch {
    return null;
  }
}

/** Push canUndo/canRedo booleans into the Zustand store (active-container aware, A8). */
function refreshUndoState(): void {
  const acid = activeUndoContainerId();
  const canUndo = acid ? perContainerHistory.canUndo(acid) : !!DefaultHistoryMemo?.canUndo;
  const canRedo = acid ? perContainerHistory.canRedo(acid) : !!DefaultHistoryMemo?.canRedo;
  useSegmentationStore.getState()._refreshUndoState(canUndo, canRedo);
}

function renderAllSegmentationViewports(): void {
  const viewportIds = new Set<string>();
  for (const seg of csSegmentation.state.getSegmentations()) {
    for (const viewportId of csSegmentation.state.getViewportIdsWithSegmentation(seg.segmentationId)) {
      viewportIds.add(viewportId);
    }
  }
  for (const viewportId of viewportIds) {
    csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
    const enabledElement = getEnabledElementByViewportId(viewportId) as any;
    enabledElement?.viewport?.render?.();
  }
}

type Point3 = CoreTypes.Point3;

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
    // Constructor reference for the spline class (e.g. CardinalSpline).
    // `new (...)` reconstructs an empty instance on paste.
    SplineClass: new () => unknown;
    controlPointsWorld: Point3[];
  } | null;
}

let contourClipboard: ContourClipboardEntry | null = null;

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

/**
 * Identity predicate for contour-segmentation annotations.
 *
 * Delegates tool-class + segmentation-metadata checks to
 * `contourRep.isContourSegmentationAnnotation`. Intentionally does NOT
 * check polyline length — callers that need a drawable/copyable shape
 * (e.g. `copySelectedContourAnnotation`) must enforce `polyline.length >= 3`
 * themselves.
 *
 * Prior behavior (pre-step-2): required `polyline.length >= 3`. That check
 * caused in-progress contours (splines mid-draw, freehand before the 3rd
 * point) to be silently treated as "not a contour", skipping selection
 * sync and other bookkeeping. The check moved to callers that actually
 * need completeness.
 */
function isContourAnnotation(annotation: any): annotation is {
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
      csAnnotation.state.addAnnotation?.(annotation, annotationGroupSelector);
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

function syncSelectedContourAnnotation(evt?: Event): void {
  const detail = (evt as CustomEvent<{ selection?: string[] }> | undefined)?.detail;
  const selectedFromEvent = Array.isArray(detail?.selection)
    ? detail.selection[detail.selection.length - 1] ?? null
    : null;
  const resolvedSelection = selectedFromEvent
    ? { annotationUID: selectedFromEvent, annotation: csAnnotation.state.getAnnotation?.(selectedFromEvent) }
    : getSelectedContourAnnotation();
  if (!resolvedSelection || !isContourAnnotation(resolvedSelection.annotation)) return;

  const segmentationId = resolvedSelection.annotation.data.segmentation.segmentationId!;
  const segmentIndex = Number(resolvedSelection.annotation.data.segmentation.segmentIndex);
  if (!Number.isInteger(segmentIndex) || segmentIndex <= 0) return;
  if (getSegmentationType(segmentationId) === 'labelmap') return;

  const viewerState = useViewerStore.getState();
  useSegmentationStore.getState().setActiveSegmentation(segmentationId);
  segmentationService.setActiveSegmentIndex(segmentationId, segmentIndex);
  segmentationService.activateOnViewport(viewerState.activeViewportId, segmentationId);
}

// ─── Segmentation Type Detection ─────────────────────────────────

/**
 * Determine the representation type of a segmentation.
 * Returns 'labelmap' if it has labelmap data, 'contour' if contour-only,
 * or 'both' if it has both representations with data.
 */
function getSegmentationType(segmentationId: string): 'labelmap' | 'contour' | 'both' {
  // Multi-layer groups are always labelmap-based
  if (isMultiLayerGroup(segmentationId)) return 'labelmap';

  const seg = csSegmentation.state.getSegmentation(segmentationId);
  if (!seg) return 'labelmap';

  const repData = seg.representationData as any;
  const hasLabelmap = !!(repData?.Labelmap?.imageIds?.length > 0 || repData?.Labelmap?.imageIdReferenceMap?.size > 0);
  // Treat an explicit contour representation as contour-capable even if it's
  // currently empty (new RTSTRUCT rows intentionally start with zero structures).
  const hasContour = contourRep.hasContourRepresentationKey(segmentationId);

  if (hasLabelmap && hasContour) return 'both';
  if (hasContour) return 'contour';
  return 'labelmap';
}

// ─── Auto-Save Logic ─────────────────────────────────────────────

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY = 10_000; // 10 seconds after last edit
const LABELMAP_INTERPOLATION_DELAY = 250;

/**
 * Reference counter for suppressing _markDirty() and scheduleAutoSave() calls.
 * Incremented during load operations (addToViewport, loadDicomSeg) where Cornerstone
 * fires SEGMENTATION_DATA_MODIFIED events internally during initialization,
 * which would falsely mark the state as dirty.
 * Using a counter instead of a boolean prevents race conditions when
 * multiple async load operations overlap (e.g., loadDicomSeg + addToViewport).
 */
let suppressDirtyTrackingCount = 0;
let suppressDirtyTrackingUntilMs = 0;

function isDirtyTrackingSuppressed(): boolean {
  return suppressDirtyTrackingCount > 0 || Date.now() < suppressDirtyTrackingUntilMs;
}

function setDirtyTrackingSuppressedFor(ms: number): void {
  if (ms <= 0) return;
  suppressDirtyTrackingUntilMs = Math.max(suppressDirtyTrackingUntilMs, Date.now() + ms);
}

/**
 * Reference counter for SEG/RTSTRUCT load operations in progress.
 * When > 0, performAutoSave() is blocked to prevent exporting incomplete
 * segmentation data (which causes "Error inserting pixels in PixelData").
 * Incremented by beginSegLoad(), decremented by endSegLoad().
 */
let loadInProgressCount = 0;

/**
 * Flag indicating a manual save/export is in progress.
 * When true, performAutoSave() is blocked and onSegmentationDataModified()
 * won't schedule auto-save. This prevents a race where a brush stroke during
 * the async export window (between cancelAutoSave and export completion)
 * triggers a competing auto-save that writes partial data.
 * Set via beginManualSave()/endManualSave() from SegmentationPanel.
 */
let manualSaveInProgress = false;
let backupInProgress = false;
let labelmapInterpolationTimer: ReturnType<typeof setTimeout> | null = null;
let labelmapInterpolationInProgress = false;
let pendingLabelmapInterpolation: { segmentationId: string; segmentIndex: number | null } | null = null;

/** Called when segmentation pixel data changes — debounces auto-save and marks dirty. */
function onSegmentationDataModified(evt?: Event): void {
  if (!isDirtyTrackingSuppressed()) {
    const detail = (evt as CustomEvent | undefined)?.detail as
      | { segmentationId?: string; segmentIndex?: number }
      | undefined;

    // Resolve sub-seg ID to group ID for dirty tracking
    let resolvedSegId = detail?.segmentationId ?? null;
    if (resolvedSegId) {
      const groupInfo = mlg.getGroupInfoForSubSeg(resolvedSegId);
      if (groupInfo) {
        resolvedSegId = groupInfo.groupId;
      }
    }

    if (detail?.segmentationId) {
      // For interpolation, use the resolved group ID so it can look up the right sub-seg
      const groupInfo = mlg.getGroupInfoForSubSeg(detail.segmentationId);
      pendingLabelmapInterpolation = {
        segmentationId: groupInfo ? groupInfo.groupId : detail.segmentationId,
        segmentIndex: groupInfo
          ? groupInfo.segmentIndex
          : (Number.isInteger(detail.segmentIndex) ? Number(detail.segmentIndex) : null),
      };
    }
    useSegmentationStore.getState()._markDirty();
    const dirtySegId =
      resolvedSegId
      ?? useSegmentationStore.getState().activeSegmentationId
      ?? null;
    if (dirtySegId) {
      useSegmentationManagerStore.getState().markDirty(dirtySegId);
      // Live transport path (opt-in): an edit marks the container dirty in the
      // per-container saveQueue → debounced save via the injected transport.
      if (xnatAutosaveEnabled) saveQueue.notifyDirty(dirtySegId);
    }
    scheduleAutoSave();
    if (!labelmapInterpolationInProgress) {
      scheduleLabelmapInterpolation();
    }
  }
}

/** Called when an annotation is completed/modified — triggers auto-save for contour segmentations. */
function onAnnotationAutoSave(): void {
  // Only schedule if there's an active segmentation that has contour data
  const segStore = useSegmentationStore.getState();
  const activeSegId = segStore.activeSegmentationId;
  if (!activeSegId) return;
  const segType = getSegmentationType(activeSegId);
  if (segType === 'contour' || segType === 'both') {
    if (!isDirtyTrackingSuppressed()) {
      segStore._markDirty();
      useSegmentationManagerStore.getState().markDirty(activeSegId);
      scheduleAutoSave();
    }
  }
}

function scheduleAutoSave(): void {
  // Don't schedule auto-save while a manual save is in progress
  if (manualSaveInProgress) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);

  // Read backup interval from preferences (fallback to AUTO_SAVE_DELAY)
  const backupPrefs = usePreferencesStore.getState().preferences.backup;
  const delayMs = backupPrefs.enabled
    ? backupPrefs.intervalSeconds * 1000
    : AUTO_SAVE_DELAY;

  autoSaveTimer = setTimeout(() => {
    void performAutoSave();
  }, delayMs);
}

function scheduleLabelmapInterpolation(): void {
  if (labelmapInterpolationTimer) clearTimeout(labelmapInterpolationTimer);
  labelmapInterpolationTimer = setTimeout(() => {
    void performLabelmapInterpolation();
  }, LABELMAP_INTERPOLATION_DELAY);
}

async function performLabelmapInterpolation(): Promise<void> {
  labelmapInterpolationTimer = null;
  if (labelmapInterpolationInProgress) return;
  if (isDirtyTrackingSuppressed()) return;
  if (loadInProgressCount > 0) return;

  // Read interpolation settings from preferences store (canonical source)
  const prefState = usePreferencesStore.getState();
  const interpPrefs = prefState.preferences.interpolation;
  if (!interpPrefs.enabled) return;

  const segStore = useSegmentationStore.getState();
  const pending = pendingLabelmapInterpolation;
  pendingLabelmapInterpolation = null;
  let activeSegId = pending?.segmentationId ?? segStore.activeSegmentationId;
  if (!activeSegId) return;

  let segmentIndex = Number(pending?.segmentIndex ?? segStore.activeSegmentIndex);
  if (!Number.isInteger(segmentIndex) || segmentIndex <= 0) return;

  // Don't interpolate on a locked segment
  if (segmentationService.getSegmentLocked(activeSegId, segmentIndex)) return;

  // For multi-layer groups, resolve to the sub-seg and use segment index 1
  let effectiveSegId = activeSegId;
  let effectiveSegIndex = segmentIndex;
  if (isMultiLayerGroup(activeSegId)) {
    const subSegId = resolveSubSegId(activeSegId, segmentIndex);
    if (!subSegId) return;
    effectiveSegId = subSegId;
    effectiveSegIndex = 1; // sub-segs are binary (0/1)
  }

  const segType = getSegmentationType(effectiveSegId);
  if (segType === 'contour') return;

  const labelmapData = await getCachedLabelmapSliceArrays(effectiveSegId);
  if (!labelmapData) return;
  const { sliceArrays, width, height } = labelmapData;
  if (sliceArrays.length < 3) return;

  const anchors: number[] = [];
  for (let i = 0; i < sliceArrays.length; i++) {
    if (hasSegmentPixelsOnSlice(sliceArrays[i], effectiveSegIndex)) {
      anchors.push(i);
    }
  }
  if (anchors.length < 2) return;

  labelmapInterpolationInProgress = true;
  const algorithm = interpPrefs.algorithm;
  const linearThreshold = interpPrefs.linearThreshold;

  try {
    const modifiedSlices = new Set<number>();
    const pixelsPerSlice = width * height;

    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      const gap = b - a - 1;
      if (gap <= 0) continue;

      for (let s = a + 1; s < b; s++) {
        const alpha = (s - a) / (b - a);
        const slice = sliceArrays[s] as any;

        // Dispatch to the selected algorithm
        let interpolated: Uint8Array;
        switch (algorithm) {
          case 'morphological':
            interpolated = interpolateMorphological(sliceArrays[a], sliceArrays[b], alpha, width, height, effectiveSegIndex);
            break;
          case 'nearestSlice':
            interpolated = interpolateNearestSlice(sliceArrays[a], sliceArrays[b], alpha, width, height, effectiveSegIndex);
            break;
          case 'linear':
            interpolated = interpolateLinearBlend(sliceArrays[a], sliceArrays[b], alpha, width, height, effectiveSegIndex, linearThreshold);
            break;
          case 'sdf':
          default:
            interpolated = interpolateSDF(sliceArrays[a], sliceArrays[b], alpha, width, height, effectiveSegIndex);
            break;
        }

        // Apply interpolated result to the gap slice
        let changed = false;
        for (let p = 0; p < pixelsPerSlice; p++) {
          const currentValue = Number(slice[p]);
          // Skip pixels that belong to a different segment
          if (currentValue !== 0 && currentValue !== effectiveSegIndex) continue;
          // Fill empty pixels where the algorithm says there should be data
          if (interpolated[p] === effectiveSegIndex && currentValue === 0) {
            slice[p] = effectiveSegIndex;
            changed = true;
          }
        }

        if (changed) {
          modifiedSlices.add(s);
        }
      }
    }

    if (modifiedSlices.size === 0) return;

    csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
      effectiveSegId,
      Array.from(modifiedSlices).sort((x, y) => x - y),
      effectiveSegIndex,
    );
    const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(effectiveSegId);
    for (const viewportId of viewportIds) {
      csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
      const enabledElement = getEnabledElementByViewportId(viewportId) as any;
      enabledElement?.viewport?.render?.();
    }
  } catch (err) {
    console.error('[segmentationService] Labelmap interpolation failed:', err);
  } finally {
    labelmapInterpolationInProgress = false;
  }
}

/** Cancel any pending auto-save (e.g. when a manual save starts). */
function cancelAutoSave(): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

/** Format current time as yyyymmddhhmmss for auto-save temp filenames. */
function formatTimestamp(): string {
  const d = new Date();
  return d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0');
}

async function performAutoSave(force = false): Promise<boolean> {
  autoSaveTimer = null;
  const segStore = useSegmentationStore.getState();
  const backupPrefs = usePreferencesStore.getState().preferences.backup;

  // Check backup enabled (from preferences), or force flag (disconnect guard)
  if (!backupPrefs.enabled && !force) return false;

  // Skip if dirty tracking is suppressed (load/creation in progress)
  if (isDirtyTrackingSuppressed()) return false;

  // Skip if a SEG/RTSTRUCT load is in progress (prevents PixelData corruption)
  if (loadInProgressCount > 0) {
    console.log('[segmentationService] Auto-save skipped — SEG load in progress');
    return false;
  }

  // Skip if no actual unsaved changes
  if (!segStore.hasUnsavedChanges) return false;

  // Prevent re-entrancy (Cornerstone exports aren't thread-safe)
  if (backupInProgress) {
    console.log('[segmentationService] Auto-save skipped — backup already in progress');
    return false;
  }

  const xnatContext = useViewerStore.getState().xnatContext;
  if (!xnatContext) return false; // No session context

  segStore._setAutoSaveStatus('saving');
  backupInProgress = true;
  try {
    const serverUrl = useConnectionStore.getState().connection?.serverUrl ?? '';
    const backed = await backupService.backupAllDirtySegmentations(
      xnatContext.sessionId,
      serverUrl,
    );

    if (backed > 0) {
      segStore._setAutoSaveStatus('saved');
      console.log(`[segmentationService] Local backup: ${backed} segmentation(s) saved`);
      return true;
    } else {
      // No dirty segs with exportable content — return to idle
      segStore._setAutoSaveStatus('idle');
      return false;
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('No painted segment data') ||
      msg.includes('no segment-frame pairs') ||
      msg.includes('Error inserting pixels in PixelData')
    ) {
      console.log('[segmentationService] Auto-save skipped — no painted pixels yet');
      segStore._setAutoSaveStatus('idle');
      return false;
    }
    console.error('[segmentationService] Auto-save failed:', err);
    segStore._setAutoSaveStatus('error');
    return false;
  } finally {
    backupInProgress = false;
  }
}

// ─── Legacy XNAT Temp Auto-Save (preserved for future reintroduction) ────
//
// The original auto-save wrote to XNAT's server-side temp resource for a single
// active segmentation. This has been replaced by the local filesystem backup
// that backs up ALL dirty segmentations. The code below is kept as reference
// for adding an optional XNAT temp backend to the backup strategy pattern.
//
// async function performAutoSave_xnatTemp(force = false): Promise<boolean> {
//   autoSaveTimer = null;
//   const segStore = useSegmentationStore.getState();
//   if (!segStore.autoSaveEnabled && !force) return false;
//   if (isDirtyTrackingSuppressed()) return false;
//   if (loadInProgressCount > 0) return false;
//   if (!segStore.hasUnsavedChanges) return false;
//   const xnatContext = useViewerStore.getState().xnatContext;
//   if (!xnatContext) return false;
//   const activeSegId = segStore.activeSegmentationId;
//   if (!activeSegId) return false;
//   const origin = segStore.xnatOriginMap[activeSegId];
//   const sourceScanId = origin?.sourceScanId ?? xnatContext.scanId;
//   const segType = getSegmentationType(activeSegId);
//   segStore._setAutoSaveStatus('saving');
//   try {
//     let base64: string;
//     let tempFilename: string;
//     const ts = formatTimestamp();
//     if (segType === 'contour') {
//       if (!segmentationService.hasExportableContent(activeSegId, 'RTSTRUCT')) {
//         segStore._setAutoSaveStatus('idle');
//         return false;
//       }
//       base64 = await rtStructService.exportToRtStruct(activeSegId);
//       tempFilename = `autosave_rtstruct_${sourceScanId}_${ts}.dcm`;
//     } else {
//       if (!segmentationService.hasExportableContent(activeSegId, 'SEG')) {
//         segStore._setAutoSaveStatus('idle');
//         return false;
//       }
//       base64 = await segmentationService.exportToDicomSeg(activeSegId);
//       tempFilename = `autosave_seg_${sourceScanId}_${ts}.dcm`;
//     }
//     // Clean up old auto-save files
//     try {
//       const existingFiles = await window.electronAPI.xnat.listTempFiles(xnatContext.sessionId);
//       const cleanupPattern = new RegExp(`^autosave_(?:seg|rtstruct)_${sourceScanId}(?:_\\d{14})?\\.dcm$`);
//       for (const f of existingFiles.files ?? []) {
//         if (cleanupPattern.test(f.name)) {
//           await window.electronAPI.xnat.deleteTempFile(xnatContext.sessionId, f.name);
//         }
//       }
//     } catch { /* ignore cleanup errors */ }
//     const result = await window.electronAPI.xnat.autoSaveTemp(
//       xnatContext.sessionId, sourceScanId, base64, tempFilename,
//     );
//     if (result.ok) {
//       segStore._setAutoSaveStatus('saved');
//       segStore._markClean();
//       return true;
//     } else {
//       segStore._setAutoSaveStatus('error');
//       return false;
//     }
//   } catch (err: any) {
//     const msg = err instanceof Error ? err.message : String(err);
//     if (msg.includes('No painted segment data') || msg.includes('no segment-frame pairs') || msg.includes('Error inserting pixels in PixelData')) {
//       segStore._setAutoSaveStatus('idle');
//       return false;
//     }
//     segStore._setAutoSaveStatus('error');
//     return false;
//   }
// }

let initialized = false;

// ─── Public API ─────────────────────────────────────────────────

export const segmentationService = {
  /**
   * Execute operations while suppressing dirty tracking.
   * Useful for non-user-initiated representation/style updates.
   */
  runWithDirtyTrackingSuppressed<T>(fn: () => T): T {
    suppressDirtyTrackingCount++;
    try {
      return fn();
    } finally {
      suppressDirtyTrackingCount--;
    }
  },

  /**
   * Suppress dirty tracking for a short post-operation window.
   * Use for operations that trigger SEGMENTATION_DATA_MODIFIED asynchronously
   * after the mutating call returns (e.g. viewport representation detach/attach).
   */
  suppressDirtyTrackingFor(ms: number): void {
    setDirtyTrackingSuppressedFor(ms);
  },

  /**
   * Check whether a segmentation still exists in Cornerstone state.
   * Useful for detecting stale xnatOriginMap entries after segmentations
   * have been removed from viewports.
   */
  segmentationExists(segmentationId: string): boolean {
    if (isMultiLayerGroup(segmentationId)) return true;
    const seg = csSegmentation.state.getSegmentation(segmentationId);
    return !!seg;
  },

  /**
   * Get the viewport IDs that currently display a given segmentation.
   */
  getViewportIdsForSegmentation(segmentationId: string): string[] {
    // Multi-layer group: union viewport IDs from all sub-segs
    if (isMultiLayerGroup(segmentationId)) {
      return findViewportsWithGroup(segmentationId);
    }
    return csSegmentation.state.getViewportIdsWithSegmentation(segmentationId);
  },

  /**
   * Update the label of a segmentation in Cornerstone state and re-sync the store.
   * Used to override generic labels with user-friendly names from XNAT metadata.
   */
  setLabel(segmentationId: string, label: string): void {
    if (isMultiLayerGroup(segmentationId)) {
      mlg.setGroupLabel(segmentationId, label);
      syncSegmentations();
      return;
    }
    const seg = csSegmentation.state.getSegmentation(segmentationId);
    if (seg) {
      (seg as any).label = label;
      syncSegmentations();
    }
  },

  /**
   * Subscribe to Cornerstone segmentation events.
   * Call once after toolService.initialize().
   */
  initialize(): void {
    if (initialized) return;

    const Events = ToolEnums.Events;
    registerSegmentationServiceEventBindings(
      eventTarget as any,
      Events as any,
      {
        onSegmentationEvent: onSegmentationEvent as EventListener,
        onSegmentationDataModified: onSegmentationDataModified as EventListener,
        onAnnotationAutoSave: onAnnotationAutoSave as EventListener,
        onAnnotationHistoryEvent: onAnnotationHistoryEvent as EventListener,
        onAnnotationSelectionChange: syncSelectedContourAnnotation as EventListener,
      },
    );

    // Increase undo ring buffer from default 50 to 200 for deep undo history
    if (DefaultHistoryMemo) {
      DefaultHistoryMemo.size = 200;
    }
    installHistoryMemoTracking();

    // Wire source-image-ID auto-cleanup. Subscribes to SEGMENTATION_REMOVED
    // so tracked entries for real Cornerstone segmentations are reaped even
    // if an orchestrating code path forgets to call clearSourceImageIds.
    sourceImageTracking.initialize();

    // Wire interpolation-acceptance policies (auto-accept on generation
    // when the preference is enabled; click-to-accept always).
    interpolationAcceptance.initialize();

    initialized = true;
    console.log('[segmentationService] Initialized — listening for segmentation events');
  },

  /**
   * Create a stack-based labelmap segmentation for the given source images.
   *
   * Creates an empty labelmap (one image per source image). By default this
   * starts with no segments so users can explicitly add and name the first one.
   * Returns the segmentationId.
   *
   * Uses createAndCacheLocalImage() with explicit dimensions instead of
   * createAndCacheDerivedLabelmapImages(), because the latter requires all
   * source images to have metadata loaded — which isn't the case for wadouri
   * images that haven't been scrolled-to yet. We get dimensions from the
   * currently displayed image (which IS loaded) and create all labelmaps
   * with those same dimensions.
   *
   * After creation, call addToViewport() to display it.
   */
  async createStackSegmentation(
    sourceImageIds: string[],
    label?: string,
    createDefaultSegment = false,
  ): Promise<string> {
    // Suppress dirty tracking — Cornerstone fires SEGMENTATION_DATA_MODIFIED
    // during addSegmentations() which would falsely schedule auto-save for
    // an empty (unpainted) segmentation.
    suppressDirtyTrackingCount++;
    try {
    segmentationCounter++;
    const segmentationId = `seg_${Date.now()}_${segmentationCounter}`;
    const segLabel = label || `Segmentation ${segmentationCounter}`;

    // Step 1: Determine image dimensions from a loaded source image.
    let rows = 0;
    let columns = 0;
    let rowPixelSpacing = 1;
    let columnPixelSpacing = 1;

    for (const srcId of sourceImageIds) {
      const cachedImage = cache.getImage(srcId);
      if (cachedImage) {
        rows = cachedImage.rows;
        columns = cachedImage.columns;
        rowPixelSpacing = cachedImage.rowPixelSpacing ?? 1;
        columnPixelSpacing = cachedImage.columnPixelSpacing ?? 1;
        break;
      }
    }

    if (rows === 0 || columns === 0) {
      throw new Error(
        '[segmentationService] Cannot create segmentation — no cached source images found. ' +
        'Ensure at least one image is displayed before creating a segmentation.',
      );
    }

    // Step 2: Start background pre-load of source image metadata.
    // This is needed before addSegment() creates labelmap images, but we
    // don't need to block creation — the promise is awaited lazily in
    // addSegment() so the segmentation appears in the UI immediately.
    const uncachedIds = sourceImageIds.filter((id) => {
      try {
        return !metaData.get('imagePlaneModule', id);
      } catch { return true; }
    });
    if (uncachedIds.length > 0) {
      console.log(`[segmentationService] Starting background pre-load of ${uncachedIds.length}/${sourceImageIds.length} uncached images...`);
      const preloadPromise = Promise.all(uncachedIds.map((id) =>
        imageLoader.loadAndCacheImage(id).catch((err: any) => {
          console.warn(`[segmentationService] Failed to pre-load image ${id}:`, err);
        }),
      )).then(() => { mlg.removePreloadPromise(segmentationId); });
      mlg.setPreloadPromise(segmentationId, preloadPromise);

      // If creating a default segment, we must await now because addSegment
      // needs metadata synchronously within this call.
      if (createDefaultSegment) {
        await preloadPromise;
      }
    }

    // Step 3: Initialize the multi-layer group (no labelmap images yet —
    // those are created per-segment in addSegment()).
    mlg.initGroupSlots(segmentationId);
    mlg.initSegmentMetaMap(segmentationId);
    mlg.setGroupDimensions(segmentationId, {
      rows,
      columns,
      rowPixelSpacing,
      columnPixelSpacing,
      sourceImageIds: [...sourceImageIds],
    });
    mlg.setGroupLabel(segmentationId, segLabel);

    // Track source imageIds for DICOM SEG export
    sourceImageTracking.setSourceImageIds(segmentationId, [...sourceImageIds]);

    // Store: set active segmentation.
    const store = useSegmentationStore.getState();
    store.setActiveSegmentation(segmentationId);

    // Step 4: If requested, create the first segment (which creates the
    // first sub-segmentation with its own labelmap images).
    if (createDefaultSegment) {
      await this.addSegment(segmentationId, 'Segment 1');
      store.setActiveSegmentIndex(1);
    } else {
      store.setActiveSegmentIndex(0);
    }

    console.log(`[segmentationService] Created multi-layer segmentation group: ${segmentationId} (${sourceImageIds.length} source slices, ${columns}×${rows})`);

    syncSegmentations();
    return segmentationId;
    } finally {
      suppressDirtyTrackingCount--;
    }
  },

  /**
   * Create a contour-only segmentation scaffold for structure annotation.
   * This is the creation path for RTSTRUCT-style authoring.
   */
  async createContourSegmentation(
    sourceImageIds: string[],
    label?: string,
    createDefaultSegment = false,
  ): Promise<string> {
    suppressDirtyTrackingCount++;
    try {
      segmentationCounter++;
      const segmentationId = `rtstruct_${Date.now()}_${segmentationCounter}`;
      const segLabel = label || `Structure ${segmentationCounter}`;

      csSegmentation.addSegmentations([
        {
          segmentationId,
          representation: {
            type: ToolEnums.SegmentationRepresentations.Contour,
            data: contourRep.buildInitialContourData(createDefaultSegment ? [1] : []) as any,
          },
          config: {
            label: segLabel,
            segments: createDefaultSegment
              ? {
                  1: {
                    label: 'Structure 1',
                    segmentIndex: 1,
                    locked: false,
                    active: true,
                    cachedStats: {},
                  } as any,
                }
              : {},
          },
        },
      ]);

      if (!createDefaultSegment) {
        try {
          csSegmentation.updateSegmentations([
            {
              segmentationId,
              config: { segments: {} },
            },
          ] as any);
        } catch {
          const created = csSegmentation.state.getSegmentation(segmentationId);
          if (created) {
            (created as any).segments = {};
          }
        }
      }

      sourceImageTracking.setSourceImageIds(segmentationId, [...sourceImageIds]);

      const store = useSegmentationStore.getState();
      store.setActiveSegmentation(segmentationId);
      if (createDefaultSegment) {
        store.setActiveSegmentIndex(1);
        csSegmentation.segmentIndex.setActiveSegmentIndex(segmentationId, 1);
      } else {
        store.setActiveSegmentIndex(0);
      }

      syncSegmentations();
      return segmentationId;
    } finally {
      suppressDirtyTrackingCount--;
    }
  },

  /**
   * Add a new segment to an existing segmentation.
   * Returns the new segment index (1-based).
   */
  ensureEmptySegmentation(segmentationId: string): void {
    try {
      // Multi-layer group: check sub-seg count instead of Cornerstone state
      if (isMultiLayerGroup(segmentationId)) {
        const subSegs = getActiveSubSegIds(segmentationId);
        if (subSegs.length === 0) {
          useSegmentationStore.getState().setActiveSegmentIndex(0);
        }
        syncSegmentations();
        return;
      }

      const seg = csSegmentation.state.getSegmentation(segmentationId);
      if (!seg) return;

      const positiveIndices = getValidSegmentIndices(seg);
      if (positiveIndices.length === 0) {
        useSegmentationStore.getState().setActiveSegmentIndex(0);
        return;
      }

      try {
        csSegmentation.updateSegmentations([
          {
            segmentationId,
            config: { segments: {} },
          },
        ] as any);
      }
      catch {
        // Ignore and apply direct mutation fallback below.
      }

      // Hard-clear the in-memory segmentation map/object as a fallback because
      // updateSegmentations() can be merge-like on some versions.
      const live = csSegmentation.state.getSegmentation(segmentationId);
      if (live) {
        if (live.segments instanceof Map) live.segments.clear();
        else (live as any).segments = {};
      }

      contourRep.clearAllAnnotationUIDs(segmentationId);

      try {
        csSegmentation.segmentIndex.setActiveSegmentIndex(segmentationId, 0);
      } catch {
        // Some Cornerstone versions reject index 0; store still tracks no-active-segment.
      }
      useSegmentationStore.getState().setActiveSegmentIndex(0);
      syncSegmentations();
    } catch (err) {
      console.debug('[segmentationService] ensureEmptySegmentation failed:', err);
    }
  },

  /**
   * Add a new segment to an existing segmentation.
   * For multi-layer groups: creates an independent sub-segmentation with its
   * own binary labelmap images so segments can overlap.
   * For contour segmentations (RTSTRUCT): adds a segment entry to the
   * Cornerstone segmentation state and annotation map.
   * Returns the new segment index (1-based).
   */
  async addSegment(
    segmentationId: string,
    label: string,
    color?: [number, number, number, number],
  ): Promise<number> {
    // ─── Contour (RTSTRUCT) path ─────────────────────────────
    const segType = getSegmentationType(segmentationId);
    if (segType === 'contour') {
      const seg = csSegmentation.state.getSegmentation(segmentationId);
      if (!seg) throw new Error(`[segmentationService] Segmentation not found: ${segmentationId}`);

      // Determine next index from existing segments
      const existingIndices = seg.segments
        ? Object.keys(seg.segments).map(Number).filter((n) => n > 0)
        : [];
      const nextIndex = existingIndices.length > 0
        ? Math.max(...existingIndices) + 1
        : 1;
      const segLabel = label.trim() || `Structure ${nextIndex}`;
      const segColor = color || DEFAULT_COLORS[(nextIndex - 1) % DEFAULT_COLORS.length];

      // Add segment entry to Cornerstone's segmentation state
      if (!seg.segments) (seg as any).segments = {};
      (seg.segments as any)[nextIndex] = {
        segmentIndex: nextIndex,
        label: segLabel,
        locked: false,
        active: true,
        cachedStats: {},
      };

      // Ensure contour annotation map has an entry for this segment
      contourRep.ensureSegmentEntry(segmentationId, nextIndex);

      // Set active segment index in Cornerstone
      csSegmentation.segmentIndex.setActiveSegmentIndex(segmentationId, nextIndex);

      // Apply color on all viewports showing this segmentation
      const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(segmentationId);
      for (const vpId of vpIds) {
        try {
          csSegmentation.config.color.setSegmentIndexColor(
            vpId, segmentationId, nextIndex, segColor as any,
          );
        } catch { /* viewport may be detached */ }
      }

      console.log(`[segmentationService] Added contour segment ${nextIndex} to ${segmentationId}: "${segLabel}"`);
      syncSegmentations();
      return nextIndex;
    }

    // ─── Multi-layer group (SEG) path ────────────────────────
    if (!isMultiLayerGroup(segmentationId)) {
      throw new Error(`[segmentationService] Not a multi-layer group: ${segmentationId}`);
    }

    // Ensure background metadata pre-load is complete before creating
    // labelmap images (each needs imagePlaneModule from its source image).
    const preloadPromise = mlg.getPreloadPromise(segmentationId);
    if (preloadPromise) {
      await preloadPromise;
    }

    const dims = mlg.getGroupDimensions(segmentationId);
    if (!dims) {
      throw new Error(`[segmentationService] No dimensions stored for group: ${segmentationId}`);
    }

    // Determine next segment index from existing sub-segs.
    const subSegIds = mlg.getGroupSlots(segmentationId)!;
    const nextIndex = subSegIds.length + 1;
    const segmentLabel = label.trim() || `Segment ${nextIndex}`;
    const segColor = color || DEFAULT_COLORS[(nextIndex - 1) % DEFAULT_COLORS.length];

    // Create the sub-segmentation ID and its labelmap images.
    const subSegId = `${segmentationId}_layer_${nextIndex}`;
    const labelmapImageIds: string[] = [];
    const pixelCount = dims.rows * dims.columns;
    const genericMeta = (csUtilities as any).genericMetadataProvider;

    // Grab generalSeriesModule from any source image.
    let refGeneralSeriesMeta: any = null;
    for (const srcId of dims.sourceImageIds) {
      refGeneralSeriesMeta = metaData.get('generalSeriesModule', srcId);
      if (refGeneralSeriesMeta) break;
    }

    for (let i = 0; i < dims.sourceImageIds.length; i++) {
      const labelmapImageId = `generated:labelmap_${subSegId}_${i}`;
      const srcImageId = dims.sourceImageIds[i];
      const imagePlane = metaData.get('imagePlaneModule', srcImageId);

      imageLoader.createAndCacheLocalImage(labelmapImageId, {
        scalarData: new Uint8Array(pixelCount),
        dimensions: [dims.columns, dims.rows],
        spacing: [dims.columnPixelSpacing, dims.rowPixelSpacing],
        origin: imagePlane?.imagePositionPatient,
        direction: imagePlane?.imageOrientationPatient,
        frameOfReferenceUID: imagePlane?.frameOfReferenceUID,
        referencedImageId: srcImageId,
      } as any);

      if (refGeneralSeriesMeta) {
        genericMeta.add(labelmapImageId, {
          type: 'generalSeriesModule',
          metadata: refGeneralSeriesMeta,
        });
      }

      labelmapImageIds.push(labelmapImageId);
    }

    // Register as an independent Cornerstone segmentation (segment index 1).
    suppressDirtyTrackingCount++;
    try {
      csSegmentation.addSegmentations([
        {
          segmentationId: subSegId,
          representation: {
            type: ToolEnums.SegmentationRepresentations.Labelmap,
            data: { imageIds: labelmapImageIds } as any,
          },
          config: {
            label: segmentLabel,
            segments: {
              1: {
                label: segmentLabel,
                segmentIndex: 1,
                locked: false,
                active: true,
                cachedStats: {},
              } as any,
            },
          },
        },
      ]);
    } finally {
      suppressDirtyTrackingCount--;
    }

    // Track source imageIds on the sub-seg (for export resolution).
    sourceImageTracking.setSourceImageIds(subSegId, [...dims.sourceImageIds]);

    // Update group registry.
    subSegIds.push(subSegId);
    mlg.setGroupInfoForSubSeg(subSegId, { groupId: segmentationId, segmentIndex: nextIndex });
    mlg.getSegmentMetaMap(segmentationId)!.set(nextIndex, {
      label: segmentLabel,
      color: segColor,
      locked: false,
    });

    // If the group is already attached to viewports, add the new sub-seg too.
    const attachedViewportIds = findViewportsWithGroup(segmentationId);
    for (const vpId of attachedViewportIds) {
      try {
        addSubSegToViewport(vpId, subSegId, segColor);
      } catch (err) {
        console.warn(`[segmentationService] Failed to attach sub-seg ${subSegId} to viewport ${vpId}:`, err);
      }
    }

    console.log(`[segmentationService] Added segment ${nextIndex} (${subSegId}) to group ${segmentationId}: "${segmentLabel}"`);

    syncSegmentations();
    return nextIndex;
  },

  /**
   * Remove a segment from a segmentation.
   */
  removeSegment(segmentationId: string, segmentIndex: number): void {
    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) {
        console.warn(`[segmentationService] No sub-seg for group ${segmentationId} index ${segmentIndex}`);
        syncSegmentations();
        return;
      }
      try {
        // Remove from all viewports
        const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(subSegId);
        for (const vpId of vpIds) {
          try { csSegmentation.removeLabelmapRepresentation(vpId, subSegId); } catch { /* ok */ }
        }
        // Remove from Cornerstone state
        csSegmentation.removeSegmentation(subSegId);
      } catch (err) {
        console.error('[segmentationService] Failed to remove sub-seg:', err);
      }
      // Clean up maps
      mlg.removeGroupInfoForSubSeg(subSegId);
      sourceImageTracking.clearSourceImageIds(subSegId);
      const groupArr = mlg.getGroupSlots(segmentationId);
      if (groupArr) {
        groupArr[segmentIndex - 1] = null; // null-out the slot
      }
      mlg.getSegmentMetaMap(segmentationId)?.delete(segmentIndex);

      // If all sub-segs are removed, clean up the entire group
      const remaining = getActiveSubSegIds(segmentationId);
      if (remaining.length === 0) {
        mlg.removeGroupSlots(segmentationId);
        mlg.removeSegmentMetaMap(segmentationId);
        mlg.removeGroupDimensions(segmentationId);
        mlg.removeGroupLabel(segmentationId);
        sourceImageTracking.clearSourceImageIds(segmentationId);
        const store = useSegmentationStore.getState();
        if (store.activeSegmentationId === segmentationId) {
          store.setActiveSegmentation(null);
        }
        store.clearXnatOrigin(segmentationId);
      }
      console.log(`[segmentationService] Removed segment ${segmentIndex} (sub-seg: ${subSegId}) from group ${segmentationId}`);
      syncSegmentations();
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    try {
      csSegmentation.removeSegment(segmentationId, segmentIndex);
      console.log(`[segmentationService] Removed segment ${segmentIndex} from ${segmentationId}`);
    } catch (err) {
      console.error('[segmentationService] Failed to remove segment:', err);
    }
    syncSegmentations();
  },

  /**
   * Copy the currently selected contour annotation component.
   * Returns true when a contour annotation is available for paste.
   */
  copySelectedContourAnnotation(): boolean {
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

    // Completeness guard: copy requires a drawable polyline. This was
    // previously enforced transitively via `isContourAnnotation` rejecting
    // annotations with <3 points, but that check now lives only here (and
    // other completeness-dependent sites) so in-progress contours stay
    // visible to selection sync.
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
  },

  /**
   * Paste the copied contour annotation onto the currently displayed stack slice.
   * Returns true when a new contour annotation was created.
   */
  pasteCopiedContourAnnotationToActiveSlice(): boolean {
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
    if (this.getSegmentLocked(contourClipboard.segmentationId, contourClipboard.segmentIndex)) {
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
        // Cross-FoR paste without a registered transform is blocked with a clear,
        // visible error (D6 / signal 23) — not a silent console.debug.
        void showAlertDialog({
          title: "Can't paste here",
          message:
            'The copied annotation belongs to a different frame of reference than this viewport. '
            + 'Paste into a viewport showing the source volume (or a registered volume in the same frame of reference).',
          confirmLabel: 'OK',
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

    const annotationUID = csUtilities.uuidv4();
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
      interpolationUID: '',
    };

    try {
      csAnnotation.state.addAnnotation?.(nextAnnotation, viewportContext.annotationGroupSelector);
      addContourAnnotationToSegmentation(nextAnnotation);
      pushContourPasteHistoryMemo(
        nextAnnotation,
        viewportContext.annotationGroupSelector,
        viewportContext.viewportId,
      );

      csAnnotation.selection.setAnnotationSelected?.(annotationUID, true, false);
      useSegmentationStore.getState().setActiveSegmentation(contourClipboard.segmentationId);
      this.setActiveSegmentIndex(contourClipboard.segmentationId, contourClipboard.segmentIndex);
      this.activateOnViewport(viewportContext.viewportId, contourClipboard.segmentationId);
      emitToolEvent(ToolEnums.Events.ANNOTATION_COMPLETED, { annotation: nextAnnotation });

      syncSegmentations();
      refreshUndoState();
      useSegmentationStore.getState()._markDirty();
      useSegmentationManagerStore.getState().markDirty(contourClipboard.segmentationId);
      scheduleAutoSave();

      const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(contourClipboard.segmentationId);
      const triggerAnnotationRenderForViewportIds = (csToolUtilities as any).triggerAnnotationRenderForViewportIds;
      if (typeof triggerAnnotationRenderForViewportIds === 'function' && viewportIds.length > 0) {
        triggerAnnotationRenderForViewportIds(viewportIds);
      }
      renderAllSegmentationViewports();
      return true;
    } catch (err) {
      console.error('[segmentationService] Failed to paste copied contour annotation:', err);
      return false;
    }
  },

  /**
   * Delete selected contour annotation component(s).
   * If `segmentationId` and/or `segmentIndex` are provided, deletion is filtered
   * to those identifiers.
   *
   * Returns true if at least one contour component was removed.
   */
  deleteSelectedContourComponents(segmentationId?: string, segmentIndex?: number): boolean {
    try {
      const selected = csAnnotation.selection.getAnnotationsSelected?.() ?? [];
      if (!selected.length) return false;

      const targetSegmentIndex =
        Number.isInteger(segmentIndex) && Number(segmentIndex) > 0 ? Number(segmentIndex) : null;

      let removed = 0;
      const affectedViewportIds = new Set<string>();

      for (const annotationUID of selected) {
        const ann: any = csAnnotation.state.getAnnotation(annotationUID);
        if (!ann) continue;

        const annSeg = ann.data?.segmentation;
        const annSegId: string | undefined = annSeg?.segmentationId;
        const annSegIndex = Number(annSeg?.segmentIndex);
        if (!annSegId || !Number.isInteger(annSegIndex) || annSegIndex <= 0) continue;
        if (segmentationId && annSegId !== segmentationId) continue;
        if (targetSegmentIndex != null && annSegIndex !== targetSegmentIndex) continue;

        const segType = getSegmentationType(annSegId);
        if (segType !== 'contour' && segType !== 'both') continue;

        try {
          // Remove from contour representation map first so segmentation metadata
          // stays in sync, then remove the annotation object.
          csToolUtilities.contourSegmentation.removeContourSegmentationAnnotation(ann as any);
        } catch (err) {
          console.debug('[segmentationService] removeContourSegmentationAnnotation failed:', err);
        }

        csAnnotation.state.removeAnnotation(annotationUID);
        removed++;

        const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(annSegId);
        for (const vpId of vpIds) affectedViewportIds.add(vpId);
      }

      if (removed === 0) return false;

      syncSegmentations();
      refreshUndoState();
      useSegmentationStore.getState()._markDirty();
      scheduleAutoSave();

      const triggerAnnotationRenderForViewportIds = (csToolUtilities as any).triggerAnnotationRenderForViewportIds;
      if (typeof triggerAnnotationRenderForViewportIds === 'function' && affectedViewportIds.size > 0) {
        triggerAnnotationRenderForViewportIds(Array.from(affectedViewportIds));
      }
      renderAllSegmentationViewports();

      console.log(
        `[segmentationService] Removed ${removed} selected contour component(s)` +
          (segmentationId ? ` for ${segmentationId}` : ''),
      );
      return true;
    } catch (err) {
      console.error('[segmentationService] Failed to delete selected contour components:', err);
      return false;
    }
  },

  /**
   * Remove an entire segmentation from Cornerstone state.
   */
  removeSegmentation(segmentationId: string): void {
    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      try {
        const allSubSegIds = getActiveSubSegIds(segmentationId);
        for (const subSegId of allSubSegIds) {
          // Remove from all viewports
          const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(subSegId);
          for (const vpId of vpIds) {
            try { csSegmentation.removeLabelmapRepresentation(vpId, subSegId); } catch { /* ok */ }
          }
          // Remove from Cornerstone state
          try { csSegmentation.removeSegmentation(subSegId); } catch { /* ok */ }
          mlg.removeGroupInfoForSubSeg(subSegId);
          sourceImageTracking.clearSourceImageIds(subSegId);
        }
        // Clean up group maps
        mlg.removeGroupSlots(segmentationId);
        mlg.removeSegmentMetaMap(segmentationId);
        mlg.removeGroupDimensions(segmentationId);
        mlg.removeGroupLabel(segmentationId);
        sourceImageTracking.clearSourceImageIds(segmentationId);
        loadedColorsMap.delete(segmentationId);
        mlg.removeGroupViewportAttachments(segmentationId);
        mlg.removePreloadPromise(segmentationId);

        const store = useSegmentationStore.getState();
        if (store.activeSegmentationId === segmentationId) {
          store.setActiveSegmentation(null);
        }
        store.clearXnatOrigin(segmentationId);

        // Clean up manager store (loadedBySourceScan, presentation, localOrigin, dirty)
        useSegmentationManagerStore.getState().cleanupRemovedSegmentation(segmentationId);

        console.log(`[segmentationService] Removed group segmentation: ${segmentationId} (${allSubSegIds.length} sub-segs)`);
      } catch (err) {
        console.error('[segmentationService] Failed to remove group segmentation:', err);
      }
      syncSegmentations();
      cleanupDirtyStateAfterRemoval(segmentationId);
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    try {
      const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(segmentationId);
      for (const vpId of viewportIds) {
        try {
          csSegmentation.removeLabelmapRepresentation(vpId, segmentationId);
        } catch {
          // May already be removed
        }
        try {
          csSegmentation.removeContourRepresentation(vpId, segmentationId);
        } catch {
          // May not have contour representation
        }
      }

      csSegmentation.removeSegmentation(segmentationId);
      sourceImageTracking.clearSourceImageIds(segmentationId);
      loadedColorsMap.delete(segmentationId);

      const store = useSegmentationStore.getState();
      if (store.activeSegmentationId === segmentationId) {
        store.setActiveSegmentation(null);
      }
      store.clearXnatOrigin(segmentationId);

      // Clean up manager store (loadedBySourceScan, presentation, localOrigin, dirty)
      useSegmentationManagerStore.getState().cleanupRemovedSegmentation(segmentationId);

      console.log(`[segmentationService] Removed segmentation: ${segmentationId}`);
    } catch (err) {
      console.error('[segmentationService] Failed to remove segmentation:', err);
    }
    syncSegmentations();
    cleanupDirtyStateAfterRemoval(segmentationId);
  },

  /**
   * Display a segmentation on a viewport as a labelmap overlay.
   * For multi-layer groups, attaches all sub-segmentations as independent actors.
   */
  async addToViewport(viewportId: string, segmentationId: string): Promise<void> {
    setDirtyTrackingSuppressedFor(400);
    suppressDirtyTrackingCount++;
    try {
    // Verify viewport exists.
    try {
      const enabledEl = getEnabledElementByViewportId(viewportId);
      if (!enabledEl?.viewport) {
        throw new Error(`Viewport ${viewportId} does not exist`);
      }
    } catch (err) {
      console.error(`[segmentationService] Viewport ${viewportId} not ready:`, err);
      throw err;
    }

    if (isMultiLayerGroup(segmentationId)) {
      // ─── Multi-layer path: attach each sub-seg as an independent actor ───
      // Record viewport attachment so addSegment() can discover the target
      // viewports even before any sub-segs exist (first segment case).
      mlg.attachGroupToViewport(segmentationId, viewportId);

      const subSegIds = getActiveSubSegIds(segmentationId);
      const metaMap = mlg.getSegmentMetaMap(segmentationId);
      const store = useSegmentationStore.getState();
      const activeSegIdx = store.activeSegmentIndex;

      for (const subSegId of subSegIds) {
        const info = mlg.getGroupInfoForSubSeg(subSegId);
        if (!info) continue;
        const meta = metaMap?.get(info.segmentIndex);
        const segColor = meta?.color ?? DEFAULT_COLORS[(info.segmentIndex - 1) % DEFAULT_COLORS.length];

        try {
          addSubSegToViewport(viewportId, subSegId, segColor);
        } catch (err) {
          console.error(`[segmentationService] Failed to add sub-seg ${subSegId} to viewport:`, err);
        }
      }

      // Set the active sub-seg to the one matching the active segment index.
      const activeSubSegId = resolveSubSegId(segmentationId, activeSegIdx);
      if (activeSubSegId) {
        try {
          csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, activeSubSegId);
          csSegmentation.segmentIndex.setActiveSegmentIndex(activeSubSegId, 1);
        } catch (err) {
          console.debug('[segmentationService] Failed to set active sub-seg:', err);
        }
      }

      // Apply current style settings.
      try {
        this.updateStyle(store.fillAlpha, store.renderOutline);
      } catch (err) {
        console.error('[segmentationService] Failed to update style:', err);
      }

      // Trigger render.
      try {
        csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
        const enabledEl = getEnabledElementByViewportId(viewportId);
        const vp = enabledEl?.viewport as any;
        vp?.render?.();
        requestAnimationFrame(() => vp?.render?.());
      } catch (err) {
        console.error('[segmentationService] triggerSegmentationRender failed:', err);
      }

      console.log(`[segmentationService] Added multi-layer group to viewport ${viewportId}: ${segmentationId} (${subSegIds.length} layers)`);
    } else {
      // ─── Legacy single-segmentation path ───
      try {
        csSegmentation.addLabelmapRepresentationToViewport(viewportId, [
          { segmentationId },
        ]);
      } catch (err) {
        console.error('[segmentationService] Failed to add labelmap to viewport:', err);
        syncSegmentations();
        return;
      }

      // Populate reference maps.
      try {
        const seg = csSegmentation.state.getSegmentation(segmentationId);
        const lmImageIds: string[] = (seg?.representationData?.Labelmap as any)?.imageIds ?? [];
        const mgr = csSegmentation.defaultSegmentationStateManager as any;
        if (!mgr._stackLabelmapImageIdReferenceMap.has(segmentationId)) {
          mgr._stackLabelmapImageIdReferenceMap.set(segmentationId, new Map());
        }
        const perSegMap = mgr._stackLabelmapImageIdReferenceMap.get(segmentationId);
        for (const lmId of lmImageIds) {
          const lmImg = cache.getImage(lmId);
          const refId = (lmImg as any)?.referencedImageId;
          if (!refId) continue;
          perSegMap.set(refId, lmId);
          const mapKey = `${segmentationId}-${refId}`;
          const existing = mgr._labelmapImageIdReferenceMap.get(mapKey);
          if (!existing) {
            mgr._labelmapImageIdReferenceMap.set(mapKey, [lmId]);
          } else if (!existing.includes(lmId)) {
            mgr._labelmapImageIdReferenceMap.set(mapKey, [...existing, lmId]);
          }
        }
      } catch (err) {
        console.warn('[segmentationService] Failed to populate labelmap reference maps:', err);
      }

      try {
        csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
      } catch (err) {
        console.error('[segmentationService] Failed to set active segmentation:', err);
      }

      try {
        const store = useSegmentationStore.getState();
        this.updateStyle(store.fillAlpha, store.renderOutline);
      } catch (err) {
        console.error('[segmentationService] Failed to update style:', err);
      }

      // Ensure colors.
      try {
        const segObj = csSegmentation.state.getSegmentation(segmentationId);
        for (const idx of getValidSegmentIndices(segObj)) {
          let hasColor = false;
          try {
            const c = csSegmentation.config.color.getSegmentIndexColor(viewportId, segmentationId, idx);
            hasColor = hasUsableColor(c);
          } catch { hasColor = false; }
          if (!hasColor) {
            const fallback = DEFAULT_COLORS[(idx - 1) % DEFAULT_COLORS.length];
            csSegmentation.config.color.setSegmentIndexColor(viewportId, segmentationId, idx, fallback as any);
          }
        }
      } catch (err) {
        console.debug('[segmentationService] Failed to ensure segment colors:', err);
      }

      // Apply loaded DICOM colors.
      const loadedColors = loadedColorsMap.get(segmentationId);
      if (loadedColors && loadedColors.size > 0) {
        let allColorsApplied = true;
        for (const [idx, color] of loadedColors.entries()) {
          try {
            csSegmentation.config.color.setSegmentIndexColor(viewportId, segmentationId, idx, color as any);
          } catch { allColorsApplied = false; }
        }
        if (allColorsApplied) loadedColorsMap.delete(segmentationId);
      }

      try {
        csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
        const enabledEl = getEnabledElementByViewportId(viewportId);
        const vp = enabledEl?.viewport as any;
        vp?.render?.();
        requestAnimationFrame(() => vp?.render?.());
      } catch (err) {
        console.error('[segmentationService] triggerSegmentationRender failed:', err);
      }

      console.log(`[segmentationService] Added to viewport ${viewportId}: ${segmentationId}`);
    }

    syncSegmentations();
    } finally {
      suppressDirtyTrackingCount--;
    }
  },

  /**
   * Remove all segmentations that are associated with a specific viewport.
   * Call this before loading a new scan into a viewport to clean up stale
   * segmentation overlays from the previous scan. Without this cleanup,
   * Cornerstone crashes in matchImagesForOverlay when the new source images
   * don't match the old labelmap metadata.
   */
  /**
   * Detach all segmentation representations from a specific viewport.
   * This ONLY removes the visual representations (labelmap + contour overlays),
   * it does NOT delete the global segmentation objects from Cornerstone state.
   *
   * Previously, this method would fully remove segmentation objects when they
   * were only on one viewport, causing them to "disappear" from the panel on
   * scan switching. Now segmentation objects are preserved so they can be
   * reattached by SegmentationManager when the user switches back.
   */
  removeSegmentationsFromViewport(viewportId: string): void {
    // Representation removals can trigger async SEGMENTATION_DATA_MODIFIED events
    // after this method returns. Keep dirty tracking suppressed briefly so scan
    // navigation doesn't create false unsaved changes / autosave attempts.
    setDirtyTrackingSuppressedFor(1500);
    this.runWithDirtyTrackingSuppressed(() => {
      try {
        const allSegmentations = csSegmentation.state.getSegmentations();

        for (const seg of allSegmentations) {
          const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(seg.segmentationId);
          if (viewportIds.includes(viewportId)) {
            // Remove representations from this viewport only — keep the global object
            try {
              csSegmentation.removeLabelmapRepresentation(viewportId, seg.segmentationId);
            } catch {
              // May already be removed
            }
            try {
              csSegmentation.removeContourRepresentation(viewportId, seg.segmentationId);
            } catch {
              // May not have contour representation
            }

            console.log(`[segmentationService] Detached segmentation ${seg.segmentationId} from viewport ${viewportId} (global object preserved)`);
          }
        }
      } catch (err) {
        console.error('[segmentationService] Failed to remove segmentations from viewport:', err);
      }
    });
    syncSegmentations();
  },

  /**
   * Switch the active segmentation on a viewport (Cornerstone-level).
   * Called when the user selects a different segmentation in the panel.
   * Also ensures the contour representation exists so contour tools keep working.
   */
  activateOnViewport(viewportId: string, segmentationId: string): void {
    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      // Check if any sub-seg is on this viewport
      const subSegIds = getActiveSubSegIds(segmentationId);
      const hasAny = subSegIds.some((id) =>
        csSegmentation.state.getViewportIdsWithSegmentation(id).includes(viewportId),
      );
      if (!hasAny) {
        console.debug(`[segmentationService] Group ${segmentationId} not on viewport ${viewportId}, skipping activation`);
        return;
      }
      // Activate the sub-seg matching the current active segment index
      const activeIdx = useSegmentationStore.getState().activeSegmentIndex;
      const activeSubSegId = resolveSubSegId(segmentationId, activeIdx) ?? subSegIds[0];
      if (activeSubSegId) {
        try {
          csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, activeSubSegId);
        } catch (err) {
          console.debug('[segmentationService] activateOnViewport setActive (group):', err);
        }
      }
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(segmentationId);
    if (!viewportIds.includes(viewportId)) {
      console.debug(`[segmentationService] Segmentation ${segmentationId} not on viewport ${viewportId}, skipping activation`);
      return;
    }

    try {
      csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
    } catch (err) {
      console.debug('[segmentationService] activateOnViewport setActive:', err);
    }

    // Contour representation is added lazily only when a contour tool is activated.
  },

  /**
   * Set the active segment index for painting.
   * Must be >= 1 (segment 0/background is not a paint target).
   */
  setActiveSegmentIndex(segmentationId: string, segmentIndex: number): void {
    if (!Number.isFinite(segmentIndex) || segmentIndex <= 0) {
      console.warn(`[segmentationService] Invalid active segment index ${segmentIndex}; using 1`);
      segmentIndex = 1;
    }

    // ─── Multi-layer group path ────────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) {
        console.warn(`[segmentationService] No sub-seg for group ${segmentationId} index ${segmentIndex}`);
        return;
      }

      // Get the color for this segment from metadata
      const meta = mlg.getSegmentMetaMap(segmentationId)?.get(segmentIndex);
      const segColor = meta?.color ?? DEFAULT_COLORS[(segmentIndex - 1) % DEFAULT_COLORS.length];

      // Switch the active Cornerstone segmentation to this sub-seg on all viewports
      const vpIds = findViewportsWithGroup(segmentationId);
      for (const vpId of vpIds) {
        try {
          csSegmentation.activeSegmentation.setActiveSegmentation(vpId, subSegId);
        } catch {
          // viewport may be detached
        }
        // Ensure color on segment index 1 of the sub-seg
        try {
          csSegmentation.config.color.setSegmentIndexColor(vpId, subSegId, 1, segColor as any);
        } catch {
          // ignore
        }
      }

      this.runWithDirtyTrackingSuppressed(() => {
        // Within the sub-seg, the brush always paints segment index 1
        csSegmentation.segmentIndex.setActiveSegmentIndex(subSegId, 1);
        useSegmentationStore.getState().setActiveSegmentIndex(segmentIndex);
      });

      // Force render to reflect the active segment change visually
      for (const vpId of vpIds) {
        try {
          csToolUtilities.segmentation.triggerSegmentationRender(vpId);
          getEnabledElementByViewportId(vpId)?.viewport?.render();
        } catch { /* ignore detached viewports */ }
      }

      console.log(`[segmentationService] Active segment: ${segmentIndex} (sub-seg: ${subSegId})`);
      return;
    }

    // ─── Legacy (non-group) path ───────────────────────────────
    const fallbackColor = (() => {
      const summary = useSegmentationStore
        .getState()
        .segmentations
        .find((s) => s.segmentationId === segmentationId);
      const fromStore = summary?.segments.find((s) => s.segmentIndex === segmentIndex)?.color;
      if (fromStore && hasUsableColor(fromStore as any)) {
        return [...fromStore] as [number, number, number, number];
      }
      return DEFAULT_COLORS[(segmentIndex - 1) % DEFAULT_COLORS.length];
    })();

    // Ensure color exists before activating the segment to avoid LUT-index
    // warnings in Cornerstone cursor/annotation rendering paths.
    const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(segmentationId);
    for (const vpId of viewportIds) {
      try {
        const c = csSegmentation.config.color.getSegmentIndexColor(vpId, segmentationId, segmentIndex);
        if (!hasUsableColor(c)) {
          csSegmentation.config.color.setSegmentIndexColor(
            vpId,
            segmentationId,
            segmentIndex,
            fallbackColor as any,
          );
        }
      } catch {
        try {
          csSegmentation.config.color.setSegmentIndexColor(
            vpId,
            segmentationId,
            segmentIndex,
            fallbackColor as any,
          );
        } catch {
          // ignore color init failures on detached/stale viewports
        }
      }
    }
    this.runWithDirtyTrackingSuppressed(() => {
      csSegmentation.segmentIndex.setActiveSegmentIndex(segmentationId, segmentIndex);
      useSegmentationStore.getState().setActiveSegmentIndex(segmentIndex);
    });

    // Force render to reflect the active segment change visually
    for (const vpId of viewportIds) {
      try {
        csToolUtilities.segmentation.triggerSegmentationRender(vpId);
        getEnabledElementByViewportId(vpId)?.viewport?.render();
      } catch { /* ignore detached viewports */ }
    }

    console.log(`[segmentationService] Active segment: ${segmentIndex}`);
  },

  /**
   * Change a segment's display color.
   */
  setSegmentColor(
    segmentationId: string,
    segmentIndex: number,
    color: [number, number, number, number],
  ): void {
    if (!Number.isFinite(segmentIndex) || segmentIndex <= 0 || !Number.isInteger(segmentIndex)) return;

    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) return;
      // Update metadata
      const metaMap = mlg.getSegmentMetaMap(segmentationId);
      if (metaMap) {
        const existing = metaMap.get(segmentIndex);
        if (existing) existing.color = color;
      }
      // Set color on the sub-seg's segment index 1
      const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(subSegId);
      for (const vpId of vpIds) {
        try {
          csSegmentation.config.color.setSegmentIndexColor(vpId, subSegId, 1, color as any);
        } catch {
          // ignore
        }
      }
      // Force render to reflect color change
      for (const vpId of vpIds) {
        try {
          csToolUtilities.segmentation.triggerSegmentationRender(vpId);
          getEnabledElementByViewportId(vpId)?.viewport?.render();
        } catch { /* ignore */ }
      }
      syncSegmentations();
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(segmentationId);
    for (const vpId of viewportIds) {
      try {
        csSegmentation.config.color.setSegmentIndexColor(
          vpId,
          segmentationId,
          segmentIndex,
          color as any,
        );
      } catch {
        // ignore
      }
    }
    // Force render to reflect color change
    for (const vpId of viewportIds) {
      try {
        csToolUtilities.segmentation.triggerSegmentationRender(vpId);
        getEnabledElementByViewportId(vpId)?.viewport?.render();
      } catch { /* ignore */ }
    }
    syncSegmentations();
  },

  /**
   * Rename a segmentation (the top-level label).
   */
  renameSegmentation(segmentationId: string, newLabel: string): void {
    if (isMultiLayerGroup(segmentationId)) {
      mlg.setGroupLabel(segmentationId, newLabel);
      syncSegmentations();
      return;
    }
    const seg = csSegmentation.state.getSegmentation(segmentationId);
    if (!seg) return;
    seg.label = newLabel;
    syncSegmentations();
  },

  /**
   * Rename an individual segment within a segmentation.
   */
  renameSegment(segmentationId: string, segmentIndex: number, newLabel: string): void {
    if (isMultiLayerGroup(segmentationId)) {
      const metaMap = mlg.getSegmentMetaMap(segmentationId);
      const meta = metaMap?.get(segmentIndex);
      if (meta) meta.label = newLabel;
      syncSegmentations();
      return;
    }
    const seg = csSegmentation.state.getSegmentation(segmentationId);
    if (!seg?.segments) return;
    if (seg.segments instanceof Map) {
      const entry = seg.segments.get(segmentIndex);
      if (!entry) return;
      entry.label = newLabel;
      entry.SegmentLabel = newLabel;
      seg.segments.set(segmentIndex, entry);
    } else {
      const entry = (seg.segments as any)[segmentIndex];
      if (!entry) return;
      entry.label = newLabel;
      entry.SegmentLabel = newLabel;
      (seg.segments as any)[segmentIndex] = entry;
    }
    syncSegmentations();
  },

  /**
   * Toggle visibility for an individual segment on a viewport.
   */
  toggleSegmentVisibility(viewportId: string, segmentationId: string, segmentIndex: number): void {
    visibilityControls.toggleSegmentVisibility(viewportId, segmentationId, segmentIndex);
  },

  /**
   * Set visibility for an individual segment on a viewport.
   */
  setSegmentVisibility(
    viewportId: string,
    segmentationId: string,
    segmentIndex: number,
    visible: boolean,
  ): void {
    visibilityControls.setSegmentVisibility(viewportId, segmentationId, segmentIndex, visible);
  },

  /**
   * Toggle lock for a segment (locked segments can't be painted over).
   */
  toggleSegmentLocked(segmentationId: string, segmentIndex: number): void {
    visibilityControls.toggleSegmentLocked(segmentationId, segmentIndex);
  },

  /**
   * Read the current visibility state of a segment from Cornerstone.
   * Tries Labelmap representation first, then Contour. Defaults to true.
   */
  getSegmentVisibility(viewportId: string, segmentationId: string, segmentIndex: number): boolean {
    return visibilityControls.getSegmentVisibility(viewportId, segmentationId, segmentIndex);
  },

  /**
   * Read the current lock state of a segment from Cornerstone.
   */
  getSegmentLocked(segmentationId: string, segmentIndex: number): boolean {
    return visibilityControls.getSegmentLocked(segmentationId, segmentIndex);
  },

  /**
   * Check whether the currently active segment is locked.
   * Returns true if the active segmentation + active segment index are locked.
   */
  isActiveSegmentLocked(): boolean {
    return visibilityControls.isActiveSegmentLocked();
  },

  /**
   * Update global segmentation style (fill alpha, outline rendering).
   */
  updateStyle(fillAlpha: number, renderOutline: boolean): void {
    try {
      csSegmentation.segmentationStyle.setStyle(
        { type: ToolEnums.SegmentationRepresentations.Labelmap },
        {
          renderFill: true,
          fillAlpha,
          renderOutline,
          outlineWidth: 2,
          outlineOpacity: 1,
          renderFillInactive: true,
          fillAlphaInactive: fillAlpha * 0.6,
          renderOutlineInactive: renderOutline,
          outlineWidthInactive: 1,
          outlineOpacityInactive: 0.6,
        },
      );
      renderAllSegmentationViewports();
    } catch (err) {
      console.error('[segmentationService] Failed to update style:', err);
    }
  },

  /**
   * Set the brush tool radius.
   */
  setBrushSize(size: number): void {
    try {
      csToolUtilities.segmentation.setBrushSizeForToolGroup(
        TOOL_GROUP_ID,
        size,
      );
    } catch (err) {
      console.error('[segmentationService] Failed to set brush size:', err);
    }
  },

  /**
   * Override the default segment color sequence used for new segments.
   */
  setDefaultColorSequence(colors: [number, number, number, number][]): void {
    const valid = colors
      .filter((color) => isValidColorTuple(color))
      .map((color) => ([
        Math.round(color[0]),
        Math.round(color[1]),
        Math.round(color[2]),
        Math.round(color[3]),
      ] as [number, number, number, number]));

    DEFAULT_COLORS = valid.length > 0
      ? valid
      : BUILTIN_DEFAULT_COLORS.map((color) => [...color] as [number, number, number, number]);
  },

  /**
   * Load a DICOM SEG file and register it as a segmentation.
   *
   * Parses the ArrayBuffer with @cornerstonejs/adapters, extracts labelmap
   * data and segment metadata, then registers with Cornerstone3D.
   *
   * Returns { segmentationId, firstNonZeroSourceIndex }.
   */
  async loadDicomSeg(
    arrayBuffer: ArrayBuffer,
    sourceImageIds: string[],
  ): Promise<LoadedDicomSeg> {
    // Suppress dirty tracking during load — Cornerstone fires data-modified events
    // internally during segmentation registration, which would falsely mark as dirty.
    suppressDirtyTrackingCount++;
    segmentationCounter++;
    const segmentationId = `seg_dicom_${Date.now()}_${segmentationCounter}`;

    try {
      const requestedSourceImageIds = sourceImageIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      );
      if (requestedSourceImageIds.length === 0) {
        throw new Error('[segmentationService] No source imageIds were provided for SEG load.');
      }

      // Keep only source ids that at least expose a SOP Instance UID.
      // Some scans include non-image DICOM objects that break SEG matching.
      const idsWithSop = requestedSourceImageIds.filter((id) => {
        const gen = metaData.get('generalImageModule', id) as any;
        const inst = metaData.get('instance', id) as any;
        const sop = gen?.sopInstanceUID ?? inst?.SOPInstanceUID ?? inst?.sopInstanceUID;
        return typeof sop === 'string' && sop.length > 0;
      });
      const effectiveBaseSourceImageIds = idsWithSop.length > 0 ? idsWithSop : requestedSourceImageIds;
      if (effectiveBaseSourceImageIds.length !== requestedSourceImageIds.length) {
        console.warn(
          `[segmentationService] Ignoring ${requestedSourceImageIds.length - effectiveBaseSourceImageIds.length} `
          + 'source imageIds without SOP metadata during SEG load.',
        );
      }

      // Cornerstone SEG adapter may resolve referenced images as ?frame= / /frames/
      // ids even when the source stack was loaded with base ids. Build adapter ids
      // in a frame-addressable form to keep metadata index maps aligned.
      const toFrameAddressableImageId = (imageId: string): string => {
        if (imageId.includes('/frames/') || /[?&]frame=\d+/.test(imageId)) {
          return imageId;
        }
        if (imageId.startsWith('wadors:')) {
          return `${imageId}/frames/1`;
        }
        return imageId.includes('?') ? `${imageId}&frame=0` : `${imageId}?frame=0`;
      };
      const adapterSourceImageIds = effectiveBaseSourceImageIds.map(toFrameAddressableImageId);
      const baseIdByAdapterId = new Map<string, string>();
      for (let i = 0; i < adapterSourceImageIds.length; i++) {
        baseIdByAdapterId.set(adapterSourceImageIds[i], effectiveBaseSourceImageIds[i]);
      }
      const effectiveBaseSet = new Set(effectiveBaseSourceImageIds);
      const resolveBaseImageId = (candidate: string | undefined): string => {
        if (candidate && baseIdByAdapterId.has(candidate)) {
          return baseIdByAdapterId.get(candidate)!;
        }
        if (candidate && effectiveBaseSet.has(candidate)) {
          return candidate;
        }
        if (candidate) {
          const withoutFramePath = candidate.replace(/\/frames\/\d+$/, '');
          if (effectiveBaseSet.has(withoutFramePath)) return withoutFramePath;
          const withoutFrameQuery = withoutFramePath
            .replace(/([?&])frame=\d+(&?)/g, (_m, sep, tail) => (sep === '?' && tail ? '?' : tail ? sep : ''))
            .replace(/[?&]$/, '');
          if (effectiveBaseSet.has(withoutFrameQuery)) return withoutFrameQuery;
        }
        return effectiveBaseSourceImageIds[0];
      };

      // ─── Ensure "instance" metadata has Rows/Columns for every source image ───
      //
      // createFromDICOMSegBuffer reads `metadataProvider.get("instance", imageId)`
      // and checks `.Rows` / `.Columns` against the SEG frame dimensions.
      //
      // The "instance" metadata is an aggregate of multiple DICOM modules
      // (imagePlaneModule, imagePixelModule, etc.) with keys capitalized
      // (e.g., rows → Rows). However, for wadouri images the instance provider
      // uses getNormalized() which aggregates these modules — and sometimes
      // Rows/Columns end up missing or undefined (e.g., if the metadata provider
      // returns rows/columns in lowercase only, or the imagePixelModule wasn't
      // merged properly).
      //
      // To prevent the "different geometry dimensions" false positive, we
      // create a metadata-patching wrapper that intercepts "instance" requests
      // and ensures Rows/Columns are populated from imagePixelModule or cached
      // image data if the raw instance metadata is missing them.

      // ─── Get source image dimensions ───
      // Used for both metadata patching and SEG buffer repair.
      const srcImg = cache.getImage(effectiveBaseSourceImageIds[0]);
      const pixMod = metaData.get('imagePixelModule', effectiveBaseSourceImageIds[0]);
      const sourceRowsRaw = pixMod?.rows ?? srcImg?.rows ?? srcImg?.height;
      const sourceColsRaw = pixMod?.columns ?? srcImg?.columns ?? srcImg?.width;
      const sourceRows = Number.isFinite(sourceRowsRaw) && sourceRowsRaw > 0 ? sourceRowsRaw : 512;
      const sourceCols = Number.isFinite(sourceColsRaw) && sourceColsRaw > 0 ? sourceColsRaw : 512;
      console.log(`[segmentationService] Source image dimensions: ${sourceCols}x${sourceRows}`);

      // ─── Fix SEG buffer if Rows/Columns are 0 or missing ───
      //
      // Previously-saved SEG files may have Rows=0, Columns=0 due to a
      // metadata provider bug during export. The adapter's geometry check
      // compares the SEG's Rows/Columns against the source images and
      // rejects the file if they differ.
      //
      // We parse the SEG file's Rows/Columns, and if they're 0, we patch
      // the binary buffer directly with the correct values from the source
      // images. This is safe because Rows (0028,0010) and Columns (0028,0011)
      // are US (unsigned short) VR — always 2 bytes, little-endian.
      let loadBuffer = arrayBuffer;
      let segHadBrokenGeometry = false;
      try {
        const dicomParser = await import('dicom-parser');
        const byteArray = new Uint8Array(arrayBuffer);
        // Parse the full file so we can inspect PixelData element length.
        // dicom-parser stores element offsets without loading bulk data into memory.
        const ds = dicomParser.parseDicom(byteArray);
        const segRows = ds.uint16('x00280010');
        const segCols = ds.uint16('x00280011');

        // Check if PixelData exists and has content
        const pixelDataEl = ds.elements['x7fe00010'];
        const pixelDataLen = pixelDataEl ? pixelDataEl.length : -1;
        console.log(
          `[segmentationService] SEG file: Rows=${segRows}, Columns=${segCols}, ` +
          `PixelData length=${pixelDataLen}`,
        );

        if ((segRows === 0 || segCols === 0) && sourceRows > 0 && sourceCols > 0) {
          segHadBrokenGeometry = true;
          console.warn(
            `[segmentationService] SEG file has invalid geometry (${segCols}x${segRows}), ` +
            `patching to match source (${sourceCols}x${sourceRows})`,
          );

          // Check if PixelData is empty — if so, this file has no recoverable
          // segmentation data (it was saved with the old broken export code).
          if (pixelDataLen <= 0) {
            console.error(
              `[segmentationService] SEG file has 0-byte PixelData. ` +
              `This file was saved with a broken export and cannot be loaded. ` +
              `Please re-create the segmentation and save again.`,
            );
            throw new Error(
              'This segmentation file was saved with a previous version that had a bug. ' +
              'The segmentation data is empty and cannot be recovered. ' +
              'Please re-create the segmentation and save again.',
            );
          }

          // Find the data offset of the Rows element and patch it
          const rowsElement = ds.elements['x00280010'];
          const colsElement = ds.elements['x00280011'];

          if (rowsElement && colsElement) {
            // Create a mutable copy of the buffer
            const patchedBytes = new Uint8Array(arrayBuffer.slice(0));
            const dv = new DataView(patchedBytes.buffer);

            // Write Rows (US = uint16 LE)
            dv.setUint16(rowsElement.dataOffset, sourceRows, true);
            // Write Columns (US = uint16 LE)
            dv.setUint16(colsElement.dataOffset, sourceCols, true);

            loadBuffer = patchedBytes.buffer;
            console.log(`[segmentationService] Patched SEG buffer: Rows=${sourceRows}, Columns=${sourceCols}`);
          }
        }
      } catch (parseErr) {
        if (segHadBrokenGeometry) {
          // Re-throw if the error is about unrecoverable data
          throw parseErr;
        }
        console.warn('[segmentationService] Could not parse/patch SEG dimensions:', parseErr);
      }

      // ─── Ensure source image instance metadata has Rows/Columns ───
      //
      // The adapter calls metadataProvider.get("instance", imageId) and
      // checks .Rows / .Columns. If these are missing from the instance
      // metadata (which happens with some wadouri metadata providers), the
      // geometry check fails. We create a wrapper that ensures they're present.
      const sourceIndexById = new Map<string, number>();
      effectiveBaseSourceImageIds.forEach((id, idx) => sourceIndexById.set(id, idx));

      const toTriplet = (value: any): [number, number, number] | null => {
        if (Array.isArray(value) && value.length >= 3) {
          const x = Number(value[0]);
          const y = Number(value[1]);
          const z = Number(value[2]);
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
        }
        if (
          value
          && typeof value === 'object'
          && Number.isFinite((value as any).x)
          && Number.isFinite((value as any).y)
          && Number.isFinite((value as any).z)
        ) {
          return [Number((value as any).x), Number((value as any).y), Number((value as any).z)];
        }
        return null;
      };

      const toOrientation = (value: any): [number, number, number, number, number, number] | null => {
        if (!Array.isArray(value) || value.length < 6) return null;
        const out = value.slice(0, 6).map((v: any) => Number(v));
        if (out.every((v: number) => Number.isFinite(v))) {
          return out as [number, number, number, number, number, number];
        }
        return null;
      };

      const pickString = (...values: any[]): string | undefined => {
        for (const value of values) {
          if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
          }
        }
        return undefined;
      };

      const firstUsableImageId = effectiveBaseSourceImageIds.find((id) => {
        const plane = metaData.get('imagePlaneModule', id) as any;
        const row = toTriplet(plane?.rowCosines);
        const col = toTriplet(plane?.columnCosines);
        const iop = toOrientation(plane?.imageOrientationPatient);
        return Boolean((row && col) || iop);
      }) ?? effectiveBaseSourceImageIds[0];

      const firstUsablePlane = metaData.get('imagePlaneModule', firstUsableImageId) as any;
      const firstUsableInstance = (metaData.get('instance', firstUsableImageId) as any) ?? {};
      const firstUsableSeries = (metaData.get('generalSeriesModule', firstUsableImageId) as any) ?? {};
      const firstIop =
        toOrientation(firstUsablePlane?.imageOrientationPatient)
        ?? toOrientation(firstUsableInstance?.ImageOrientationPatient)
        ?? toOrientation(firstUsableInstance?.imageOrientationPatient);

      const fallbackRowCos: [number, number, number] =
        toTriplet(firstUsablePlane?.rowCosines)
        ?? (firstIop ? [firstIop[0], firstIop[1], firstIop[2]] : [1, 0, 0]);
      const fallbackColCos: [number, number, number] =
        toTriplet(firstUsablePlane?.columnCosines)
        ?? (firstIop ? [firstIop[3], firstIop[4], firstIop[5]] : [0, 1, 0]);
      const fallbackPosition: [number, number, number] =
        toTriplet(firstUsablePlane?.imagePositionPatient)
        ?? toTriplet(firstUsableInstance?.ImagePositionPatient)
        ?? toTriplet(firstUsableInstance?.imagePositionPatient)
        ?? [0, 0, 0];
      const fallbackFrameOfReferenceUID = pickString(
        firstUsablePlane?.frameOfReferenceUID,
        firstUsableInstance?.FrameOfReferenceUID,
        firstUsableInstance?.frameOfReferenceUID,
      );
      const fallbackSeriesInstanceUID = pickString(
        firstUsableSeries?.seriesInstanceUID,
        firstUsableInstance?.SeriesInstanceUID,
        firstUsableInstance?.seriesInstanceUID,
      );
      const fallbackRowSpacing = Number(firstUsablePlane?.rowPixelSpacing);
      const fallbackColSpacing = Number(firstUsablePlane?.columnPixelSpacing);

      const loadMetadataProvider = {
        get: (type: string, imageId: string) => {
          const requestedId =
            typeof imageId === 'string' && imageId.length > 0 ? imageId : adapterSourceImageIds[0];
          const resolvedId = resolveBaseImageId(requestedId);
          const raw = metaData.get(type, resolvedId) as any;
          const instance = (metaData.get('instance', resolvedId) as any) ?? {};
          const sourceIndex = sourceIndexById.get(resolvedId) ?? 0;

          if (type === 'imagePlaneModule') {
            const imageOrientationPatient =
              toOrientation(raw?.imageOrientationPatient)
              ?? toOrientation(instance?.ImageOrientationPatient)
              ?? toOrientation(instance?.imageOrientationPatient)
              ?? [...fallbackRowCos, ...fallbackColCos];
            const rowCosines =
              toTriplet(raw?.rowCosines)
              ?? [imageOrientationPatient[0], imageOrientationPatient[1], imageOrientationPatient[2]];
            const columnCosines =
              toTriplet(raw?.columnCosines)
              ?? [imageOrientationPatient[3], imageOrientationPatient[4], imageOrientationPatient[5]];
            const imagePositionPatient =
              toTriplet(raw?.imagePositionPatient)
              ?? toTriplet(instance?.ImagePositionPatient)
              ?? toTriplet(instance?.imagePositionPatient)
              ?? [fallbackPosition[0], fallbackPosition[1], fallbackPosition[2] + sourceIndex];

            const rowSpacingRaw = Number(
              raw?.rowPixelSpacing
              ?? raw?.pixelSpacing?.[0]
              ?? instance?.PixelSpacing?.[0]
              ?? instance?.pixelSpacing?.[0]
              ?? fallbackRowSpacing,
            );
            const colSpacingRaw = Number(
              raw?.columnPixelSpacing
              ?? raw?.pixelSpacing?.[1]
              ?? instance?.PixelSpacing?.[1]
              ?? instance?.pixelSpacing?.[1]
              ?? fallbackColSpacing,
            );
            const rowPixelSpacing = Number.isFinite(rowSpacingRaw) && rowSpacingRaw > 0 ? rowSpacingRaw : 1;
            const columnPixelSpacing = Number.isFinite(colSpacingRaw) && colSpacingRaw > 0 ? colSpacingRaw : 1;

            return {
              ...(raw ?? {}),
              rows: raw?.rows ?? sourceRows,
              columns: raw?.columns ?? sourceCols,
              imageOrientationPatient,
              rowCosines,
              columnCosines,
              imagePositionPatient,
              rowPixelSpacing,
              columnPixelSpacing,
              pixelSpacing: [rowPixelSpacing, columnPixelSpacing],
              frameOfReferenceUID: pickString(
                raw?.frameOfReferenceUID,
                instance?.FrameOfReferenceUID,
                instance?.frameOfReferenceUID,
                fallbackFrameOfReferenceUID,
              ),
            };
          }

          if (type === 'generalSeriesModule') {
            return {
              ...(raw ?? {}),
              seriesInstanceUID: pickString(
                raw?.seriesInstanceUID,
                instance?.SeriesInstanceUID,
                instance?.seriesInstanceUID,
                fallbackSeriesInstanceUID,
              ),
            };
          }

          if (type === 'generalImageModule') {
            return {
              ...(raw ?? {}),
              sopInstanceUID: pickString(
                raw?.sopInstanceUID,
                instance?.SOPInstanceUID,
                instance?.sopInstanceUID,
              ),
            };
          }

          if (type === 'instance') {
            const imagePositionPatient =
              toTriplet(raw?.ImagePositionPatient)
              ?? toTriplet(raw?.imagePositionPatient)
              ?? toTriplet(instance?.ImagePositionPatient)
              ?? toTriplet(instance?.imagePositionPatient)
              ?? [fallbackPosition[0], fallbackPosition[1], fallbackPosition[2] + sourceIndex];
            const imageOrientationPatient =
              toOrientation(raw?.ImageOrientationPatient)
              ?? toOrientation(raw?.imageOrientationPatient)
              ?? toOrientation(instance?.ImageOrientationPatient)
              ?? toOrientation(instance?.imageOrientationPatient)
              ?? [...fallbackRowCos, ...fallbackColCos];

            return {
              ...(raw ?? {}),
              Rows: raw?.Rows ?? sourceRows,
              Columns: raw?.Columns ?? sourceCols,
              ImagePositionPatient: imagePositionPatient,
              ImageOrientationPatient: imageOrientationPatient,
              FrameOfReferenceUID: pickString(
                raw?.FrameOfReferenceUID,
                instance?.FrameOfReferenceUID,
                instance?.frameOfReferenceUID,
                fallbackFrameOfReferenceUID,
              ),
              SeriesInstanceUID: pickString(
                raw?.SeriesInstanceUID,
                instance?.SeriesInstanceUID,
                instance?.seriesInstanceUID,
                fallbackSeriesInstanceUID,
              ),
              SOPInstanceUID: pickString(
                raw?.SOPInstanceUID,
                instance?.SOPInstanceUID,
                instance?.sopInstanceUID,
              ),
              NumberOfFrames: 1,
            };
          }

          return raw;
        },
      };

      // Parse the DICOM SEG using the adapter. createFromDICOMSegBuffer
      // creates derived labelmap images (with derived:{uuid} imageIds) for
      // every source image, spatially matches each SEG frame to the correct
      // source image, and writes pixel data directly into the matched images.
      const result = await adaptersSEG.Cornerstone3D.Segmentation.createFromDICOMSegBuffer(
        adapterSourceImageIds,
        loadBuffer,
        {
          metadataProvider: loadMetadataProvider,
        },
      );

      const segMetadata = result.segMetadata;

      // Unwrap the nested array structure.
      // result.labelMapImages is [[img0, img1, ...imgN]] for non-overlapping,
      // or [[group1imgs...], [group2imgs...]] for overlapping.
      const rawLabelMapImages = result.labelMapImages;
      let adapterImages: any[];
      if (
        Array.isArray(rawLabelMapImages) &&
        rawLabelMapImages.length > 0 &&
        Array.isArray(rawLabelMapImages[0])
      ) {
        adapterImages = rawLabelMapImages[0];
        console.log(
          `[segmentationService] Unwrapped nested labelMapImages: ` +
          `${rawLabelMapImages.length} group(s), first group has ${adapterImages.length} images`,
        );
      } else {
        adapterImages = rawLabelMapImages ?? [];
        console.log(
          `[segmentationService] labelMapImages is flat array with ${adapterImages.length} images`,
        );
      }

      // Extract segment metadata for labels and colors
      const segments: Record<number, any> = {};
      const colorMap = new Map<number, [number, number, number, number]>();
      if (segMetadata?.data) {
        for (let i = 1; i < segMetadata.data.length; i++) {
          const meta = segMetadata.data[i];
          if (!meta) continue;

          const segLabel = meta.SegmentLabel || meta.SegmentDescription || `Segment ${i}`;
          segments[i] = {
            label: segLabel,
            locked: true,
            active: i === 1,
            segmentIndex: i,
            cachedStats: {},
          };

          // Extract RecommendedDisplayCIELabValue and convert to RGBA
          if (meta.RecommendedDisplayCIELabValue?.length >= 3) {
            const rgb = (dcmjsData as any).Colors?.dicomlab2RGB?.(meta.RecommendedDisplayCIELabValue);
            if (Array.isArray(rgb) && rgb.length >= 3) {
              colorMap.set(i, [
                Math.round(rgb[0] * 255),
                Math.round(rgb[1] * 255),
                Math.round(rgb[2] * 255),
                255,
              ]);
            }
          }
        }
      }
      // ─── Find first non-zero reference before we clean up adapter images ───
      const { referencedImageId, labelmapImageId } = findFirstNonZeroRef(adapterImages);

      // ─── Map adapter images to base source image IDs for pixel extraction ───
      const adapterImageBySourceId = new Map<string, any>();
      for (const adapterImg of adapterImages) {
        if (!adapterImg || !adapterImg.imageId) continue;
        const baseId = resolveBaseImageId(adapterImg.referencedImageId);
        adapterImageBySourceId.set(baseId, adapterImg);
      }

      // ─── Scan adapter images for unique segment indices ───
      const uniqueSegmentIndices = new Set<number>();
      for (const adapterImg of adapterImages) {
        if (!adapterImg) continue;
        let pixels: any = null;
        try {
          if (adapterImg.voxelManager) pixels = adapterImg.voxelManager.getScalarData();
          else if (typeof adapterImg.getPixelData === 'function') pixels = adapterImg.getPixelData();
        } catch { pixels = null; }
        if (!pixels) continue;
        for (let k = 0; k < pixels.length; k++) {
          if (pixels[k] > 0) uniqueSegmentIndices.add(pixels[k]);
        }
      }
      const sortedSegIndices = Array.from(uniqueSegmentIndices).sort((a, b) => a - b);
      console.log(`[segmentationService] DICOM SEG contains segment indices: [${sortedSegIndices.join(', ')}]`);

      // Determine group label from DICOM metadata
      const groupLabel = (() => {
        const headerMeta = segMetadata?.data?.[0];
        if (headerMeta?.SeriesDescription) return headerMeta.SeriesDescription;
        if (headerMeta?.ContentDescription) return headerMeta.ContentDescription;
        if (headerMeta?.ContentLabel) return headerMeta.ContentLabel;
        const firstSegMeta = segMetadata?.data?.[1];
        if (firstSegMeta?.SegmentLabel) return firstSegMeta.SegmentLabel;
        segmentationCounter++;
        return `Segmentation ${segmentationCounter}`;
      })();

      // ─── Create multi-layer group ───
      const loadPlane = metaData.get('imagePlaneModule', effectiveBaseSourceImageIds[0]) as any;
      const loadRowSpacing = Number(loadPlane?.rowPixelSpacing) || 1;
      const loadColSpacing = Number(loadPlane?.columnPixelSpacing) || 1;

      mlg.initGroupSlots(segmentationId);
      mlg.initSegmentMetaMap(segmentationId);
      mlg.setGroupDimensions(segmentationId, {
        rows: sourceRows,
        columns: sourceCols,
        rowPixelSpacing: loadRowSpacing,
        columnPixelSpacing: loadColSpacing,
        sourceImageIds: [...effectiveBaseSourceImageIds],
      });
      mlg.setGroupLabel(segmentationId, groupLabel);
      sourceImageTracking.setSourceImageIds(segmentationId, [...effectiveBaseSourceImageIds]);

      const genericMeta = (csUtilities as any).genericMetadataProvider;
      let refGeneralSeriesMeta: any = null;
      for (const srcId of effectiveBaseSourceImageIds) {
        refGeneralSeriesMeta = metaData.get('generalSeriesModule', srcId);
        if (refGeneralSeriesMeta) break;
      }

      const pixelCount = sourceRows * sourceCols;
      const subSegIds = mlg.getGroupSlots(segmentationId)!;
      const metaMapForGroup = mlg.getSegmentMetaMap(segmentationId)!;

      // ─── Create per-segment sub-segmentations with binary labelmaps ───
      for (const segIdx of sortedSegIndices) {
        const segmentIndex = subSegIds.length + 1; // 1-based position in group
        const meta = segments[segIdx];
        const segLabel = meta?.label ?? `Segment ${segmentIndex}`;
        const segColor = colorMap.get(segIdx) ?? DEFAULT_COLORS[(segmentIndex - 1) % DEFAULT_COLORS.length];

        const subSegId = `${segmentationId}_layer_${segmentIndex}`;
        const subSegLmImageIds: string[] = [];

        // Create binary labelmap images (0/1) for this segment
        for (let i = 0; i < effectiveBaseSourceImageIds.length; i++) {
          const srcImageId = effectiveBaseSourceImageIds[i];
          const lmImageId = `generated:labelmap_${subSegId}_${i}`;

          // Extract binary data from the adapter's combined image
          const binaryData = new Uint8Array(pixelCount);
          const adapterImg = adapterImageBySourceId.get(srcImageId);
          if (adapterImg) {
            let adapterPixels: any = null;
            try {
              if (adapterImg.voxelManager) adapterPixels = adapterImg.voxelManager.getScalarData();
              else if (typeof adapterImg.getPixelData === 'function') adapterPixels = adapterImg.getPixelData();
            } catch { adapterPixels = null; }
            if (adapterPixels) {
              for (let p = 0; p < pixelCount && p < adapterPixels.length; p++) {
                if (Number(adapterPixels[p]) === segIdx) {
                  binaryData[p] = 1;
                }
              }
            }
          }

          const imagePlane = metaData.get('imagePlaneModule', srcImageId);
          imageLoader.createAndCacheLocalImage(lmImageId, {
            scalarData: binaryData,
            dimensions: [sourceCols, sourceRows],
            spacing: [loadColSpacing, loadRowSpacing],
            origin: imagePlane?.imagePositionPatient,
            direction: imagePlane?.imageOrientationPatient,
            frameOfReferenceUID: imagePlane?.frameOfReferenceUID,
            referencedImageId: srcImageId,
          } as any);

          if (refGeneralSeriesMeta) {
            genericMeta.add(lmImageId, {
              type: 'generalSeriesModule',
              metadata: refGeneralSeriesMeta,
            });
          }

          subSegLmImageIds.push(lmImageId);
        }

        // Register as independent Cornerstone segmentation (segment index 1)
        csSegmentation.addSegmentations([{
          segmentationId: subSegId,
          representation: {
            type: ToolEnums.SegmentationRepresentations.Labelmap,
            data: { imageIds: subSegLmImageIds } as any,
          },
          config: {
            label: segLabel,
            segments: {
              1: {
                label: segLabel,
                segmentIndex: 1,
                locked: true,
                active: segmentIndex === 1,
                cachedStats: {},
              } as any,
            },
          },
        }]);

        // Lock loaded segments by default — user must unlock to edit
        csSegmentation.segmentLocking.setSegmentIndexLocked(subSegId, 1, true);

        // Track source imageIds on the sub-seg
        sourceImageTracking.setSourceImageIds(subSegId, [...effectiveBaseSourceImageIds]);

        // Update group registry
        subSegIds.push(subSegId);
        mlg.setGroupInfoForSubSeg(subSegId, { groupId: segmentationId, segmentIndex });
        metaMapForGroup.set(segmentIndex, {
          label: segLabel,
          color: segColor,
          locked: true,
        });

        console.log(`[segmentationService] Created sub-seg ${subSegId} for adapter segment ${segIdx} → group index ${segmentIndex}: "${segLabel}"`);
      }

      // Store loaded colors (remapped from adapter segment index → group segment index)
      // so addToViewport() can apply them when attaching to viewports.
      if (colorMap.size > 0) {
        const remappedColors = new Map<number, [number, number, number, number]>();
        let groupIdx = 0;
        for (const segIdx of sortedSegIndices) {
          groupIdx++;
          const color = colorMap.get(segIdx);
          if (color) remappedColors.set(groupIdx, color);
        }
        if (remappedColors.size > 0) {
          loadedColorsMap.set(segmentationId, remappedColors);
        }
      }

      // Clean up adapter's combined images from cache to free memory
      for (const adapterImg of adapterImages) {
        if (!adapterImg?.imageId) continue;
        try { cache.removeImageLoadObject(adapterImg.imageId); } catch { /* ok */ }
      }

      // Update store
      const store = useSegmentationStore.getState();
      store.setActiveSegmentation(segmentationId);
      store.setActiveSegmentIndex(1);
      // Set active segment index 1 on the first sub-seg
      if (subSegIds.length > 0 && subSegIds[0]) {
        csSegmentation.segmentIndex.setActiveSegmentIndex(subSegIds[0], 1);
      }

      console.log(
        `[segmentationService] Loaded DICOM SEG as multi-layer group: ${segmentationId}`,
        `(${sortedSegIndices.length} segments as sub-segmentations, ${effectiveBaseSourceImageIds.length} slices)`,
      );

      syncSegmentations();
      return {
        segmentationId,
        firstNonZeroReferencedImageId: referencedImageId,
        firstNonZeroLabelmapImageId: labelmapImageId,
      };
    } catch (err) {
      console.error('[segmentationService] Failed to load DICOM SEG:', err);
      throw err;
    } finally {
      suppressDirtyTrackingCount--;
    }
  },

  /**
   * Ensure a Contour representation exists for the given segmentation on the viewport.
   * If it already exists, this is a no-op. Called when activating contour tools.
   */
  async ensureContourRepresentation(viewportId: string, segmentationId: string): Promise<void> {
    try {
      const seg = csSegmentation.state.getSegmentation(segmentationId);
      if (!seg) return;

      // 1. Ensure Contour representation data exists on the segmentation.
      //    This is normally set at creation time, but check again in case
      //    the segmentation was created before contour support was added.
      contourRep.ensureContourRepresentation(segmentationId);

      // 2. Ensure segments array has entries with all required properties.
      const activeIdxRaw = useSegmentationStore.getState().activeSegmentIndex;
      const activeIdx =
        Number.isFinite(activeIdxRaw) && Number.isInteger(activeIdxRaw) && activeIdxRaw >= 0
          ? activeIdxRaw
          : 1;
      if (!seg.segments) {
        (seg as any).segments = {};
      }
      const indicesToEnsure = activeIdx === 0 ? [0] : [0, activeIdx];
      for (const idx of indicesToEnsure) {
        if (!seg.segments[idx]) {
          (seg.segments as any)[idx] = {
            segmentIndex: idx,
            label: idx === 0 ? 'Background' : `Segment ${idx}`,
            locked: idx !== 0,
            cachedStats: {},
            active: idx === activeIdx,
          };
        } else if (seg.segments[idx].locked === undefined) {
          (seg.segments[idx] as any).locked = idx !== 0;
          (seg.segments[idx] as any).cachedStats = seg.segments[idx].cachedStats ?? {};
          (seg.segments[idx] as any).active = seg.segments[idx].active ?? (idx === activeIdx);
        }
      }

      // 3. Add contour representation to the viewport (no-op if already exists).
      csSegmentation.addContourRepresentationToViewport(viewportId, [
        { segmentationId },
      ]);

      // Ensure active contour segment has a valid color entry.
      if (activeIdx > 0) {
        let hasColor = false;
        try {
          const c = csSegmentation.config.color.getSegmentIndexColor(viewportId, segmentationId, activeIdx);
          hasColor = hasUsableColor(c);
        } catch {
          hasColor = false;
        }
        if (!hasColor) {
          const fallback = DEFAULT_COLORS[(activeIdx - 1) % DEFAULT_COLORS.length];
          csSegmentation.config.color.setSegmentIndexColor(
            viewportId,
            segmentationId,
            activeIdx,
            fallback as any,
          );
        }
      }

      // Set as active segmentation
      csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);

      // Apply contour style
      this.updateContourStyle();

      console.log(`[segmentationService] Ensured contour representation: ${viewportId} / ${segmentationId}`);
    } catch (err) {
      console.error('[segmentationService] ensureContourRepresentation failed:', err);
    }
  },

  /**
   * Update global contour representation style.
   * Contours use outline-only rendering (no fill) with opacity 1.
   */
  updateContourStyle(lineWidth?: number): void {
    try {
      const store = useSegmentationStore.getState();
      const width = Math.max(1, Math.min(8, Math.round(lineWidth ?? store.contourLineWidth ?? 2)));
      const opacity = Math.max(0.05, Math.min(1, store.contourOpacity ?? 1));
      csSegmentation.segmentationStyle.setStyle(
        { type: ToolEnums.SegmentationRepresentations.Contour },
        {
          renderFill: false,
          renderOutline: true,
          outlineWidth: width,
          outlineOpacity: opacity,
          renderFillInactive: false,
          renderOutlineInactive: true,
          outlineWidthInactive: Math.max(1, width - 1),
          outlineOpacityInactive: Math.max(0.05, opacity * 0.6),
        },
      );
      renderAllSegmentationViewports();
    } catch (err) {
      console.error('[segmentationService] Failed to update contour style:', err);
    }
  },

  /**
   * Export a segmentation as a DICOM SEG binary (base64-encoded).
   * Delegates to ./segmentationService/dicomSegExport (see that module for the
   * full pipeline + multi-layer-group compositing).
   */
  async exportToDicomSeg(segmentationId: string): Promise<string> {
    return dicomSegExport.exportToDicomSeg(segmentationId);
  },

  /**
   * Export a multi-layer group to DICOM SEG (composite sub-seg layers).
   * Delegates to ./segmentationService/dicomSegExport.
   */
  async _exportGroupToDicomSeg(groupId: string): Promise<string> {
    return dicomSegExport._exportGroupToDicomSeg(groupId);
  },

  /**
   * Track source image IDs for a segmentation (used for DICOM SEG/RTSTRUCT export).
   * Called by rtStructService when loading RTSTRUCT contours.
   */
  trackSourceImageIds(segmentationId: string, imageIds: string[]): void {
    sourceImageTracking.setSourceImageIds(segmentationId, [...imageIds]);
  },

  /**
   * Return tracked source image IDs for a segmentation (copy), if available.
   * Used by RTSTRUCT export to copy source DICOM identity fields.
   */
  getTrackedSourceImageIds(segmentationId: string): string[] | null {
    const ids = sourceImageTracking.getSourceImageIds(segmentationId);
    return ids ? [...ids] : null;
  },

  /**
   * Infer preferred DICOM object type for a segmentation.
   * Contour-only segmentations map to RTSTRUCT; labelmap or mixed map to SEG.
   */
  getPreferredDicomType(segmentationId: string): 'SEG' | 'RTSTRUCT' {
    return getSegmentationType(segmentationId) === 'contour' ? 'RTSTRUCT' : 'SEG';
  },

  /**
   * Returns whether a segmentation currently has any drawable/exportable content.
   * Used by UI save flows to avoid hard export errors for empty annotations.
   */
  hasExportableContent(segmentationId: string, targetType?: 'SEG' | 'RTSTRUCT'): boolean {
    const hasNonZeroPixels = (img: any): boolean => {
      if (!img) return false;
      const scalarData: any =
        img.voxelManager?.getScalarData?.()
        ?? img.imageFrame?.pixelData
        ?? img.getPixelData?.();
      if (!scalarData || typeof scalarData.length !== 'number') return false;
      for (let i = 0; i < scalarData.length; i++) {
        if (Number(scalarData[i]) > 0) return true;
      }
      return false;
    };

    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      if (targetType === 'RTSTRUCT') return false; // groups are labelmap-only
      // Check if any sub-seg has non-zero pixels
      const subSegIds = getActiveSubSegIds(segmentationId);
      for (const subSegId of subSegIds) {
        const subSeg = csSegmentation.state.getSegmentation(subSegId);
        const imageIds: string[] = (subSeg?.representationData as any)?.Labelmap?.imageIds ?? [];
        for (const imageId of imageIds) {
          if (hasNonZeroPixels(cache.getImage(imageId))) return true;
        }
      }
      return false;
    }

    // ─── Legacy path ────────────────────────────────────────
    const seg = csSegmentation.state.getSegmentation(segmentationId);
    if (!seg) return false;

    const checkContour = targetType === 'RTSTRUCT' || targetType == null;
    const checkLabelmap = targetType === 'SEG' || targetType == null;

    if (checkContour) {
      if (contourRep.hasAnyAnnotations(segmentationId)) return true;
      if (targetType === 'RTSTRUCT') return false;
    }

    if (!checkLabelmap) return false;

    const labelmapData = (seg.representationData as any)?.Labelmap;
    const imageIds: string[] = labelmapData?.imageIds ?? [];
    if (!Array.isArray(imageIds) || imageIds.length === 0) return false;

    for (const imageId of imageIds) {
      if (hasNonZeroPixels(cache.getImage(imageId))) {
        return true;
      }
    }

    return false;
  },

  // ─── Undo / Redo ──────────────────────────────────────────────

  /**
   * Undo the last segmentation/contour edit.
   * Uses Cornerstone3D's DefaultHistoryMemo ring buffer.
   */
  undo(): void {
    // A8: when a container is active, undo is PER-CONTAINER (and never touches the
    // global ring — so the two paths never double-drive the same memo). With no
    // active container (legacy brush flow / E2E) it falls back to the global ring.
    const acid = activeUndoContainerId();
    if (acid) {
      if (perContainerHistory.undo(acid)) {
        syncSegmentations();
        renderAllSegmentationViewports();
      }
      refreshUndoState();
      return;
    }

    const lockedTargets = getLockedHistoryTargets(getTopUndoHistoryEntry());
    if (lockedTargets.length > 0) {
      showHistoryBlockedDialog('undo', lockedTargets);
      refreshUndoState();
      return;
    }

    try {
      DefaultHistoryMemo?.undo?.();
    } catch (err) {
      console.warn('[segmentationService] Undo failed:', err);
    }
    syncSegmentations();
    renderAllSegmentationViewports();
    refreshUndoState();
  },

  /**
   * Redo a previously undone edit.
   */
  redo(): void {
    const acid = activeUndoContainerId();
    if (acid) {
      if (perContainerHistory.redo(acid)) {
        syncSegmentations();
        renderAllSegmentationViewports();
      }
      refreshUndoState();
      return;
    }

    const lockedTargets = getLockedHistoryTargets(getTopRedoHistoryEntry());
    if (lockedTargets.length > 0) {
      showHistoryBlockedDialog('redo', lockedTargets);
      refreshUndoState();
      return;
    }

    try {
      DefaultHistoryMemo?.redo?.();
    } catch (err) {
      console.warn('[segmentationService] Redo failed:', err);
    }
    syncSegmentations();
    renderAllSegmentationViewports();
    refreshUndoState();
  },

  /**
   * Get current undo/redo availability (for external callers).
   */
  getUndoState(): { canUndo: boolean; canRedo: boolean } {
    return {
      canUndo: !!DefaultHistoryMemo?.canUndo,
      canRedo: !!DefaultHistoryMemo?.canRedo,
    };
  },

  // ─── Per-container undo / redo (A8) ───────────────────────────
  // Partitioned undo: an edit is undone within its own container only; switching
  // the active container does not clear either history; saving is not a barrier
  // (undo past a save re-marks dirty). The toolbar/keyboard wiring to the ACTIVE
  // container lands in Phase 3 with the list panel; these are the mechanism.

  /** Undo the last edit of one container. */
  undoContainer(containerId: string): void {
    if (!perContainerHistory.undo(containerId)) return;
    syncSegmentations();
    renderAllSegmentationViewports();
    refreshUndoState();
  },

  /** Redo the last undone edit of one container. */
  redoContainer(containerId: string): void {
    if (!perContainerHistory.redo(containerId)) return;
    syncSegmentations();
    renderAllSegmentationViewports();
    refreshUndoState();
  },

  /** Per-container undo/redo availability. */
  getContainerUndoState(containerId: string): { canUndo: boolean; canRedo: boolean } {
    return {
      canUndo: perContainerHistory.canUndo(containerId),
      canRedo: perContainerHistory.canRedo(containerId),
    };
  },

  /** Drop one container's undo history (external-change reload — E3 / H6). */
  clearContainerHistory(containerId: string): void {
    perContainerHistory.clear(containerId);
    refreshUndoState();
  },

  // ─── Queue-next-save autosave (A9 / E2 / Slice 5) ─────────────
  // The queue/debounce/retry mechanism. The live driver (Phase-3 gesture
  // interceptor → notifyContainerDirty; transport workstream → setSaveTransport)
  // adopts these; until then the legacy backupService autosave stays live.

  /** Mark a container dirty for the debounced queue-next-save autosave. */
  notifyContainerDirty(containerId: string): void {
    saveQueue.notifyDirty(containerId);
  },

  /** Manual save now — flushes the pending debounce and serializes immediately. */
  flushContainerSave(containerId: string): Promise<void> {
    return saveQueue.flush(containerId);
  },

  /** Per-container dirty/in-flight inspection (D7 row state). */
  getContainerSaveState(containerId: string): { dirty: boolean; inFlight: boolean } {
    return saveQueue.state(containerId);
  },

  /** Set whether a gesture is in progress (autosave must not fire mid-gesture). */
  setGestureActive(active: boolean): void {
    gestureActive = active;
  },

  /** Inject the per-container save transport (the deferred transport workstream). */
  setSaveTransport(fn: (containerId: string) => Promise<SaveOutcome>): void {
    saveTransport = fn;
  },

  /** Opt into driving the per-container saveQueue from edits (autosave-to-XNAT). Default off. */
  setXnatAutosaveEnabled(enabled: boolean): void {
    xnatAutosaveEnabled = enabled;
  },

  /**
   * Cancel any pending auto-save timer (e.g. when a manual save starts).
   */
  cancelAutoSave,

  /**
   * Immediately attempt an auto-save draft, regardless of the auto-save toggle.
   * Used by navigation/disconnect flows when prompting users to save changes.
   */
  async flushAutoSaveNow(): Promise<boolean> {
    cancelAutoSave();
    return performAutoSave(true);
  },

  /**
   * Signal that a SEG/RTSTRUCT load operation is starting.
   * While load is in progress, auto-save is blocked to prevent exporting
   * incomplete data (which causes PixelData size mismatch errors).
   * Must be paired with endSegLoad() in a try/finally.
   */
  beginSegLoad(): void { loadInProgressCount++; },

  /**
   * Signal that a SEG/RTSTRUCT load operation has completed.
   * Call this AFTER the double-rAF + _markClean() pattern to ensure
   * auto-save remains suppressed until all async renders complete.
   */
  endSegLoad(): void { loadInProgressCount = Math.max(0, loadInProgressCount - 1); },

  /**
   * Signal that a manual save/export is starting.
   * Cancels any pending auto-save and blocks new auto-saves from being
   * scheduled until endManualSave() is called. Must be paired with
   * endManualSave() in a try/finally to prevent permanently blocking auto-save.
   */
  beginManualSave(): void {
    manualSaveInProgress = true;
    cancelAutoSave();
  },

  /**
   * Signal that a manual save/export has completed (or failed).
   * Re-enables auto-save scheduling. Always call in a finally block.
   */
  endManualSave(): void {
    manualSaveInProgress = false;
  },

  /**
   * Force a re-sync of segmentation summaries (e.g. after viewport changes).
   */
  sync: syncSegmentations,

  /**
   * Remove all event listeners and clean up.
   */
  dispose(): void {
    if (!initialized) return;

    const Events = ToolEnums.Events;
    unregisterSegmentationServiceEventBindings(
      eventTarget as any,
      Events as any,
      {
        onSegmentationEvent: onSegmentationEvent as EventListener,
        onSegmentationDataModified: onSegmentationDataModified as EventListener,
        onAnnotationAutoSave: onAnnotationAutoSave as EventListener,
        onAnnotationHistoryEvent: onAnnotationHistoryEvent as EventListener,
        onAnnotationSelectionChange: syncSelectedContourAnnotation as EventListener,
      },
    );

    // Cancel pending auto-save
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    if (labelmapInterpolationTimer) {
      clearTimeout(labelmapInterpolationTimer);
      labelmapInterpolationTimer = null;
    }
    labelmapInterpolationInProgress = false;
    uninstallHistoryMemoTracking();
    perContainerHistory.clearAll();
    saveQueue.reset();
    gestureActive = false;
    xnatAutosaveEnabled = false;

    // Clean up module-level state. sourceImageTracking.dispose() both
    // unsubscribes its auto-cleanup listener and clears its map.
    sourceImageTracking.dispose();
    interpolationAcceptance.dispose();
    loadedColorsMap.clear();
    // NOTE: mlg.clearAll() also clears `groupViewportAttachments` and
    // `metadataPreloadPromises`, which were NOT cleared in the pre-facade
    // dispose code. Pre-facade this was a dispose-time state leak; the
    // facade's teardown is symmetric across all 7 maps.
    mlg.clearAll();
    segmentationCounter = 0;

    initialized = false;
    console.log('[segmentationService] Disposed');
  },
};
