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
import { rtStructService } from './rtStructService';
import * as contourRep from './contourRepresentation';
import * as sourceImageTracking from './sourceImageTracking';
import * as mlg from './multiLayerGroup';
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

const SEGMENTED_PROPERTY_CATEGORY_CODE = Object.freeze({
  CodeValue: '91723000',
  CodingSchemeDesignator: 'SCT',
  CodeMeaning: 'Anatomical structure',
});

const SEGMENTED_PROPERTY_TYPE_CODE = Object.freeze({
  CodeValue: '85756007',
  CodingSchemeDesignator: 'SCT',
  CodeMeaning: 'Tissue',
});

/**
 * Cornerstone3D's built-in undo/redo ring buffer.
 * All segmentation/contour tools automatically push memos here via BaseTool.doneEditMemo().
 */
const { DefaultHistoryMemo } = (csUtilities as any).HistoryMemo;

type HistoryMemoRecord = {
  restoreMemo?: (undo?: boolean) => void;
  id?: string;
  operationType?: string;
  segmentationId?: string;
  segmentIndex?: number;
  label?: string;
  createMemo?: () => HistoryMemoRecord | undefined;
};

type HistoryMemoEntry = HistoryMemoRecord | HistoryMemoRecord[] | undefined;

type LockableHistoryTarget = {
  segmentationId: string;
  segmentIndex: number;
  label: string;
};

let originalHistoryPush: ((item: unknown) => HistoryMemoRecord | undefined) | null = null;
let historyTrackingInstalled = false;

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

function toHistoryMemoRecords(entry: HistoryMemoEntry): HistoryMemoRecord[] {
  if (!entry) return [];
  if (Array.isArray(entry)) {
    return entry.filter((memo): memo is HistoryMemoRecord => !!memo && typeof memo === 'object');
  }
  return typeof entry === 'object' ? [entry] : [];
}

function getHistoryRingSize(): number {
  const explicitSize = Number(DefaultHistoryMemo?.size);
  if (Number.isInteger(explicitSize) && explicitSize > 0) {
    return explicitSize;
  }
  const ringLength = Array.isArray(DefaultHistoryMemo?.ring) ? DefaultHistoryMemo.ring.length : 0;
  return ringLength > 0 ? ringLength : 0;
}

function getTopUndoHistoryEntry(): HistoryMemoEntry {
  if (!DefaultHistoryMemo?.canUndo || !Array.isArray(DefaultHistoryMemo?.ring)) {
    return undefined;
  }

  const size = getHistoryRingSize();
  const position = Number(DefaultHistoryMemo.position);
  if (!Number.isInteger(position) || size <= 0) {
    return undefined;
  }

  const normalizedPosition = ((position % size) + size) % size;
  return DefaultHistoryMemo.ring[normalizedPosition] as HistoryMemoEntry;
}

function getTopRedoHistoryEntry(): HistoryMemoEntry {
  if (!DefaultHistoryMemo?.canRedo || !Array.isArray(DefaultHistoryMemo?.ring)) {
    return undefined;
  }

  const size = getHistoryRingSize();
  const position = Number(DefaultHistoryMemo.position);
  if (!Number.isInteger(position) || size <= 0) {
    return undefined;
  }

  const nextPosition = (position + 1 + size) % size;
  return DefaultHistoryMemo.ring[nextPosition] as HistoryMemoEntry;
}

function enrichHistoryMemoRecord(memo: unknown): void {
  if (!memo || typeof memo !== 'object') return;

  const record = memo as HistoryMemoRecord;
  if (
    typeof record.segmentationId === 'string'
    && Number.isInteger(record.segmentIndex)
    && Number(record.segmentIndex) > 0
  ) {
    record.label = record.label || getSegmentDisplayLabel(record.segmentationId, Number(record.segmentIndex));
    return;
  }

  if (record.operationType !== 'annotation' || typeof record.id !== 'string') {
    return;
  }

  const annotation = csAnnotation.state.getAnnotation?.(record.id);
  const segmentationId = annotation?.data?.segmentation?.segmentationId;
  const segmentIndex = Number(annotation?.data?.segmentation?.segmentIndex);
  if (typeof segmentationId !== 'string' || !Number.isInteger(segmentIndex) || segmentIndex <= 0) {
    return;
  }

  record.segmentationId = segmentationId;
  record.segmentIndex = segmentIndex;
  record.label = getSegmentDisplayLabel(segmentationId, segmentIndex);
}

function getLockedHistoryTargets(entry: HistoryMemoEntry): LockableHistoryTarget[] {
  const deduped = new Map<string, LockableHistoryTarget>();

  for (const memo of toHistoryMemoRecords(entry)) {
    enrichHistoryMemoRecord(memo);
    const segmentationId = memo.segmentationId;
    const segmentIndex = Number(memo.segmentIndex);
    if (typeof segmentationId !== 'string' || !Number.isInteger(segmentIndex) || segmentIndex <= 0) {
      continue;
    }
    if (!isSegmentLockedInternal(segmentationId, segmentIndex)) {
      continue;
    }

    const key = `${segmentationId}|${segmentIndex}`;
    deduped.set(key, {
      segmentationId,
      segmentIndex,
      label: memo.label || getSegmentDisplayLabel(segmentationId, segmentIndex),
    });
  }

  return Array.from(deduped.values());
}

function showHistoryBlockedDialog(action: 'undo' | 'redo', targets: LockableHistoryTarget[]): void {
  if (targets.length === 0) return;

  const title = action === 'undo' ? 'Undo blocked' : 'Redo blocked';
  const names = targets.map((target) => target.label);
  const uniqueNames = Array.from(new Set(names));
  const message = action === 'undo'
    ? (
      uniqueNames.length === 1
        ? `Unlock ${uniqueNames[0]} before applying undo.`
        : `Unlock these annotations before applying undo:\n${uniqueNames.map((name) => `- ${name}`).join('\n')}`
    )
    : `Unlock the locked annotations before applying redo:\n${uniqueNames.map((name) => `- ${name}`).join('\n')}`;

  void showAlertDialog({
    title,
    message,
    confirmLabel: 'OK',
  });
}

function installHistoryMemoTracking(): void {
  if (historyTrackingInstalled || !DefaultHistoryMemo || typeof DefaultHistoryMemo.push !== 'function') {
    return;
  }

  originalHistoryPush = DefaultHistoryMemo.push.bind(DefaultHistoryMemo);
  DefaultHistoryMemo.push = ((item: unknown) => {
    const memo = originalHistoryPush?.(item);
    enrichHistoryMemoRecord(memo);
    return memo;
  }) as typeof DefaultHistoryMemo.push;
  historyTrackingInstalled = true;
}

function uninstallHistoryMemoTracking(): void {
  if (!historyTrackingInstalled || !DefaultHistoryMemo || !originalHistoryPush) {
    return;
  }

  DefaultHistoryMemo.push = originalHistoryPush as typeof DefaultHistoryMemo.push;
  originalHistoryPush = null;
  historyTrackingInstalled = false;
}

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

/** Push canUndo/canRedo booleans into the Zustand store. */
function refreshUndoState(): void {
  useSegmentationStore.getState()._refreshUndoState(
    !!DefaultHistoryMemo?.canUndo,
    !!DefaultHistoryMemo?.canRedo,
  );
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

function toPoint3(value: unknown): Point3 | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const point = value.slice(0, 3).map((entry) => Number(entry)) as number[];
  if (point.some((entry) => !Number.isFinite(entry))) return null;
  return [point[0], point[1], point[2]] as Point3;
}

function addPoint3(a: Point3, b: Point3): Point3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Point3;
}

function subtractPoint3(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as Point3;
}

function dotPoint3(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

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
    if (!selected) return false;

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
      return false;
    }

    // Completeness guard: copy requires a drawable polyline. This was
    // previously enforced transitively via `isContourAnnotation` rejecting
    // annotations with <3 points, but that check now lives only here (and
    // other completeness-dependent sites) so in-progress contours stay
    // visible to selection sync.
    const polyline = clonePolyline(annotation.data.contour?.polyline);
    if (polyline.length < 3) return false;

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
    if (!contourClipboard) return false;
    if (this.getSegmentLocked(contourClipboard.segmentationId, contourClipboard.segmentIndex)) {
      return false;
    }

    const targetImageId = getCurrentImageIdForActiveViewport();
    if (!targetImageId) return false;
    const viewportContext = getActiveViewportContextForContourPaste(targetImageId);
    if (!viewportContext) return false;

    const delta: Point3 = [0, 0, 0];
    if (targetImageId !== contourClipboard.referencedImageId) {
      const sourcePlane = getImagePlaneInfo(contourClipboard.referencedImageId);
      const targetPlane = getImagePlaneInfo(targetImageId);
      if (!sourcePlane || !targetPlane) return false;
      if (
        contourClipboard.frameOfReferenceUID &&
        targetPlane.frameOfReferenceUID &&
        contourClipboard.frameOfReferenceUID !== targetPlane.frameOfReferenceUID
      ) {
        return false;
      }
      if (Math.abs(dotPoint3(sourcePlane.normal, targetPlane.normal)) < 0.999) {
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
  toggleSegmentVisibility(
    viewportId: string,
    segmentationId: string,
    segmentIndex: number,
  ): void {
    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) return;
      // Read current visibility from sub-seg's segment index 1
      let currentVisible = true;
      const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(subSegId);
      if (vpIds.length > 0) {
        try {
          currentVisible = csSegmentation.config.visibility.getSegmentIndexVisibility(
            vpIds[0],
            { segmentationId: subSegId, type: ToolEnums.SegmentationRepresentations.Labelmap },
            1,
          );
        } catch {
          // default visible
        }
      }
      const newVisible = !currentVisible;
      for (const vpId of vpIds) {
        try {
          csSegmentation.config.visibility.setSegmentIndexVisibility(
            vpId,
            { segmentationId: subSegId, type: ToolEnums.SegmentationRepresentations.Labelmap },
            1,
            newVisible,
          );
        } catch {
          // ignore
        }
      }
      syncSegmentations();
      for (const vpId of vpIds) {
        try {
          csToolUtilities.segmentation.triggerSegmentationRender(vpId);
          const enabledElement = getEnabledElementByViewportId(vpId) as any;
          enabledElement?.viewport?.render?.();
        } catch {
          // Best effort
        }
      }
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    let currentVisible = true;
    try {
      currentVisible = csSegmentation.config.visibility.getSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
        segmentIndex,
      );
    } catch {
      try {
        currentVisible = csSegmentation.config.visibility.getSegmentIndexVisibility(
          viewportId,
          { segmentationId, type: ToolEnums.SegmentationRepresentations.Contour },
          segmentIndex,
        );
      } catch {
        // default visible
      }
    }

    const newVisible = !currentVisible;

    try {
      csSegmentation.config.visibility.setSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
        segmentIndex,
        newVisible,
      );
    } catch {
      // May not have labelmap representation
    }

    try {
      csSegmentation.config.visibility.setSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Contour },
        segmentIndex,
        newVisible,
      );
    } catch {
      // May not have contour representation
    }

    syncSegmentations();
    try {
      csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
      const enabledElement = getEnabledElementByViewportId(viewportId) as any;
      enabledElement?.viewport?.render?.();
    } catch {
      // Best effort render kick
    }
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
    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) return;
      const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(subSegId);
      for (const vpId of vpIds) {
        try {
          csSegmentation.config.visibility.setSegmentIndexVisibility(
            vpId,
            { segmentationId: subSegId, type: ToolEnums.SegmentationRepresentations.Labelmap },
            1,
            visible,
          );
        } catch {
          // ignore
        }
      }
      syncSegmentations();
      for (const vpId of vpIds) {
        try {
          csToolUtilities.segmentation.triggerSegmentationRender(vpId);
          const enabledElement = getEnabledElementByViewportId(vpId) as any;
          enabledElement?.viewport?.render?.();
        } catch {
          // Best effort
        }
      }
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    try {
      csSegmentation.config.visibility.setSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
        segmentIndex,
        visible,
      );
    } catch {
      // May not have labelmap representation
    }

    try {
      csSegmentation.config.visibility.setSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Contour },
        segmentIndex,
        visible,
      );
    } catch {
      // May not have contour representation
    }

    syncSegmentations();
    try {
      csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
      const enabledElement = getEnabledElementByViewportId(viewportId) as any;
      enabledElement?.viewport?.render?.();
    } catch {
      // Best effort render kick
    }
  },

  /**
   * Toggle lock for a segment (locked segments can't be painted over).
   */
  toggleSegmentLocked(segmentationId: string, segmentIndex: number): void {
    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) return;
      const isLocked = csSegmentation.segmentLocking.isSegmentIndexLocked(subSegId, 1);
      const newLocked = !isLocked;
      csSegmentation.segmentLocking.setSegmentIndexLocked(subSegId, 1, newLocked);
      // Update metadata
      const meta = mlg.getSegmentMetaMap(segmentationId)?.get(segmentIndex);
      if (meta) meta.locked = newLocked;
      // Update presentation cache BEFORE sync so syncSegmentations reads the correct value
      useSegmentationManagerStore.getState().setPresentation(segmentationId, segmentIndex, { locked: newLocked });
      syncSegmentations();
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    const isLocked = csSegmentation.segmentLocking.isSegmentIndexLocked(
      segmentationId,
      segmentIndex,
    );
    const newLocked = !isLocked;
    csSegmentation.segmentLocking.setSegmentIndexLocked(
      segmentationId,
      segmentIndex,
      newLocked,
    );
    // Update presentation cache BEFORE sync so syncSegmentations reads the correct value
    useSegmentationManagerStore.getState().setPresentation(segmentationId, segmentIndex, { locked: newLocked });
    syncSegmentations();
  },

  /**
   * Read the current visibility state of a segment from Cornerstone.
   * Tries Labelmap representation first, then Contour. Defaults to true.
   */
  getSegmentVisibility(
    viewportId: string,
    segmentationId: string,
    segmentIndex: number,
  ): boolean {
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) return true;
      const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(subSegId);
      if (vpIds.length === 0) return true;
      try {
        return csSegmentation.config.visibility.getSegmentIndexVisibility(
          vpIds[0],
          { segmentationId: subSegId, type: ToolEnums.SegmentationRepresentations.Labelmap },
          1,
        );
      } catch {
        return true;
      }
    }

    try {
      return csSegmentation.config.visibility.getSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
        segmentIndex,
      );
    } catch {
      try {
        return csSegmentation.config.visibility.getSegmentIndexVisibility(
          viewportId,
          { segmentationId, type: ToolEnums.SegmentationRepresentations.Contour },
          segmentIndex,
        );
      } catch {
        return true; // default visible
      }
    }
  },

  /**
   * Read the current lock state of a segment from Cornerstone.
   */
  getSegmentLocked(segmentationId: string, segmentIndex: number): boolean {
    return isSegmentLockedInternal(segmentationId, segmentIndex);
  },

  /**
   * Check whether the currently active segment is locked.
   * Returns true if the active segmentation + active segment index are locked.
   */
  isActiveSegmentLocked(): boolean {
    const segStore = useSegmentationStore.getState();
    const activeSegId = segStore.activeSegmentationId;
    const activeSegIdx = segStore.activeSegmentIndex;
    if (!activeSegId || !activeSegIdx || activeSegIdx <= 0) return false;
    return this.getSegmentLocked(activeSegId, activeSegIdx);
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
   *
   * Pipeline:
   * 1. Retrieve the Cornerstone segmentation state + source imageIds
   * 2. Get source image objects from cache (they provide DICOM metadata)
   * 3. Build labelmaps2D array + segment metadata for the adapter
   * 4. Call adaptersSEG.Cornerstone3D.Segmentation.generateSegmentation()
   * 5. Serialize derivation dataset to ArrayBuffer via dcmjs
   * 6. Return base64-encoded string for IPC transport
   */
  async exportToDicomSeg(segmentationId: string): Promise<string> {
    // ─── Multi-layer group path ─────────────────────────────
    // Composite all sub-seg binary layers into multi-valued labelmaps,
    // build a temporary Cornerstone segmentation for the legacy export path.
    if (isMultiLayerGroup(segmentationId)) {
      return this._exportGroupToDicomSeg(segmentationId);
    }

    // ─── Legacy (non-group) path ────────────────────────────
    const seg = csSegmentation.state.getSegmentation(segmentationId);
    if (!seg) {
      throw new Error(`[segmentationService] Segmentation not found: ${segmentationId}`);
    }

    const storedSrcImageIds = sourceImageTracking.getSourceImageIds(segmentationId);
    if (!storedSrcImageIds || storedSrcImageIds.length === 0) {
      throw new Error(
        '[segmentationService] No source imageIds tracked for this segmentation. ' +
        'Cannot export without source DICOM references.',
      );
    }
    // Work with a copy so sorting doesn't mutate the stored array
    const originalSrcImageIds = [...storedSrcImageIds];
    let srcImageIds = [...originalSrcImageIds];
    const originalIndexBySourceId = new Map<string, number>();
    const validIndexBySourceId = new Map<string, number>();
    originalSrcImageIds.forEach((id, idx) => {
      if (!originalIndexBySourceId.has(id)) {
        originalIndexBySourceId.set(id, idx);
      }
    });

    // Get labelmap imageIds from the segmentation's representation data
    const labelmapData = seg.representationData?.Labelmap;
    if (!labelmapData) {
      throw new Error('[segmentationService] Segmentation has no Labelmap representation data.');
    }
    const labelmapImageIds: string[] = (labelmapData as any).imageIds ?? [];
    if (labelmapImageIds.length === 0) {
      throw new Error('[segmentationService] Segmentation has no labelmap imageIds.');
    }

    console.log(`[segmentationService] Exporting DICOM SEG: ${segmentationId} (${labelmapImageIds.length} slices)`);

    // Step 1: Get source Cornerstone image objects (needed by generateSegmentation
    // for DICOM metadata extraction: study/series/image UIDs, pixel spacing, etc.)
    const sourceImages: any[] = [];
    const validSrcImageIds: string[] = [];
    const skippedSources: Array<{ srcId: string; index: number; error: string }> = [];
    for (const srcId of originalSrcImageIds) {
      const img = cache.getImage(srcId);
      if (!img) {
        skippedSources.push({
          srcId,
          index: originalIndexBySourceId.get(srcId) ?? -1,
          error: 'source image not cached',
        });
        continue;
      }
      const validIndex = validSrcImageIds.length;
      sourceImages.push(img);
      validSrcImageIds.push(srcId);
      validIndexBySourceId.set(srcId, validIndex);
    }
    if (sourceImages.length === 0) {
      const first = skippedSources[0];
      throw new Error(
        `[segmentationService] Could not load any source images for export. `
        + `${first ? `${first.srcId}: ${first.error}` : ''}`,
      );
    }
    srcImageIds = validSrcImageIds;
    if (skippedSources.length > 0) {
      console.warn(
        `[segmentationService] Skipping ${skippedSources.length}/${originalSrcImageIds.length} source images `
        + `that failed to load for export (likely non-image DICOM objects).`,
      );
    }

    // Step 2: Build labelmaps2D array — one entry per source image slice.
    // Each entry has { pixelData, segmentsOnLabelmap, rows, columns }.
    //
    // CRITICAL: labelmaps2D[i] must correspond to sourceImages[i] (and
    // srcImageIds[i]).  generateSegmentation pairs them by index.
    //
    // For stack-based segmentations, the brush tool writes pixel data into
    // the labelmap images managed by the SegmentationStateManager's
    // _stackLabelmapImageIdReferenceMap. We need to read the LIVE data
    // from those mapped images, not just the original registered imageIds
    // (which may point to stale/empty cache entries).
    //
    // Strategy: use csSegmentation.segmentation.getLabelmapImageIds() to get
    // the canonical imageIds, then try cache.getImage() for each. Also try
    // the viewport-mapped imageIds via getStackSegmentationImageIdsForViewport.
    const labelmaps2D: any[] = [];
    const rows = sourceImages[0].rows ?? sourceImages[0].height ?? 512;
    const columns = sourceImages[0].columns ?? sourceImages[0].width ?? 512;

    // Use the labelmap imageIds from the representation data directly.
    // DO NOT call getStackSegmentationImageIdsForViewport() — it triggers
    // _updateAllLabelmapSegmentationImageReferences() which is broken in v4.16
    // and corrupts the _stackLabelmapImageIdReferenceMap (maps all source images
    // to the same labelmap, causing bleed to all slices + extreme lag).
    const effectiveLmIds = labelmapImageIds;

    const toImageIdMatchKey = (imageId: string | undefined): string => {
      if (!imageId || typeof imageId !== 'string') return '';
      let key = imageId;
      if (key.startsWith('wadouri:')) key = key.slice('wadouri:'.length);
      if (key.startsWith('wadors:')) key = key.slice('wadors:'.length);
      key = key.replace(/\/frames\/\d+$/i, '');
      key = key
        .replace(/([?&])frame=\d+(&?)/gi, (_m, sep, tail) => (sep === '?' && tail ? '?' : tail ? sep : ''))
        .replace(/[?&]$/, '');
      return key;
    };
    const getSopUidForImageId = (imageId: string | undefined): string | undefined => {
      if (!imageId || typeof imageId !== 'string') return undefined;
      const gen = metaData.get('generalImageModule', imageId) as any;
      const inst = metaData.get('instance', imageId) as any;
      const metaUid = gen?.sopInstanceUID ?? inst?.SOPInstanceUID ?? inst?.sopInstanceUID;
      if (typeof metaUid === 'string' && metaUid.length > 0) return metaUid;
      const key = toImageIdMatchKey(imageId);
      const queryIndex = key.indexOf('?');
      if (queryIndex < 0) return undefined;
      const params = new URLSearchParams(key.slice(queryIndex + 1));
      const queryUid =
        params.get('objectUID')
        ?? params.get('objectUid')
        ?? params.get('SOPInstanceUID')
        ?? params.get('sopInstanceUID');
      return queryUid ?? undefined;
    };

    // Build source->labelmap lookup maps.
    const refIdToLabelmap = new Map<string, any>();
    const refKeyToLabelmap = new Map<string, any>();
    const refSopToLabelmap = new Map<string, any>();
    for (let li = 0; li < effectiveLmIds.length; li++) {
      const lmId = effectiveLmIds[li];
      if (!lmId) continue;
      const lmImage = cache.getImage(lmId);
      if (!lmImage) continue;
      const refId = (lmImage as any).referencedImageId;
      if (refId) {
        refIdToLabelmap.set(refId, lmImage);
        const refKey = toImageIdMatchKey(refId);
        if (refKey && !refKeyToLabelmap.has(refKey)) {
          refKeyToLabelmap.set(refKey, lmImage);
        }
        const refSopUid = getSopUidForImageId(refId);
        if (refSopUid && !refSopToLabelmap.has(refSopUid)) {
          refSopToLabelmap.set(refSopUid, lmImage);
        }
      }
    }
    const resolveMappedLabelmapImage = (value: any): any | undefined => {
      if (typeof value === 'string' && value.length > 0) {
        return cache.getImage(value);
      }
      if (Array.isArray(value)) {
        for (const candidate of value) {
          if (typeof candidate !== 'string' || candidate.length === 0) continue;
          const img = cache.getImage(candidate);
          if (img) return img;
        }
      }
      return undefined;
    };
    const stackRefIdToLabelmap = new Map<string, any>();
    const stackRefKeyToLabelmap = new Map<string, any>();
    const stackRefSopToLabelmap = new Map<string, any>();
    try {
      const mgr = csSegmentation.defaultSegmentationStateManager as any;
      const stackRefMap = mgr?._stackLabelmapImageIdReferenceMap?.get?.(segmentationId);
      if (stackRefMap && typeof stackRefMap.forEach === 'function') {
        stackRefMap.forEach((lmValue: any, refIdRaw: any) => {
          const refId = typeof refIdRaw === 'string' ? refIdRaw : String(refIdRaw ?? '');
          if (!refId) return;
          const lmImage = resolveMappedLabelmapImage(lmValue);
          if (!lmImage) return;
          stackRefIdToLabelmap.set(refId, lmImage);
          const refKey = toImageIdMatchKey(refId);
          if (refKey && !stackRefKeyToLabelmap.has(refKey)) {
            stackRefKeyToLabelmap.set(refKey, lmImage);
          }
          const refSopUid = getSopUidForImageId(refId);
          if (refSopUid && !stackRefSopToLabelmap.has(refSopUid)) {
            stackRefSopToLabelmap.set(refSopUid, lmImage);
          }
        });
      }
    } catch (err) {
      console.debug('[segmentationService] Could not read stack labelmap reference map:', err);
    }

    const resolveLabelmapImage = (srcId: string, sourceIndex: number): { image: any | undefined; match: 'ref' | 'normalized' | 'sop' | 'index' | 'none' } => {
      const stackExact = stackRefIdToLabelmap.get(srcId);
      if (stackExact) return { image: stackExact, match: 'ref' };
      const exact = refIdToLabelmap.get(srcId);
      if (exact) return { image: exact, match: 'ref' };

      const srcKey = toImageIdMatchKey(srcId);
      if (srcKey) {
        const stackNormalized = stackRefKeyToLabelmap.get(srcKey);
        if (stackNormalized) return { image: stackNormalized, match: 'normalized' };
        const normalized = refKeyToLabelmap.get(srcKey);
        if (normalized) return { image: normalized, match: 'normalized' };
      }

      const srcSopUid = getSopUidForImageId(srcId);
      if (srcSopUid) {
        const stackSopMatch = stackRefSopToLabelmap.get(srcSopUid);
        if (stackSopMatch) return { image: stackSopMatch, match: 'sop' };
        const sopMatch = refSopToLabelmap.get(srcSopUid);
        if (sopMatch) return { image: sopMatch, match: 'sop' };
      }

      const lmByIndex = cache.getImage(effectiveLmIds[sourceIndex]);
      if (lmByIndex) return { image: lmByIndex, match: 'index' };
      return { image: undefined, match: 'none' };
    };

    const getSliceHasPixels = (lmImage: any): boolean => {
      if (!lmImage) return false;
      const scalarData: any =
        lmImage.voxelManager?.getScalarData?.()
        ?? lmImage.imageFrame?.pixelData
        ?? lmImage.getPixelData?.();
      if (!scalarData || typeof scalarData.length !== 'number') return false;
      for (let i = 0; i < scalarData.length; i++) {
        if (Number(scalarData[i]) > 0) return true;
      }
      return false;
    };

    if (skippedSources.length > 0) {
      const skippedWithPaintedData = skippedSources.filter(({ srcId, index }) => {
        const fallbackIndex = index >= 0 && index < effectiveLmIds.length
          ? index
          : 0;
        const resolved = resolveLabelmapImage(srcId, fallbackIndex);
        return getSliceHasPixels(resolved.image);
      });
      if (skippedWithPaintedData.length > 0) {
        const first = skippedWithPaintedData[0];
        throw new Error(
          `[segmentationService] Cannot export SEG: source slice ${first.srcId} failed to load `
          + `(${first.error}) and contains segmentation data.`,
        );
      }
    }

    // Debug: sample first labelmap to understand its structure
    const sampleLmId = effectiveLmIds[0];
    if (sampleLmId) {
      const sampleImg = cache.getImage(sampleLmId);
      console.log(`[segmentationService] Sample labelmap [0]: id=${sampleLmId}, cached=${!!sampleImg}, hasVoxelManager=${!!sampleImg?.voxelManager}, referencedImageId=${(sampleImg as any)?.referencedImageId}`);
      if (sampleImg?.voxelManager) {
        const sd = sampleImg.voxelManager.getScalarData();
        let nonZero = 0;
        for (let k = 0; k < sd.length; k++) { if (sd[k] !== 0) nonZero++; }
        console.log(`[segmentationService] Sample labelmap scalar data: type=${sd.constructor.name}, length=${sd.length}, nonZero=${nonZero}`);
      }
    }

    const lookupStats = { ref: 0, normalized: 0, sop: 0, index: 0, none: 0 };
    for (let i = 0; i < srcImageIds.length; i++) {
      const srcId = srcImageIds[i];
      const sourceIndex = validIndexBySourceId.get(srcId) ?? i;
      const resolved = resolveLabelmapImage(srcId, sourceIndex);
      lookupStats[resolved.match]++;
      const lmImage = resolved.image;

      if (!lmImage) {
        labelmaps2D.push({
          pixelData: new Uint8Array(rows * columns),
          segmentsOnLabelmap: [],
          rows,
          columns,
        });
        continue;
      }

      // Get pixel data from the labelmap image.
      // scalarData may be Float32Array, Int16Array, etc. — we need Uint8 label values.
      let pixelData: Uint8Array;
      if (lmImage.voxelManager) {
        const scalarData = lmImage.voxelManager.getScalarData();
        if (scalarData instanceof Uint8Array || scalarData instanceof Uint8ClampedArray) {
          pixelData = new Uint8Array(scalarData);
        } else {
          pixelData = new Uint8Array(scalarData.length);
          for (let k = 0; k < scalarData.length; k++) {
            pixelData[k] = Math.max(0, Math.min(255, Math.round(scalarData[k])));
          }
        }
      } else if ((lmImage as any).getPixelData) {
        const raw = (lmImage as any).getPixelData();
        if (raw instanceof Uint8Array || raw instanceof Uint8ClampedArray) {
          pixelData = new Uint8Array(raw);
        } else {
          pixelData = new Uint8Array(raw.length);
          for (let k = 0; k < raw.length; k++) {
            pixelData[k] = Math.max(0, Math.min(255, Math.round(raw[k])));
          }
        }
      } else {
        pixelData = new Uint8Array(rows * columns);
      }

      // Find which segments are present on this slice
      const segmentsOnSlice = new Set<number>();
      for (let j = 0; j < pixelData.length; j++) {
        if (pixelData[j] > 0) {
          segmentsOnSlice.add(pixelData[j]);
        }
      }

      labelmaps2D.push({
        pixelData,
        segmentsOnLabelmap: sanitizeSegmentIndices(Array.from(segmentsOnSlice)),
        rows,
        columns,
      });
    }
    console.log(
      `[segmentationService] labelmap lookup: ref=${lookupStats.ref}, normalized=${lookupStats.normalized}, `
      + `sop=${lookupStats.sop}, index=${lookupStats.index}, none=${lookupStats.none}`,
    );

    // Step 3: Build segment metadata array (index 0 = null for background).
    const segmentMetadata: any[] = [null]; // index 0 = background
    if (seg.segments) {
      // seg.segments can be a Map or a plain object depending on Cornerstone version
      const segKeys: number[] = [];
      if (seg.segments instanceof Map) {
        for (const k of seg.segments.keys()) {
          const n = typeof k === 'number' ? k : parseInt(String(k), 10);
          if (n > 0 && !isNaN(n)) segKeys.push(n);
        }
      } else {
        for (const k of Object.keys(seg.segments)) {
          const n = parseInt(k, 10);
          if (n > 0 && !isNaN(n)) segKeys.push(n);
        }
      }
      const maxIdx = segKeys.length > 0 ? Math.max(...segKeys) : 0;

      for (let idx = 1; idx <= maxIdx; idx++) {
        const segment = seg.segments instanceof Map ? seg.segments.get(idx) : seg.segments[idx];
        if (!segment) {
          segmentMetadata.push(null);
          continue;
        }

        // Get color for recommended display
        let color = DEFAULT_COLORS[(idx - 1) % DEFAULT_COLORS.length];
        const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(segmentationId);
        if (viewportIds.length > 0) {
          try {
            const c = csSegmentation.config.color.getSegmentIndexColor(
              viewportIds[0],
              segmentationId,
              idx,
            );
            if (c && c.length >= 3) {
              color = [c[0], c[1], c[2], c[3] ?? 255];
            }
          } catch {
            // Use default
          }
        }

        // Convert RGB (0-255) to normalized RGB (0-1), then to DICOM CIE Lab
        const normalizedRgb = [color[0] / 255, color[1] / 255, color[2] / 255];
        const cieLabValues =
          (dcmjsData as any).Colors?.rgb2DICOMLAB?.(normalizedRgb) ?? [0, 0, 0];

        segmentMetadata.push({
          SegmentLabel: segment.label || `Segment ${idx}`,
          SegmentDescription: segment.label || `Segment ${idx}`,
          SegmentNumber: idx,
          SegmentAlgorithmType: 'SEMIAUTOMATIC',
          SegmentAlgorithmName: 'XNAT Workstation',
          SegmentedPropertyCategoryCodeSequence: SEGMENTED_PROPERTY_CATEGORY_CODE,
          SegmentedPropertyTypeCodeSequence: SEGMENTED_PROPERTY_TYPE_CODE,
          RecommendedDisplayCIELabValue: cieLabValues,
        });
      }
    }

    // Step 4: Build labelmap3D structure for the adapter
    const labelmap3D = {
      labelmaps2D,
      metadata: segmentMetadata,
    };

    // Step 5: Call generateSegmentation with a metadata wrapper.
    //
    // generateSegmentation internally calls:
    //   metadata.get("StudyData", imageId)   → study-level DICOM attributes
    //   metadata.get("SeriesData", imageId)  → series-level DICOM attributes
    //   metadata.get("ImageData", imageId)   → image-level attributes (MUST include Rows, Columns)
    //
    // These module types are normally handled by the adapters' referencedMetadataProvider
    // (registered as a side-effect). If the side-effect was tree-shaken, these
    // return undefined, and dcmjs derivation sets Rows/Columns to "" (via || ""),
    // causing a 0-byte PixelData allocation and empty SEG files.
    //
    // We create an explicit metadata provider that:
    // 1. Uses metaData.getNormalized() for the complex metadata chains
    // 2. ALWAYS forces Rows/Columns to the known source image dimensions
    //    (from sourceImages[0].rows/columns, already computed as `rows`/`columns` above)
    //    This is the single most critical guarantee — without valid Rows/Columns,
    //    the entire SEG generation produces a broken empty file.
    const STUDY_MODULES = ['patientModule', 'patientStudyModule', 'generalStudyModule'];
    const SERIES_MODULES = ['generalSeriesModule'];
    const IMAGE_MODULES = ['generalImageModule', 'imagePlaneModule', 'cineModule', 'voiLutModule', 'modalityLutModule', 'sopCommonModule'];

    const getArrayFromVectorLike = (value: any): number[] | null => {
      if (Array.isArray(value) && value.length >= 3) {
        return [Number(value[0]), Number(value[1]), Number(value[2])];
      }
      if (
        value
        && typeof value === 'object'
        && Number.isFinite(value.x)
        && Number.isFinite(value.y)
        && Number.isFinite(value.z)
      ) {
        return [Number(value.x), Number(value.y), Number(value.z)];
      }
      return null;
    };

    const exportMetadataProvider = {
      get: (type: string, ...args: any[]) => {
        const imageId = args[0] as string;
        if (type === 'StudyData') {
          return metaData.getNormalized(imageId, STUDY_MODULES);
        }
        if (type === 'SeriesData') {
          return metaData.getNormalized(imageId, SERIES_MODULES);
        }
        if (type === 'ImageData') {
          const normalized: Record<string, any> = metaData.getNormalized(imageId, IMAGE_MODULES);
          const imagePlane = metaData.get('imagePlaneModule', imageId) as any;
          const sourceIndex = Math.max(0, srcImageIds.indexOf(imageId));

          // Ensure ImageOrientationPatient exists (dcmjs SEG normalizer requires it).
          if (!Array.isArray(normalized.ImageOrientationPatient) || normalized.ImageOrientationPatient.length < 6) {
            const fromNormalized = Array.isArray(normalized.imageOrientationPatient) && normalized.imageOrientationPatient.length >= 6
              ? normalized.imageOrientationPatient
              : null;
            const fromPlane = Array.isArray(imagePlane?.imageOrientationPatient) && imagePlane.imageOrientationPatient.length >= 6
              ? imagePlane.imageOrientationPatient
              : null;
            const row = getArrayFromVectorLike(imagePlane?.rowCosines);
            const col = getArrayFromVectorLike(imagePlane?.columnCosines);
            if (fromNormalized) {
              normalized.ImageOrientationPatient = [...fromNormalized];
            } else if (fromPlane) {
              normalized.ImageOrientationPatient = [...fromPlane];
            } else if (row && col) {
              normalized.ImageOrientationPatient = [...row, ...col];
            } else {
              // Last-resort orthogonal identity orientation for single-slice / malformed metadata.
              normalized.ImageOrientationPatient = [1, 0, 0, 0, 1, 0];
            }
          }

          // Ensure ImagePositionPatient exists (dcmjs SEG normalizer requires it).
          if (!Array.isArray(normalized.ImagePositionPatient) || normalized.ImagePositionPatient.length < 3) {
            const fromNormalized = Array.isArray(normalized.imagePositionPatient) && normalized.imagePositionPatient.length >= 3
              ? normalized.imagePositionPatient
              : null;
            const fromPlane = Array.isArray(imagePlane?.imagePositionPatient) && imagePlane.imagePositionPatient.length >= 3
              ? imagePlane.imagePositionPatient
              : null;
            if (fromNormalized) {
              normalized.ImagePositionPatient = [...fromNormalized];
            } else if (fromPlane) {
              normalized.ImagePositionPatient = [...fromPlane];
            } else {
              // Keep deterministic ordering along Z when true geometry is unavailable.
              normalized.ImagePositionPatient = [0, 0, sourceIndex];
            }
          }

          // Prefer explicit PixelSpacing when imagePlane provides it.
          if (!Array.isArray(normalized.PixelSpacing) || normalized.PixelSpacing.length < 2) {
            const rowSpacing = Number(imagePlane?.rowPixelSpacing);
            const colSpacing = Number(imagePlane?.columnPixelSpacing);
            if (Number.isFinite(rowSpacing) && Number.isFinite(colSpacing) && rowSpacing > 0 && colSpacing > 0) {
              normalized.PixelSpacing = [rowSpacing, colSpacing];
            }
          }

          if (!normalized.FrameOfReferenceUID && imagePlane?.frameOfReferenceUID) {
            normalized.FrameOfReferenceUID = imagePlane.frameOfReferenceUID;
          }

          // ALWAYS force Rows/Columns from known source image dimensions.
          // This is the critical fix: we do NOT trust the metadata chain to
          // provide these. We use the source image dimensions directly.
          normalized.Rows = rows;
          normalized.Columns = columns;
          return normalized;
        }
        // For all other module types, delegate to Cornerstone's provider chain
        return metaData.get(type, imageId);
      },
    };

    // ─── Sort sourceImages + labelmaps2D by IPP distance (descending) ───
    //
    // CRITICAL: dcmjs SEGImageNormalizer.normalize() internally sorts the
    // datasets by distance along the scan axis (descending — see
    // ImageNormalizer.normalize() in dcmjs). It then builds the
    // PerFrameFunctionalGroupsSequence in that sorted order. However,
    // fillSegmentation() pairs labelmaps2D[i] with frame i by index.
    //
    // If sourceImages / labelmaps2D are in filename order (which may be
    // REVERSED relative to IPP spatial order), the pixel data gets written
    // to the wrong PerFrameFunctionalGroupsSequence frame — causing the
    // "paint on slice 2, shows on slice 19" mirroring bug after reload.
    //
    // Fix: sort both arrays by IPP distance (descending) BEFORE passing to
    // generateSegmentation, matching the normalizer's internal sort. This
    // ensures labelmaps2D[i] corresponds to the correct sorted frame.
    {
      const refPlane = metaData.get('imagePlaneModule', srcImageIds[0]);
      const refIOP = refPlane?.imageOrientationPatient;
      const refIPP = refPlane?.imagePositionPatient;

      if (refIOP && refIPP) {
        // Compute scan axis (same cross product as dcmjs normalizer)
        const rowVec = [refIOP[0], refIOP[1], refIOP[2]];
        const colVec = [refIOP[3], refIOP[4], refIOP[5]];
        const scanAxis = [
          rowVec[1] * colVec[2] - rowVec[2] * colVec[1],
          rowVec[2] * colVec[0] - rowVec[0] * colVec[2],
          rowVec[0] * colVec[1] - rowVec[1] * colVec[0],
        ];

        // Build (distance, index) pairs
        const distIndexPairs: { dist: number; idx: number }[] = [];
        for (let i = 0; i < srcImageIds.length; i++) {
          const plane = metaData.get('imagePlaneModule', srcImageIds[i]);
          const ipp = plane?.imagePositionPatient;
          if (ipp) {
            const posVec = [ipp[0] - refIPP[0], ipp[1] - refIPP[1], ipp[2] - refIPP[2]];
            const dist = posVec[0] * scanAxis[0] + posVec[1] * scanAxis[1] + posVec[2] * scanAxis[2];
            distIndexPairs.push({ dist, idx: i });
          } else {
            distIndexPairs.push({ dist: i, idx: i }); // fallback
          }
        }

        // Sort descending by distance (same as dcmjs normalizer: b[0] - a[0])
        distIndexPairs.sort((a, b) => b.dist - a.dist);

        // Check if sort order differs from input order
        const needsReorder = distIndexPairs.some((p, i) => p.idx !== i);
        if (needsReorder) {
          const sortedSrcImageIds = distIndexPairs.map(p => srcImageIds[p.idx]);
          const sortedSourceImages = distIndexPairs.map(p => sourceImages[p.idx]);
          const sortedLabelmaps2D = distIndexPairs.map(p => labelmaps2D[p.idx]);

          // Replace with sorted arrays
          srcImageIds = sortedSrcImageIds;
          sourceImages.length = 0;
          sourceImages.push(...sortedSourceImages);
          labelmaps2D.length = 0;
          labelmaps2D.push(...sortedLabelmaps2D);
          console.log(`[segmentationService] Reordered ${distIndexPairs.length} slices by IPP distance to match dcmjs normalizer sort`);
        }
      } else {
        console.warn(`[segmentationService] Could not get IOP/IPP for sorting — proceeding with original order.`);
      }
    }

    // Pre-export validation: count segment-frame pairs (same logic as fillSegmentation)
    const totalSegFrames = labelmaps2D.reduce((sum, lm) =>
      sum + sanitizeSegmentIndices(lm.segmentsOnLabelmap ?? []).length, 0);
    console.log(`[segmentationService] Pre-export check: ${totalSegFrames} segment-frame pairs across ${labelmaps2D.length} slices`);

    if (totalSegFrames === 0) {
      const nonZeroPixels = labelmaps2D.reduce((sum, lm) => {
        const pd: Uint8Array | undefined = lm?.pixelData;
        if (!pd || typeof pd.length !== 'number') return sum;
        let local = 0;
        for (let i = 0; i < pd.length; i++) {
          if (pd[i] > 0) local++;
        }
        return sum + local;
      }, 0);
      throw new Error(
        `No painted segment data found in any slice. Nothing to export. `
        + `(nonZeroPixels=${nonZeroPixels})`,
      );
    }

    console.log(`[segmentationService] Generating DICOM SEG: ${sourceImages.length} images, ${segmentMetadata.length - 1} segments, ${rows}×${columns}`);

    let segDerivation: any;
    try {
      segDerivation = adaptersSEG.Cornerstone3D.Segmentation.generateSegmentation(
        sourceImages,
        labelmap3D,
        exportMetadataProvider,
      );
    } catch (genErr) {
      console.error('[segmentationService] generateSegmentation failed:', genErr);
      throw new Error(`DICOM SEG generation failed: ${genErr instanceof Error ? genErr.message : String(genErr)}`);
    }

    if (!segDerivation?.dataset) {
      throw new Error('[segmentationService] generateSegmentation returned no dataset');
    }

    // Persist the user-given segmentation label as SeriesDescription
    // so it survives round-trip (export → XNAT → re-import → loadDicomSeg label extraction)
    segDerivation.dataset.SeriesDescription = seg.label || 'Segmentation';

    // ─── Post-generation validation ───
    //
    // Even though we force Rows/Columns in the metadata provider, the
    // derivation chain (dcmjs SegmentationDerivation → DerivedPixels →
    // DerivedDataset) can still end up with "" for Rows/Columns via
    // assignFromReference's `|| ""` fallback if the multiframe's
    // Rows/Columns got lost during normalization.
    //
    // If that happened, setNumberOfFrames() allocated a 0-byte PixelData
    // (because "" * "" * N = NaN → ArrayBuffer(NaN) = 0 bytes), and
    // all segment pixel data writes were no-ops.
    //
    // We detect this condition and fully rebuild the DICOM SEG dataset.
    const ds = segDerivation.dataset;
    const sourceRefs = collectSourceDicomReferences(srcImageIds, metaData.get.bind(metaData));
    const primarySourceRef = requireSingleStudyReference(sourceRefs, 'DICOM SEG export');
    applySourceDicomContextToSegDataset(ds, primarySourceRef.imageId, metaData.get.bind(metaData));
    if (!ds.StudyInstanceUID && primarySourceRef.studyInstanceUID) ds.StudyInstanceUID = primarySourceRef.studyInstanceUID;
    if (!ds.PatientName && primarySourceRef.patientName) ds.PatientName = primarySourceRef.patientName;
    if (!ds.PatientID && primarySourceRef.patientId) ds.PatientID = primarySourceRef.patientId;
    if (!ds.PatientBirthDate && primarySourceRef.patientBirthDate) ds.PatientBirthDate = primarySourceRef.patientBirthDate;
    if (!ds.PatientSex && primarySourceRef.patientSex) ds.PatientSex = primarySourceRef.patientSex;
    if (!ds.StudyDate && primarySourceRef.studyDate) ds.StudyDate = primarySourceRef.studyDate;
    if (!ds.StudyTime && primarySourceRef.studyTime) ds.StudyTime = primarySourceRef.studyTime;
    if (!ds.StudyID && primarySourceRef.studyID) ds.StudyID = primarySourceRef.studyID;
    if (!ds.AccessionNumber && primarySourceRef.accessionNumber) ds.AccessionNumber = primarySourceRef.accessionNumber;
    if (!ds.StudyDescription && primarySourceRef.studyDescription) ds.StudyDescription = primarySourceRef.studyDescription;
    if (!ds.ReferringPhysicianName && primarySourceRef.referringPhysicianName) {
      ds.ReferringPhysicianName = primarySourceRef.referringPhysicianName;
    }
    if (!ds.FrameOfReferenceUID && primarySourceRef.frameOfReferenceUID) {
      ds.FrameOfReferenceUID = primarySourceRef.frameOfReferenceUID;
    }
    const primaryImagePlane = metaData.get('imagePlaneModule', primarySourceRef.imageId) as any;
    ds.SharedFunctionalGroupsSequence ||= {};
    ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence ||= {};
    if (
      !Array.isArray(ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.PixelSpacing)
      && Number.isFinite(primaryImagePlane?.rowPixelSpacing)
      && Number.isFinite(primaryImagePlane?.columnPixelSpacing)
    ) {
      ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.PixelSpacing = [
        primaryImagePlane.rowPixelSpacing,
        primaryImagePlane.columnPixelSpacing,
      ];
    }
    if (
      !ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness
      && Number.isFinite(primaryImagePlane?.sliceThickness)
      && primaryImagePlane.sliceThickness > 0
    ) {
      ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness = primaryImagePlane.sliceThickness;
    }
    if (
      !ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness
      && Number.isFinite(primaryImagePlane?.spacingBetweenSlices)
      && primaryImagePlane.spacingBetweenSlices > 0
    ) {
      ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness = primaryImagePlane.spacingBetweenSlices;
    }
    if (!ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness) {
      ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness = 1;
    }
    if (
      !ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SpacingBetweenSlices
      && Number.isFinite(primaryImagePlane?.spacingBetweenSlices)
      && primaryImagePlane.spacingBetweenSlices > 0
    ) {
      ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SpacingBetweenSlices = primaryImagePlane.spacingBetweenSlices;
    }
    ds.SharedFunctionalGroupsSequence.PlaneOrientationSequence ||= {};
    if (
      !Array.isArray(ds.SharedFunctionalGroupsSequence.PlaneOrientationSequence.ImageOrientationPatient)
      && Array.isArray(primaryImagePlane?.imageOrientationPatient)
      && primaryImagePlane.imageOrientationPatient.length >= 6
    ) {
      ds.SharedFunctionalGroupsSequence.PlaneOrientationSequence.ImageOrientationPatient = [
        ...primaryImagePlane.imageOrientationPatient,
      ];
    }
    const operatorsName = upsertOperatorsName(
      ds.OperatorsName,
      formatOperatorsNameForConnection(useConnectionStore.getState().connection),
    );
    if (operatorsName) {
      ds.OperatorsName = operatorsName;
    }

    const dsRowsValid = typeof ds.Rows === 'number' && ds.Rows > 0;
    const dsColsValid = typeof ds.Columns === 'number' && ds.Columns > 0;

    if (!dsRowsValid || !dsColsValid) {
      console.warn(
        `[segmentationService] Dataset has invalid Rows=${ds.Rows}, Columns=${ds.Columns} ` +
        `(expected ${rows}×${columns}). Fixing and rebuilding PixelData.`,
      );
      ds.Rows = rows;
      ds.Columns = columns;
    }

    // Ensure NumberOfFrames is a valid number
    if (ds.NumberOfFrames && typeof ds.NumberOfFrames !== 'number') {
      ds.NumberOfFrames = parseInt(String(ds.NumberOfFrames), 10) || 1;
    }

    // Check if PixelData was correctly populated.
    // In DICOM SEG, NumberOfFrames is the count of (segment, slice) pairs,
    // NOT the total number of source slices. PixelData should be bit-packed:
    //   size = ceil(Rows * Columns * NumberOfFrames / 8)
    const numFrames = typeof ds.NumberOfFrames === 'number' ? ds.NumberOfFrames : 1;
    const expectedPixelBytes = Math.ceil((ds.Rows * ds.Columns * numFrames) / 8);
    const currentPixelSize = ds.PixelData instanceof ArrayBuffer ? ds.PixelData.byteLength : 0;

    if (currentPixelSize < expectedPixelBytes) {
      console.warn(
        `[segmentationService] PixelData too small (${currentPixelSize} bytes, ` +
        `expected ≥${expectedPixelBytes} for ${numFrames} frames of ${ds.Rows}×${ds.Columns}). ` +
        `Rebuilding from labelmaps.`,
      );

      // Determine which (segment, slice) pairs are referenced.
      // PerFrameFunctionalGroupsSequence tells us which frames exist.
      const pfgs = ds.PerFrameFunctionalGroupsSequence;
      const nFrames = Array.isArray(pfgs) ? pfgs.length : numFrames;

      // Count referenced frame indices per segment
      // The adapter created PerFrameFunctionalGroupsSequence entries in order:
      //   for each segment → for each referenced slice.
      // We need to re-derive the mapping from labelmaps2D.
      const referencedFrames: { segIdx: number; sliceIdx: number }[] = [];
      for (let segIdx = 1; segIdx < segmentMetadata.length; segIdx++) {
        if (!segmentMetadata[segIdx]) continue;
        for (let sliceIdx = 0; sliceIdx < labelmaps2D.length; sliceIdx++) {
          const lm = labelmaps2D[sliceIdx];
          if (lm && lm.segmentsOnLabelmap.includes(segIdx)) {
            referencedFrames.push({ segIdx, sliceIdx });
          }
        }
      }

      const actualFrameCount = referencedFrames.length || nFrames;
      const slicePixels = ds.Rows * ds.Columns;
      const totalPixels = slicePixels * actualFrameCount;

      // Build unpacked pixel data (1 byte per pixel, binary: 0 or 1)
      const unpackedPixels = new Uint8Array(totalPixels);
      for (let f = 0; f < referencedFrames.length; f++) {
        const { segIdx, sliceIdx } = referencedFrames[f];
        const lm = labelmaps2D[sliceIdx];
        if (!lm?.pixelData) continue;
        const frameOffset = f * slicePixels;
        for (let p = 0; p < lm.pixelData.length && p < slicePixels; p++) {
          unpackedPixels[frameOffset + p] = lm.pixelData[p] === segIdx ? 1 : 0;
        }
      }

      // Bit-pack (1 bit per pixel, LSB first)
      const packedLen = Math.ceil(totalPixels / 8);
      const packedPixels = new Uint8Array(packedLen);
      for (let i = 0; i < totalPixels; i++) {
        if (unpackedPixels[i]) {
          packedPixels[i >> 3] |= (1 << (i % 8));
        }
      }
      ds.PixelData = packedPixels.buffer;
      ds.NumberOfFrames = actualFrameCount;

      console.log(
        `[segmentationService] Rebuilt PixelData: ${actualFrameCount} frames, ` +
        `${packedLen} bytes (${totalPixels} pixels bit-packed)`,
      );
    }

    console.log(`[segmentationService] DICOM SEG: Rows=${ds.Rows}, Columns=${ds.Columns}, Frames=${ds.NumberOfFrames}, PixelData=${ds.PixelData?.byteLength ?? 0} bytes`);

    // Step 6: Finalize and serialize the derived SEG with shared DICOM validation.
    const dataset = segDerivation.dataset;
    dataset.Modality = 'SEG';
    dataset.Rows = rows;
    dataset.Columns = columns;
    if (typeof dataset.BitsAllocated !== 'number' || dataset.BitsAllocated <= 0) {
      dataset.BitsAllocated = 1;
    }
    if (typeof dataset.BitsStored !== 'number' || dataset.BitsStored <= 0) {
      dataset.BitsStored = 1;
    }
    if (typeof dataset.HighBit !== 'number') {
      dataset.HighBit = 0;
    }
    if (typeof dataset.SamplesPerPixel !== 'number' || dataset.SamplesPerPixel <= 0) {
      dataset.SamplesPerPixel = 1;
    }
    if (typeof dataset.PixelRepresentation !== 'number') {
      dataset.PixelRepresentation = 0;
    }

    const { arrayBuffer } = serializeDerivedDicomDataset(dataset, {
      kind: 'SEG',
      callerTag: 'segmentationService',
      defaultSOPClassUID: '1.2.840.10008.5.1.4.1.1.66.4',
      requiredDatasetFields: [
        'SOPClassUID',
        'SOPInstanceUID',
        'StudyInstanceUID',
        'SeriesInstanceUID',
        'Modality',
        'Rows',
        'Columns',
        'NumberOfFrames',
        'PixelData',
        'SegmentSequence',
        'PerFrameFunctionalGroupsSequence',
        'SharedFunctionalGroupsSequence',
      ],
      expectedDatasetValues: {
        Modality: 'SEG',
        StudyInstanceUID: primarySourceRef.studyInstanceUID,
        Rows: rows,
        Columns: columns,
      },
      includeContentDateTime: true,
    });

    // ─── Binary validation ───
    // Parse the just-written ArrayBuffer with dicom-parser to verify that
    // Rows and Columns are correct in the actual binary output. If they're
    // wrong, we REFUSE to save a broken file.
    try {
      const dicomParser = await import('dicom-parser');
      const verifyBytes = new Uint8Array(arrayBuffer);
      const verifyDs = dicomParser.parseDicom(verifyBytes);
      const finalRows = verifyDs.uint16('x00280010');
      const finalCols = verifyDs.uint16('x00280011');
      const finalPixelData = verifyDs.elements['x7fe00010'];
      const finalPixelLen = finalPixelData ? finalPixelData.length : 0;

      console.log(
        `[segmentationService] Binary validation: Rows=${finalRows}, Columns=${finalCols}, ` +
        `PixelData=${finalPixelLen} bytes`,
      );

      if (finalRows === 0 || finalCols === 0) {
        throw new Error(
          `DICOM SEG binary validation failed: Rows=${finalRows}, Columns=${finalCols}. ` +
          `The file would be unreadable. This is a bug — please report it.`,
        );
      }

      if (finalRows !== rows || finalCols !== columns) {
        throw new Error(
          `DICOM SEG binary validation failed: expected ${rows}×${columns}, ` +
          `got ${finalRows}×${finalCols}. The file would load incorrectly.`,
        );
      }

      if (finalPixelLen === 0) {
        throw new Error(
          `DICOM SEG binary validation failed: PixelData is empty (0 bytes). ` +
          `The segmentation data would be lost.`,
        );
      }
    } catch (validationErr) {
      if (validationErr instanceof Error && validationErr.message.startsWith('DICOM SEG binary validation')) {
        throw validationErr; // Re-throw our validation errors
      }
      console.warn('[segmentationService] Could not validate binary output:', validationErr);
      // Non-critical: proceed even if dicom-parser validation fails
    }

    // Step 7: Convert to base64 for IPC transport.
    const bytes = new Uint8Array(arrayBuffer);
    console.log(`[segmentationService] Serialized DICOM SEG: ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB, converting to base64...`);

    const binaryChunks: string[] = [];
    const chunkSize = 4096;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, bytes.length);
      let chunk = '';
      for (let j = i; j < end; j++) {
        chunk += String.fromCharCode(bytes[j]);
      }
      binaryChunks.push(chunk);
    }
    const binary = binaryChunks.join('');
    const base64 = btoa(binary);

    console.log(`[segmentationService] DICOM SEG exported: ${(base64.length / 1024).toFixed(1)} KB base64`);
    return base64;
  },

  /**
   * Export a multi-layer group to DICOM SEG by compositing all sub-seg
   * binary layers into multi-valued labelmaps (pixel value = segment index).
   * Higher-indexed segments win at overlap pixels.
   */
  async _exportGroupToDicomSeg(groupId: string): Promise<string> {
    const dims = mlg.getGroupDimensions(groupId);
    const srcImageIds = dims?.sourceImageIds ?? sourceImageTracking.getSourceImageIds(groupId) ?? [];
    if (srcImageIds.length === 0) {
      throw new Error('[segmentationService] No source imageIds for group export.');
    }

    const subSegArr = mlg.getGroupSlots(groupId) ?? [];
    const metaMap = mlg.getSegmentMetaMap(groupId);
    const { rows, columns } = dims ?? { rows: 512, columns: 512 };
    const sliceCount = srcImageIds.length;
    const pixelsPerSlice = rows * columns;

    // Build composited labelmaps: for each slice, iterate sub-segs in order.
    // Higher-indexed segment overwrites lower at overlap pixels.
    const compositedSlices: Uint8Array[] = [];
    for (let s = 0; s < sliceCount; s++) {
      const composited = new Uint8Array(pixelsPerSlice);
      for (let i = 0; i < subSegArr.length; i++) {
        const subSegId = subSegArr[i];
        if (!subSegId) continue;
        const segmentIndex = i + 1;
        const subSeg = csSegmentation.state.getSegmentation(subSegId);
        const lmImageIds: string[] = (subSeg?.representationData as any)?.Labelmap?.imageIds ?? [];
        if (s >= lmImageIds.length) continue;
        const lmImage = cache.getImage(lmImageIds[s]);
        if (!lmImage) continue;
        const scalarData =
          lmImage.voxelManager?.getScalarData?.()
          ?? (lmImage as any).getPixelData?.();
        if (!scalarData) continue;
        for (let p = 0; p < pixelsPerSlice && p < scalarData.length; p++) {
          if (Number(scalarData[p]) > 0) {
            composited[p] = segmentIndex;
          }
        }
      }
      compositedSlices.push(composited);
    }

    // Build segment metadata
    const segmentMetadata: any[] = [null]; // index 0 = background
    const maxIdx = subSegArr.length;
    for (let idx = 1; idx <= maxIdx; idx++) {
      if (!subSegArr[idx - 1]) {
        segmentMetadata.push(null);
        continue;
      }
      const meta = metaMap?.get(idx);
      const color = meta?.color ?? DEFAULT_COLORS[(idx - 1) % DEFAULT_COLORS.length];
      const normalizedRgb = [color[0] / 255, color[1] / 255, color[2] / 255];
      const cieLabValues =
        (dcmjsData as any).Colors?.rgb2DICOMLAB?.(normalizedRgb) ?? [0, 0, 0];

      segmentMetadata.push({
        SegmentLabel: meta?.label ?? `Segment ${idx}`,
        SegmentDescription: meta?.label ?? `Segment ${idx}`,
        SegmentNumber: idx,
        SegmentAlgorithmType: 'SEMIAUTOMATIC',
        SegmentAlgorithmName: 'XNAT Workstation',
        SegmentedPropertyCategoryCodeSequence: SEGMENTED_PROPERTY_CATEGORY_CODE,
        SegmentedPropertyTypeCodeSequence: SEGMENTED_PROPERTY_TYPE_CODE,
        RecommendedDisplayCIELabValue: cieLabValues,
      });
    }

    // Create a temporary single-layer Cornerstone segmentation with the
    // composited labelmaps, register it, export, then clean up.
    const tempSegId = `_export_temp_${groupId}_${Date.now()}`;
    const tempLmImageIds: string[] = [];
    try {
      // Create labelmap images for the temporary segmentation
      for (let s = 0; s < sliceCount; s++) {
        const srcId = srcImageIds[s];
        const localId = `${tempSegId}_slice_${s}`;
        const pixelData = compositedSlices[s];

        const imagePlane = metaData.get('imagePlaneModule', srcId) as any;
        imageLoader.createAndCacheLocalImage(localId, {
          scalarData: pixelData,
          dimensions: [columns, rows],
          spacing: [
            Number(imagePlane?.columnPixelSpacing) || 1,
            Number(imagePlane?.rowPixelSpacing) || 1,
          ],
          origin: imagePlane?.imagePositionPatient,
          direction: imagePlane?.imageOrientationPatient,
          frameOfReferenceUID: imagePlane?.frameOfReferenceUID,
          referencedImageId: srcId,
        } as any);
        tempLmImageIds.push(localId);
      }

      // Build segments object for Cornerstone
      const segments: Record<number, any> = {};
      for (let idx = 1; idx <= maxIdx; idx++) {
        if (!subSegArr[idx - 1]) continue;
        const meta = metaMap?.get(idx);
        segments[idx] = {
          label: meta?.label ?? `Segment ${idx}`,
          locked: false,
          active: idx === 1,
          segmentIndex: idx,
          cachedStats: {},
        };
      }

      // Register temporary segmentation
      csSegmentation.addSegmentations([{
        segmentationId: tempSegId,
        representation: {
          type: ToolEnums.SegmentationRepresentations.Labelmap,
          data: { imageIds: tempLmImageIds } as any,
        },
        config: {
          label: mlg.getGroupLabel(groupId) ?? 'Segmentation',
          segments,
        },
      }]);

      // Track source image IDs for the temp seg
      sourceImageTracking.setSourceImageIds(tempSegId, [...srcImageIds]);

      // Delegate to the legacy export path
      const result = await this.exportToDicomSeg(tempSegId);

      return result;
    } finally {
      // Clean up temporary segmentation
      try { csSegmentation.removeSegmentation(tempSegId); } catch { /* ok */ }
      sourceImageTracking.clearSourceImageIds(tempSegId);
      // Clean up temporary labelmap images from cache
      for (const lmId of tempLmImageIds) {
        try { cache.removeImageLoadObject(lmId); } catch { /* ok */ }
      }
    }
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

    // Clean up module-level state. sourceImageTracking.dispose() both
    // unsubscribes its auto-cleanup listener and clears its map.
    sourceImageTracking.dispose();
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
