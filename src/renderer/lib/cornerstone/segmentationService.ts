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
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { rtStructService } from './rtStructService';
import { writeDicomDict } from './writeDicomDict';
// NOTE: We use the tool group ID directly here instead of importing from
// toolService to avoid a circular dependency (toolService → segmentationService).
const TOOL_GROUP_ID = 'xnatToolGroup_primary';

// ─── Constants ──────────────────────────────────────────────────

/** Default color palette for segments (10 colors, RGBA 0-255, cycles) */
const DEFAULT_COLORS: [number, number, number, number][] = [
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

let segmentationCounter = 0;

/**
 * Cornerstone3D's built-in undo/redo ring buffer.
 * All segmentation/contour tools automatically push memos here via BaseTool.doneEditMemo().
 */
const { DefaultHistoryMemo } = (csUtilities as any).HistoryMemo;

/**
 * Tracks the original source imageIds for each segmentation, keyed by segmentationId.
 * Needed for DICOM SEG export — the adapter requires source images to extract
 * DICOM metadata (StudyInstanceUID, SeriesInstanceUID, etc.).
 */
const sourceImageIdsMap = new Map<string, string[]>();

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

/** Per-segment metadata stored at the group level. */
interface SegmentMeta {
  label: string;
  color: [number, number, number, number];
  locked: boolean;
}

/** Image dimensions + source IDs for creating new sub-seg labelmap images. */
interface GroupDimensions {
  rows: number;
  columns: number;
  rowPixelSpacing: number;
  columnPixelSpacing: number;
  sourceImageIds: string[];
}

/**
 * Maps group ID (logical segmentation shown in UI) → ordered sub-seg IDs.
 * Array index + 1 = logical segment index. Null entries = removed segments.
 */
const subSegGroupMap = new Map<string, (string | null)[]>();

/**
 * Reverse lookup: Cornerstone sub-segmentation ID → { groupId, segmentIndex }.
 */
const subSegToGroupMap = new Map<string, { groupId: string; segmentIndex: number }>();

/**
 * Per-segment metadata (label, color, locked) keyed by group ID + segment index.
 */
const segmentMetaMap = new Map<string, Map<number, SegmentMeta>>();

/**
 * Image dimensions for creating new sub-seg labelmap images on demand.
 */
const groupDimensionsMap = new Map<string, GroupDimensions>();

/** Group label storage (separate from segments). */
const groupLabelMap = new Map<string, string>();

/**
 * Viewport attachment tracking for multi-layer groups.
 * Records which viewports a group was added to via addToViewport(),
 * even before any sub-segs exist. Without this, the first addSegment()
 * cannot discover the target viewports because findViewportsWithGroup()
 * iterates sub-segs — which are empty until the first segment is created.
 */
const groupViewportAttachments = new Map<string, Set<string>>();

/**
 * Background metadata pre-load promises per group.
 * Started in createStackSegmentation() and awaited lazily in addSegment()
 * so the UI doesn't block on first creation.
 */
const metadataPreloadPromises = new Map<string, Promise<void>>();

/** Returns true if a segmentationId is a multi-layer group. */
function isMultiLayerGroup(segmentationId: string): boolean {
  return subSegGroupMap.has(segmentationId);
}

/** Returns non-null sub-seg IDs for a group. */
function getActiveSubSegIds(segmentationId: string): string[] {
  const arr = subSegGroupMap.get(segmentationId);
  if (!arr) return [];
  return arr.filter((id): id is string => id !== null);
}

/** Resolve a group ID + logical segment index to the sub-seg ID. */
function resolveSubSegId(groupId: string, segmentIndex: number): string | null {
  const arr = subSegGroupMap.get(groupId);
  if (!arr) return null;
  return arr[segmentIndex - 1] ?? null;
}

/** Find viewport IDs that have any sub-seg of a group attached. */
function findViewportsWithGroup(groupId: string): string[] {
  const subSegIds = getActiveSubSegIds(groupId);
  const vpSet = new Set<string>();
  for (const subSegId of subSegIds) {
    for (const vpId of csSegmentation.state.getViewportIdsWithSegmentation(subSegId)) {
      vpSet.add(vpId);
    }
  }
  // Fall back to recorded viewport attachments — the group may have been added
  // to viewports before any sub-segs existed (e.g. panel-created segmentations
  // where the first segment is added separately).
  if (vpSet.size === 0) {
    const recorded = groupViewportAttachments.get(groupId);
    if (recorded) {
      for (const vpId of recorded) vpSet.add(vpId);
    }
  }
  return Array.from(vpSet);
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
        const srcIds = sourceImageIdsMap.get(subSegId) ?? [];
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

function findFirstNonZeroRef(adapterImages: any[]): {
  referencedImageId: string | null;
  labelmapImageId: string | null;
} {
  for (const img of adapterImages) {
    if (!img) continue;
    let pixels: any = null;
    try {
      if (img.voxelManager) pixels = img.voxelManager.getScalarData();
      else if (typeof img.getPixelData === 'function') pixels = img.getPixelData();
    } catch {
      pixels = null;
    }
    if (!pixels) continue;
    for (let k = 0; k < pixels.length; k++) {
      if (pixels[k] !== 0) {
        return {
          referencedImageId: img.referencedImageId ?? null,
          labelmapImageId: img.imageId ?? null,
        };
      }
    }
  }
  return { referencedImageId: null, labelmapImageId: null };
}

function getValidSegmentIndices(seg: any): number[] {
  if (!seg?.segments) return [];
  const indices = new Set<number>();

  const pushIfValid = (value: unknown): void => {
    const idx = Number(value);
    if (Number.isFinite(idx) && Number.isInteger(idx) && idx > 0) {
      indices.add(idx);
    }
  };

  const addFromEntry = (key: unknown, segment: any): void => {
    pushIfValid(key);
    pushIfValid(segment?.segmentIndex);
  };

  if (seg.segments instanceof Map) {
    for (const [key, segment] of seg.segments.entries()) {
      addFromEntry(key, segment);
    }
  } else {
    for (const [key, segment] of Object.entries(seg.segments)) {
      addFromEntry(key, segment);
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

function segmentsToPlainObject(segments: any): Record<number, any> {
  const out: Record<number, any> = {};
  if (!segments) return out;
  if (segments instanceof Map) {
    for (const [key, segment] of segments.entries()) {
      const idx = Number((segment as any)?.segmentIndex ?? key);
      if (!Number.isFinite(idx) || idx <= 0 || !Number.isInteger(idx)) continue;
      out[idx] = segment;
    }
    return out;
  }
  for (const [key, segment] of Object.entries(segments)) {
    const idx = Number((segment as any)?.segmentIndex ?? key);
    if (!Number.isFinite(idx) || idx <= 0 || !Number.isInteger(idx)) continue;
    out[idx] = segment as any;
  }
  return out;
}

function hasUsableColor(color: unknown): color is [number, number, number, number?] {
  if (!Array.isArray(color) || color.length < 3) return false;
  const r = Number(color[0]);
  const g = Number(color[1]);
  const b = Number(color[2]);
  const a = color.length >= 4 ? Number(color[3]) : 255;
  if (![r, g, b, a].every((v) => Number.isFinite(v))) return false;
  // Cornerstone can synthesize [0,0,0,0] for missing LUT entries.
  if (r === 0 && g === 0 && b === 0 && a === 0) return false;
  return true;
}

function sanitizeSegmentIndices(indices: number[]): number[] {
  const valid = new Set<number>();
  for (const idx of indices) {
    if (Number.isFinite(idx) && Number.isInteger(idx) && idx > 0) {
      valid.add(idx);
    }
  }
  return Array.from(valid).sort((a, b) => a - b);
}

function extractLabelmapImageId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && typeof (value as any).imageId === 'string') {
    return (value as any).imageId;
  }
  return null;
}

function getLabelmapImageIdsForSegmentation(segmentationId: string): string[] {
  const seg = csSegmentation.state.getSegmentation(segmentationId);
  const labelmapData: any = (seg?.representationData as any)?.Labelmap;
  if (!labelmapData) return [];

  if (Array.isArray(labelmapData.imageIds) && labelmapData.imageIds.length > 0) {
    return labelmapData.imageIds.filter((id: unknown) => typeof id === 'string' && id.length > 0);
  }

  const mapLike = labelmapData.imageIdReferenceMap;
  if (!mapLike) return [];

  const sourceOrder = sourceImageIdsMap.get(segmentationId) ?? [];
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

function hasSegmentPixelsOnSlice(
  scalarData: ArrayLike<number>,
  segmentIndex: number,
): boolean {
  for (let i = 0; i < scalarData.length; i++) {
    if (Number(scalarData[i]) === segmentIndex) return true;
  }
  return false;
}

/**
 * 1-D squared-Euclidean distance transform (Felzenszwalb–Huttenlocher).
 * Operates in-place on `f` which contains 0 for mask pixels and +Inf for
 * non-mask pixels. On output `f[i]` = squared Euclidean distance to the
 * nearest mask pixel along this 1-D scanline.
 *
 * Reference: P. Felzenszwalb & D. Huttenlocher, "Distance Transforms of
 *            Sampled Functions", Theory of Computing 8 (2012), 415–428.
 */
function edt1d(f: Float64Array, n: number): void {
  const v = new Int32Array(n);   // locations of parabolas in lower envelope
  const z = new Float64Array(n + 1); // boundaries between parabolas
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    f[q] = dq * dq + f[v[k]];
  }
}

/**
 * Exact 2-D Euclidean Distance Transform using separable 1-D transforms.
 * Returns a Float32Array of Euclidean distances (not squared) from each
 * non-mask pixel to the nearest mask pixel. Mask pixels get distance 0.
 */
function euclideanDistanceToMask(
  mask: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const INF = 1e20;
  const size = width * height;

  // Working buffer holds squared distances.
  const grid = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    grid[i] = mask[i] ? 0 : INF;
  }

  // Transform columns (along Y for each X).
  const col = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) col[y] = grid[y * width + x];
    edt1d(col, height);
    for (let y = 0; y < height; y++) grid[y * width + x] = col[y];
  }

  // Transform rows (along X for each Y).
  const row = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) row[x] = grid[off + x];
    edt1d(row, width);
    for (let x = 0; x < width; x++) grid[off + x] = row[x];
  }

  // Take square root → Euclidean distance.
  const result = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    result[i] = Math.sqrt(grid[i]);
  }
  return result;
}

function buildSignedDistanceForSegment(
  scalarData: ArrayLike<number>,
  width: number,
  height: number,
  segmentIndex: number,
): Float32Array {
  const size = width * height;
  const inside = new Uint8Array(size);
  const outside = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const isInside = Number(scalarData[i]) === segmentIndex;
    inside[i] = isInside ? 1 : 0;
    outside[i] = isInside ? 0 : 1;
  }

  const distToInside = euclideanDistanceToMask(inside, width, height);
  const distToOutside = euclideanDistanceToMask(outside, width, height);
  const signed = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    signed[i] = inside[i] ? -distToOutside[i] : distToInside[i];
  }

  return signed;
}

// ─── Interpolation Algorithm Implementations ─────────────────────

/**
 * Build an "inside distance" field for the Raya-Udupa morphological algorithm.
 * Returns a Float32Array where inside pixels hold their Euclidean distance
 * to the nearest boundary (>0), and outside/boundary pixels hold 0.
 */
function buildInsideDistanceField(
  scalarData: ArrayLike<number>,
  width: number,
  height: number,
  segmentIndex: number,
): Float32Array {
  const size = width * height;
  const outside = new Uint8Array(size); // mask of outside pixels
  for (let i = 0; i < size; i++) {
    outside[i] = Number(scalarData[i]) === segmentIndex ? 0 : 1;
  }
  // EDT of outside mask gives: for each pixel, distance to nearest outside pixel.
  // Inside pixels distant from boundary get high values; outside pixels get 0.
  const distToOutside = euclideanDistanceToMask(outside, width, height);
  return distToOutside;
}

/**
 * Morphological (Raya-Udupa) interpolation between two anchor slices.
 * Uses inside-distance fields: for each gap pixel, linearly blends the
 * inside-distances from both anchors. Pixel is filled where the blended
 * distance > 0, meaning the point is "inside" the interpolated shape.
 *
 * This produces larger (more volume-preserving) regions than SDF interpolation
 * because it only considers positive inside-distances rather than the full
 * signed distance field.
 */
function interpolateMorphological(
  sliceA: ArrayLike<number>,
  sliceB: ArrayLike<number>,
  alpha: number,
  width: number,
  height: number,
  segIdx: number,
): Uint8Array {
  const size = width * height;
  const insideDistA = buildInsideDistanceField(sliceA, width, height, segIdx);
  const insideDistB = buildInsideDistanceField(sliceB, width, height, segIdx);
  const result = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    const blended = (1 - alpha) * insideDistA[p] + alpha * insideDistB[p];
    if (blended > 0) {
      result[p] = segIdx;
    }
  }
  return result;
}

/**
 * Nearest-slice interpolation. Returns the data from whichever anchor
 * slice is nearest in position (alpha < 0.5 → slice A, else slice B).
 */
function interpolateNearestSlice(
  sliceA: ArrayLike<number>,
  sliceB: ArrayLike<number>,
  alpha: number,
  width: number,
  height: number,
  segIdx: number,
): Uint8Array {
  const size = width * height;
  const source = alpha < 0.5 ? sliceA : sliceB;
  const result = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    if (Number(source[p]) === segIdx) {
      result[p] = segIdx;
    }
  }
  return result;
}

/**
 * Linear per-pixel blend interpolation. Blends binary presence values from
 * both anchors and fills where the blend meets or exceeds the threshold.
 * Lower threshold = more aggressive fill; 0.5 = standard midpoint.
 */
function interpolateLinearBlend(
  sliceA: ArrayLike<number>,
  sliceB: ArrayLike<number>,
  alpha: number,
  width: number,
  height: number,
  segIdx: number,
  threshold: number,
): Uint8Array {
  const size = width * height;
  const result = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    const valA = Number(sliceA[p]) === segIdx ? 1 : 0;
    const valB = Number(sliceB[p]) === segIdx ? 1 : 0;
    const blend = (1 - alpha) * valA + alpha * valB;
    if (blend >= threshold) {
      result[p] = segIdx;
    }
  }
  return result;
}

/**
 * SDF interpolation for a single gap slice (factored out from performLabelmapInterpolation).
 * Returns a Uint8Array where filled pixels have value segIdx.
 */
function interpolateSDF(
  sliceA: ArrayLike<number>,
  sliceB: ArrayLike<number>,
  alpha: number,
  width: number,
  height: number,
  segIdx: number,
): Uint8Array {
  const size = width * height;
  const signedA = buildSignedDistanceForSegment(sliceA, width, height, segIdx);
  const signedB = buildSignedDistanceForSegment(sliceB, width, height, segIdx);
  const result = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    const dist = (1 - alpha) * signedA[p] + alpha * signedB[p];
    if (dist <= 0) {
      result[p] = segIdx;
    }
  }
  return result;
}

function applySourceDicomContextToSegDataset(dataset: any, sourceImageId: string): void {
  if (!dataset || !sourceImageId) return;

  const patient = metaData.get('patientModule', sourceImageId) as any;
  const study = metaData.get('generalStudyModule', sourceImageId) as any;
  const patientStudy = metaData.get('patientStudyModule', sourceImageId) as any;
  const imagePlane = metaData.get('imagePlaneModule', sourceImageId) as any;

  // Keep patient/study identity aligned with the source series.
  if (patient?.patientName) dataset.PatientName = patient.patientName;
  if (patient?.patientId) dataset.PatientID = patient.patientId;
  if (patient?.patientBirthDate) dataset.PatientBirthDate = patient.patientBirthDate;
  if (patient?.patientSex) dataset.PatientSex = patient.patientSex;

  if (study?.studyInstanceUID) dataset.StudyInstanceUID = study.studyInstanceUID;
  if (study?.studyDate) dataset.StudyDate = study.studyDate;
  if (study?.studyTime) dataset.StudyTime = study.studyTime;
  if (study?.studyID) dataset.StudyID = study.studyID;
  if (study?.accessionNumber) dataset.AccessionNumber = study.accessionNumber;
  if (study?.studyDescription) dataset.StudyDescription = study.studyDescription;
  if (study?.referringPhysicianName) dataset.ReferringPhysicianName = study.referringPhysicianName;

  if (patientStudy?.patientAge) dataset.PatientAge = patientStudy.patientAge;
  if (patientStudy?.patientWeight) dataset.PatientWeight = patientStudy.patientWeight;
  if (patientStudy?.patientSize) dataset.PatientSize = patientStudy.patientSize;

  if (imagePlane?.frameOfReferenceUID) {
    dataset.FrameOfReferenceUID = imagePlane.frameOfReferenceUID;
  }
}

// ─── Sync Logic ─────────────────────────────────────────────────

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
    for (const [groupId, subSegArr] of subSegGroupMap) {
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
        const meta = segmentMetaMap.get(groupId)?.get(segmentIndex);

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

        // Locked
        const cachedLocked = cachedPresentation?.locked?.[segmentIndex];
        let locked = meta?.locked ?? false;
        if (typeof cachedLocked === 'boolean') locked = cachedLocked;

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
        label: groupLabelMap.get(groupId) ?? 'Segmentation',
        segments,
        isActive: groupId === store.activeSegmentationId,
      });
    }

    // ─── Pass 2: Legacy (non-group) segmentations ──────────────
    for (const seg of allSegmentations) {
      if (processedSubSegIds.has(seg.segmentationId)) continue;
      if (subSegGroupMap.has(seg.segmentationId)) continue; // group ID itself (no CS object)

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

          const cachedLocked = useSegmentationManagerStore.getState().presentation[seg.segmentationId]?.locked?.[idx];

          segments.push({
            segmentIndex: idx,
            label: segment.label || `Segment ${idx}`,
            color,
            visible,
            locked: typeof cachedLocked === 'boolean' ? cachedLocked : (segment.locked ?? false),
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
  const hasContour = repData?.Contour != null;

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
      const groupInfo = subSegToGroupMap.get(resolvedSegId);
      if (groupInfo) {
        resolvedSegId = groupInfo.groupId;
      }
    }

    if (detail?.segmentationId) {
      // For interpolation, use the resolved group ID so it can look up the right sub-seg
      const groupInfo = subSegToGroupMap.get(detail.segmentationId);
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
  autoSaveTimer = setTimeout(() => {
    void performAutoSave();
  }, AUTO_SAVE_DELAY);
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
  if (!segStore.autoSaveEnabled && !force) return false;

  // Skip if dirty tracking is suppressed (load/creation in progress)
  if (isDirtyTrackingSuppressed()) return false;

  // Skip if a SEG/RTSTRUCT load is in progress (prevents PixelData corruption)
  if (loadInProgressCount > 0) {
    console.log('[segmentationService] Auto-save skipped — SEG load in progress');
    return false;
  }

  // Skip if no actual unsaved changes
  if (!segStore.hasUnsavedChanges) return false;

  const xnatContext = useViewerStore.getState().xnatContext;
  if (!xnatContext) return false; // Not connected to XNAT or no context

  const activeSegId = segStore.activeSegmentationId;
  if (!activeSegId) return false;

  // Determine source scan: from origin if loaded from XNAT, else from context
  const origin = segStore.xnatOriginMap[activeSegId];
  const sourceScanId = origin?.sourceScanId ?? xnatContext.scanId;

  // Determine segmentation type to choose correct export format
  const segType = getSegmentationType(activeSegId);

  segStore._setAutoSaveStatus('saving');
  try {
    let base64: string;
    let tempFilename: string;
    const ts = formatTimestamp();

    if (segType === 'contour') {
      if (!segmentationService.hasExportableContent(activeSegId, 'RTSTRUCT')) {
        segStore._setAutoSaveStatus('idle');
        return false;
      }
      // Contour-only: export as RTSTRUCT
      base64 = await rtStructService.exportToRtStruct(activeSegId);
      tempFilename = `autosave_rtstruct_${sourceScanId}_${ts}.dcm`;
    } else {
      if (!segmentationService.hasExportableContent(activeSegId, 'SEG')) {
        segStore._setAutoSaveStatus('idle');
        return false;
      }
      // Labelmap (or both): export as DICOM SEG
      base64 = await segmentationService.exportToDicomSeg(activeSegId);
      tempFilename = `autosave_seg_${sourceScanId}_${ts}.dcm`;
    }

    // Clean up old auto-save files for this source scan before writing new one
    try {
      const existingFiles = await window.electronAPI.xnat.listTempFiles(xnatContext.sessionId);
      const cleanupPattern = new RegExp(`^autosave_(?:seg|rtstruct)_${sourceScanId}(?:_\\d{14})?\\.dcm$`);
      for (const f of existingFiles.files ?? []) {
        if (cleanupPattern.test(f.name)) {
          await window.electronAPI.xnat.deleteTempFile(xnatContext.sessionId, f.name);
        }
      }
    } catch { /* ignore cleanup errors */ }

    const result = await window.electronAPI.xnat.autoSaveTemp(
      xnatContext.sessionId,
      sourceScanId,
      base64,
      tempFilename,
    );
    if (result.ok) {
      segStore._setAutoSaveStatus('saved');
      segStore._markClean();
      console.log(`[segmentationService] Auto-saved ${segType} to temp resource for source scan ${sourceScanId} (${tempFilename})`);
      return true;
    } else {
      console.error('[segmentationService] Auto-save to temp failed:', result.error);
      segStore._setAutoSaveStatus('error');
      return false;
    }
  } catch (err: any) {
    // "No painted segment data" means the segmentation exists but has no actual
    // pixel data (user created it but hasn't painted yet). This is not an error —
    // silently return to idle instead of showing an error status.
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
  }
}

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
      groupLabelMap.set(segmentationId, label);
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
    eventTarget.addEventListener(Events.SEGMENTATION_MODIFIED, onSegmentationEvent);
    eventTarget.addEventListener(Events.SEGMENTATION_DATA_MODIFIED, onSegmentationEvent);
    eventTarget.addEventListener(Events.SEGMENTATION_ADDED, onSegmentationEvent);
    eventTarget.addEventListener(Events.SEGMENTATION_REMOVED, onSegmentationEvent);
    eventTarget.addEventListener(Events.SEGMENTATION_REPRESENTATION_MODIFIED, onSegmentationEvent);
    eventTarget.addEventListener(Events.SEGMENTATION_REPRESENTATION_ADDED, onSegmentationEvent);
    eventTarget.addEventListener(Events.SEGMENTATION_REPRESENTATION_REMOVED, onSegmentationEvent);

    // Auto-save: listen specifically for pixel-data changes (not metadata-only)
    eventTarget.addEventListener(Events.SEGMENTATION_DATA_MODIFIED, onSegmentationDataModified);

    // Auto-save: listen for contour annotation events (for contour-based segmentations)
    eventTarget.addEventListener(Events.ANNOTATION_COMPLETED as any, onAnnotationAutoSave);
    eventTarget.addEventListener(Events.ANNOTATION_MODIFIED as any, onAnnotationAutoSave);
    eventTarget.addEventListener(Events.ANNOTATION_COMPLETED as any, onAnnotationHistoryEvent);
    eventTarget.addEventListener(Events.ANNOTATION_MODIFIED as any, onAnnotationHistoryEvent);
    eventTarget.addEventListener(Events.ANNOTATION_REMOVED as any, onAnnotationHistoryEvent);

    // Increase undo ring buffer from default 50 to 200 for deep undo history
    if (DefaultHistoryMemo) {
      DefaultHistoryMemo.size = 200;
    }

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
      )).then(() => { metadataPreloadPromises.delete(segmentationId); });
      metadataPreloadPromises.set(segmentationId, preloadPromise);

      // If creating a default segment, we must await now because addSegment
      // needs metadata synchronously within this call.
      if (createDefaultSegment) {
        await preloadPromise;
      }
    }

    // Step 3: Initialize the multi-layer group (no labelmap images yet —
    // those are created per-segment in addSegment()).
    subSegGroupMap.set(segmentationId, []);
    segmentMetaMap.set(segmentationId, new Map());
    groupDimensionsMap.set(segmentationId, {
      rows,
      columns,
      rowPixelSpacing,
      columnPixelSpacing,
      sourceImageIds: [...sourceImageIds],
    });
    groupLabelMap.set(segmentationId, segLabel);

    // Track source imageIds for DICOM SEG export
    sourceImageIdsMap.set(segmentationId, [...sourceImageIds]);

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

      const annotationUIDsMap = new Map<number, Set<string>>();
      if (createDefaultSegment) {
        annotationUIDsMap.set(1, new Set<string>());
      }

      csSegmentation.addSegmentations([
        {
          segmentationId,
          representation: {
            type: ToolEnums.SegmentationRepresentations.Contour,
            data: { annotationUIDsMap } as any,
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

      sourceImageIdsMap.set(segmentationId, [...sourceImageIds]);

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

      const contourData = (seg.representationData as any)?.Contour;
      if (contourData?.annotationUIDsMap instanceof Map) {
        contourData.annotationUIDsMap.clear();
      }

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
      const contourData = (seg.representationData as any)?.Contour;
      if (contourData?.annotationUIDsMap instanceof Map) {
        if (!contourData.annotationUIDsMap.has(nextIndex)) {
          contourData.annotationUIDsMap.set(nextIndex, new Set<string>());
        }
      }

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
    const preloadPromise = metadataPreloadPromises.get(segmentationId);
    if (preloadPromise) {
      await preloadPromise;
    }

    const dims = groupDimensionsMap.get(segmentationId);
    if (!dims) {
      throw new Error(`[segmentationService] No dimensions stored for group: ${segmentationId}`);
    }

    // Determine next segment index from existing sub-segs.
    const subSegIds = subSegGroupMap.get(segmentationId)!;
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
    sourceImageIdsMap.set(subSegId, [...dims.sourceImageIds]);

    // Update group registry.
    subSegIds.push(subSegId);
    subSegToGroupMap.set(subSegId, { groupId: segmentationId, segmentIndex: nextIndex });
    segmentMetaMap.get(segmentationId)!.set(nextIndex, {
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
      subSegToGroupMap.delete(subSegId);
      sourceImageIdsMap.delete(subSegId);
      const groupArr = subSegGroupMap.get(segmentationId);
      if (groupArr) {
        groupArr[segmentIndex - 1] = null; // null-out the slot
      }
      segmentMetaMap.get(segmentationId)?.delete(segmentIndex);

      // If all sub-segs are removed, clean up the entire group
      const remaining = getActiveSubSegIds(segmentationId);
      if (remaining.length === 0) {
        subSegGroupMap.delete(segmentationId);
        segmentMetaMap.delete(segmentationId);
        groupDimensionsMap.delete(segmentationId);
        groupLabelMap.delete(segmentationId);
        sourceImageIdsMap.delete(segmentationId);
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
          subSegToGroupMap.delete(subSegId);
          sourceImageIdsMap.delete(subSegId);
        }
        // Clean up group maps
        subSegGroupMap.delete(segmentationId);
        segmentMetaMap.delete(segmentationId);
        groupDimensionsMap.delete(segmentationId);
        groupLabelMap.delete(segmentationId);
        sourceImageIdsMap.delete(segmentationId);
        loadedColorsMap.delete(segmentationId);
        groupViewportAttachments.delete(segmentationId);
        metadataPreloadPromises.delete(segmentationId);

        const store = useSegmentationStore.getState();
        if (store.activeSegmentationId === segmentationId) {
          store.setActiveSegmentation(null);
        }
        store.clearXnatOrigin(segmentationId);

        console.log(`[segmentationService] Removed group segmentation: ${segmentationId} (${allSubSegIds.length} sub-segs)`);
      } catch (err) {
        console.error('[segmentationService] Failed to remove group segmentation:', err);
      }
      syncSegmentations();
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
      sourceImageIdsMap.delete(segmentationId);
      loadedColorsMap.delete(segmentationId);

      const store = useSegmentationStore.getState();
      if (store.activeSegmentationId === segmentationId) {
        store.setActiveSegmentation(null);
      }
      store.clearXnatOrigin(segmentationId);

      console.log(`[segmentationService] Removed segmentation: ${segmentationId}`);
    } catch (err) {
      console.error('[segmentationService] Failed to remove segmentation:', err);
    }
    syncSegmentations();
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
      if (!groupViewportAttachments.has(segmentationId)) {
        groupViewportAttachments.set(segmentationId, new Set());
      }
      groupViewportAttachments.get(segmentationId)!.add(viewportId);

      const subSegIds = getActiveSubSegIds(segmentationId);
      const metaMap = segmentMetaMap.get(segmentationId);
      const store = useSegmentationStore.getState();
      const activeSegIdx = store.activeSegmentIndex;

      for (const subSegId of subSegIds) {
        const info = subSegToGroupMap.get(subSegId);
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
      const meta = segmentMetaMap.get(segmentationId)?.get(segmentIndex);
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
      const metaMap = segmentMetaMap.get(segmentationId);
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
      groupLabelMap.set(segmentationId, newLabel);
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
      const metaMap = segmentMetaMap.get(segmentationId);
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
      csSegmentation.segmentLocking.setSegmentIndexLocked(subSegId, 1, !isLocked);
      // Update metadata
      const meta = segmentMetaMap.get(segmentationId)?.get(segmentIndex);
      if (meta) meta.locked = !isLocked;
      syncSegmentations();
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    const isLocked = csSegmentation.segmentLocking.isSegmentIndexLocked(
      segmentationId,
      segmentIndex,
    );
    csSegmentation.segmentLocking.setSegmentIndexLocked(
      segmentationId,
      segmentIndex,
      !isLocked,
    );
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
      return csSegmentation.segmentLocking.isSegmentIndexLocked(
        segmentationId,
        segmentIndex,
      );
    } catch {
      return false; // default unlocked
    }
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
            locked: false,
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

      subSegGroupMap.set(segmentationId, []);
      segmentMetaMap.set(segmentationId, new Map());
      groupDimensionsMap.set(segmentationId, {
        rows: sourceRows,
        columns: sourceCols,
        rowPixelSpacing: loadRowSpacing,
        columnPixelSpacing: loadColSpacing,
        sourceImageIds: [...effectiveBaseSourceImageIds],
      });
      groupLabelMap.set(segmentationId, groupLabel);
      sourceImageIdsMap.set(segmentationId, [...effectiveBaseSourceImageIds]);

      const genericMeta = (csUtilities as any).genericMetadataProvider;
      let refGeneralSeriesMeta: any = null;
      for (const srcId of effectiveBaseSourceImageIds) {
        refGeneralSeriesMeta = metaData.get('generalSeriesModule', srcId);
        if (refGeneralSeriesMeta) break;
      }

      const pixelCount = sourceRows * sourceCols;
      const subSegIds = subSegGroupMap.get(segmentationId)!;
      const metaMapForGroup = segmentMetaMap.get(segmentationId)!;

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
                locked: false,
                active: segmentIndex === 1,
                cachedStats: {},
              } as any,
            },
          },
        }]);

        // Track source imageIds on the sub-seg
        sourceImageIdsMap.set(subSegId, [...effectiveBaseSourceImageIds]);

        // Update group registry
        subSegIds.push(subSegId);
        subSegToGroupMap.set(subSegId, { groupId: segmentationId, segmentIndex });
        metaMapForGroup.set(segmentIndex, {
          label: segLabel,
          color: segColor,
          locked: false,
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
      if (!seg.representationData.Contour) {
        (seg.representationData as any).Contour = {
          annotationUIDsMap: new Map(),
        };
      }

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
            locked: false,
            cachedStats: {},
            active: idx === activeIdx,
          };
        } else if (seg.segments[idx].locked === undefined) {
          (seg.segments[idx] as any).locked = seg.segments[idx].locked ?? false;
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

    const storedSrcImageIds = sourceImageIdsMap.get(segmentationId);
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
          SegmentNumber: idx,
          SegmentAlgorithmType: 'SEMIAUTOMATIC',
          SegmentAlgorithmName: 'XNAT Workstation',
          SegmentedPropertyCategoryCodeSequence: {
            CodeValue: 'T-D0050',
            CodingSchemeDesignator: 'SRT',
            CodeMeaning: 'Tissue',
          },
          SegmentedPropertyTypeCodeSequence: {
            CodeValue: 'T-D0050',
            CodingSchemeDesignator: 'SRT',
            CodeMeaning: 'Tissue',
          },
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
    applySourceDicomContextToSegDataset(ds, srcImageIds[0]);

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

    // Step 6: Serialize to ArrayBuffer via dcmjs.
    //
    // We use dcmjs DicomMetaDictionary.denaturalizeDataset() to convert the
    // human-readable dataset from generateSegmentation() into a tag-keyed
    // DICOM JSON structure, then DicomDict.write() to produce binary.
    //
    // We also avoid datasetToBlob/datasetToBuffer which depend on Node.js
    // Buffer — unavailable in Electron's renderer with context isolation.
    const dataset = segDerivation.dataset;
    const { DicomMetaDictionary, DicomDict } = dcmjsData as any;

    // --- Pre-denaturalization cleanup ---
    //
    // dcmjs generateSegmentation / SegmentationDerivation can leave values
    // in the dataset that cause problems during serialization:
    //
    //  1. `undefined` values → denaturalizeValue throws "undefined values"
    //  2. NaN numbers → denaturalizeValue converts to string "NaN" →
    //     parseInt("NaN") in toInt() throws "Not a number: NaN"
    //  3. Empty strings "" for numeric VR tags (US, UL, etc.) — these come
    //     from dcmjs DerivedDataset.assignFromReference() which does
    //     `dataset[tag] = referencedDataset[tag] || ""`. When writeUint16
    //     receives the string "" via toInt(""), parseInt("") returns NaN,
    //     and DataView.setUint16(offset, NaN) silently writes 0.
    //
    // Strategy: Remove undefined properties entirely (denaturalizeDataset
    // skips them), convert NaN to 0, and delete empty-string values for
    // known numeric-VR tags so they are omitted from the file rather than
    // written as corrupt 0 values.

    // Known DICOM tags with numeric VR (US, UL, SS, SL, FL, FD) that
    // dcmjs assignFromReference may set to "" if missing from the reference.
    // We delete these empty-string values so they don't produce NaN writes.
    const NUMERIC_VR_TAGS = new Set([
      'Rows', 'Columns', 'BitsAllocated', 'BitsStored', 'HighBit',
      'PixelRepresentation', 'SamplesPerPixel', 'NumberOfFrames',
      'PlanarConfiguration', 'SmallestImagePixelValue', 'LargestImagePixelValue',
      'WindowCenter', 'WindowWidth', 'RescaleIntercept', 'RescaleSlope',
      'InstanceNumber', 'AcquisitionNumber', 'SeriesNumber',
      'RecommendedDisplayCIELabValue', 'MaximumFractionalValue',
      'LossyImageCompressionRatio', 'LossyImageCompressionMethod',
    ]);

    const sanitizeNaturalized = (obj: any, path = ''): void => {
      if (obj == null || typeof obj !== 'object') return;
      for (const key of Object.keys(obj)) {
        if (key === '_vrMap' || key === '_meta') continue;
        const val = obj[key];
        if (val === undefined) {
          // Remove undefined properties — denaturalizeDataset skips them
          delete obj[key];
          continue;
        }
        if (typeof val === 'number' && isNaN(val)) {
          console.warn(`[segmentationService] Sanitized NaN in ${path}${key} → 0`);
          obj[key] = 0;
        } else if (val === '' && NUMERIC_VR_TAGS.has(key)) {
          // Empty string for a numeric tag would serialize as NaN → 0.
          // Delete it so the tag is simply omitted from the file.
          console.warn(`[segmentationService] Removed empty-string numeric tag: ${path}${key}`);
          delete obj[key];
        } else if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            if (typeof val[i] === 'number' && isNaN(val[i])) {
              val[i] = 0;
            } else if (val[i] === undefined) {
              val[i] = '';
            } else if (typeof val[i] === 'object' && val[i] !== null) {
              sanitizeNaturalized(val[i], `${path}${key}[${i}].`);
            }
          }
        } else if (typeof val === 'object' && !(val instanceof ArrayBuffer) && !(ArrayBuffer.isView(val))) {
          sanitizeNaturalized(val, `${path}${key}.`);
        }
      }
    };

    // --- Post-denaturalization sanitization ---
    // Catches empty-string Value entries for numeric VRs in the
    // tag-keyed denaturalized structure. These would cause parseInt("") → NaN.
    const NUMERIC_VR_TYPES = new Set(['US', 'UL', 'SS', 'SL', 'FL', 'FD', 'IS', 'DS']);

    const sanitizeDenaturalized = (dict: any): void => {
      if (dict == null || typeof dict !== 'object') return;
      for (const tagKey of Object.keys(dict)) {
        const entry = dict[tagKey];
        if (entry == null || typeof entry !== 'object') continue;
        if (Array.isArray(entry.Value)) {
          const isNumericVR = NUMERIC_VR_TYPES.has(entry.vr);
          for (let i = 0; i < entry.Value.length; i++) {
            const v = entry.Value[i];
            if (typeof v === 'number' && isNaN(v)) {
              entry.Value[i] = 0;
            } else if (v === 'NaN' || v === 'undefined' || v === 'null') {
              entry.Value[i] = isNumericVR ? 0 : '';
            } else if (v === '' && isNumericVR) {
              // Empty string in a numeric VR → parseInt("") → NaN → 0.
              // Replace with 0 explicitly.
              entry.Value[i] = 0;
            } else if (typeof v === 'string' && isNumericVR && isNaN(parseInt(v, 10))) {
              // Non-parseable string in a numeric VR — dcmjs toInt() would
              // throw "Not a number: NaN". Replace with 0.
              entry.Value[i] = 0;
            } else if (v === undefined || v === null) {
              entry.Value[i] = isNumericVR ? 0 : '';
            } else if (typeof v === 'object') {
              sanitizeDenaturalized(v);
            }
          }
        }
      }
    };

    // Ensure critical tags are correct numbers (not strings, not empty)
    // BEFORE sanitization runs. These MUST be valid integers for a valid SEG.
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

    // Set up file meta information (same logic as dcmjs datasetToDict)
    const fileMetaVersionBuf = new Uint8Array(2);
    fileMetaVersionBuf[1] = 1;

    const transferSyntaxUID =
      dataset._meta?.TransferSyntaxUID?.Value?.[0] ??
      '1.2.840.10008.1.2.1'; // Explicit VR Little Endian

    dataset._meta = {
      MediaStorageSOPClassUID: dataset.SOPClassUID || '1.2.840.10008.5.1.4.1.1.66.4',
      MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
      ImplementationVersionName: 'dcmjs-0.0',
      TransferSyntaxUID: transferSyntaxUID,
      ImplementationClassUID:
        '2.25.80302813137786398554742050926734630921603366648225212145404',
      FileMetaInformationVersion: fileMetaVersionBuf.buffer,
    };

    // Sanitize the naturalized dataset
    sanitizeNaturalized(dataset);

    // Final verification: Rows/Columns must still be correct after sanitization
    if (dataset.Rows !== rows) dataset.Rows = rows;
    if (dataset.Columns !== columns) dataset.Columns = columns;

    // Denaturalize (convert human-readable property names to DICOM tag keys)
    const denaturalizedMeta = DicomMetaDictionary.denaturalizeDataset(dataset._meta);
    const denaturalizedDict = DicomMetaDictionary.denaturalizeDataset(dataset);

    // Sanitize the denaturalized structures
    sanitizeDenaturalized(denaturalizedMeta);
    sanitizeDenaturalized(denaturalizedDict);

    // Verify critical tags in denaturalized dict (Rows = 00280010, Columns = 00280011)
    const rowsTag = denaturalizedDict['00280010'];
    const colsTag = denaturalizedDict['00280011'];
    if (rowsTag?.Value?.[0] != null) {
      const rv = typeof rowsTag.Value[0] === 'string' ? parseInt(rowsTag.Value[0], 10) : rowsTag.Value[0];
      if (isNaN(rv) || rv !== rows) {
        console.warn(`[segmentationService] Fixing denaturalized Rows: ${rowsTag.Value[0]} → ${rows}`);
        rowsTag.Value[0] = rows;
      }
    }
    if (colsTag?.Value?.[0] != null) {
      const cv = typeof colsTag.Value[0] === 'string' ? parseInt(colsTag.Value[0], 10) : colsTag.Value[0];
      if (isNaN(cv) || cv !== columns) {
        console.warn(`[segmentationService] Fixing denaturalized Columns: ${colsTag.Value[0]} → ${columns}`);
        colsTag.Value[0] = columns;
      }
    }

    // Write to ArrayBuffer via dcmjs DicomDict.
    //
    // dcmjs's internal VR write methods compute byte counts via arithmetic
    // that can produce NaN (e.g., writing a malformed value where the length
    // calculation involves undefined fields). These NaN byte counts are then
    // passed to writeUint16/writeUint32, which call toInt() and throw
    // "Not a number: NaN". Dataset sanitization above handles Value arrays,
    // but cannot prevent NaN in dcmjs's internal length arithmetic.
    //
    // Workaround: use writeDicomDict() which temporarily guards the write
    // calls on the stream instance used by DicomDict.write(). This is scoped
    // to a single call and restores immediately.
    const arrayBuffer = writeDicomDict(DicomDict, denaturalizedMeta, denaturalizedDict);

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
    const dims = groupDimensionsMap.get(groupId);
    const srcImageIds = dims?.sourceImageIds ?? sourceImageIdsMap.get(groupId) ?? [];
    if (srcImageIds.length === 0) {
      throw new Error('[segmentationService] No source imageIds for group export.');
    }

    const subSegArr = subSegGroupMap.get(groupId) ?? [];
    const metaMap = segmentMetaMap.get(groupId);
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
        SegmentNumber: idx,
        SegmentAlgorithmType: 'SEMIAUTOMATIC',
        SegmentAlgorithmName: 'XNAT Workstation',
        SegmentedPropertyCategoryCodeSequence: {
          CodeValue: 'T-D0050',
          CodingSchemeDesignator: 'SRT',
          CodeMeaning: 'Tissue',
        },
        SegmentedPropertyTypeCodeSequence: {
          CodeValue: 'T-D0050',
          CodingSchemeDesignator: 'SRT',
          CodeMeaning: 'Tissue',
        },
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
          label: groupLabelMap.get(groupId) ?? 'Segmentation',
          segments,
        },
      }]);

      // Track source image IDs for the temp seg
      sourceImageIdsMap.set(tempSegId, [...srcImageIds]);

      // Delegate to the legacy export path
      const result = await this.exportToDicomSeg(tempSegId);

      return result;
    } finally {
      // Clean up temporary segmentation
      try { csSegmentation.removeSegmentation(tempSegId); } catch { /* ok */ }
      sourceImageIdsMap.delete(tempSegId);
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
    sourceImageIdsMap.set(segmentationId, [...imageIds]);
  },

  /**
   * Return tracked source image IDs for a segmentation (copy), if available.
   * Used by RTSTRUCT export to copy source DICOM identity fields.
   */
  getTrackedSourceImageIds(segmentationId: string): string[] | null {
    const ids = sourceImageIdsMap.get(segmentationId);
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
      const contourData = (seg.representationData as any)?.Contour;
      if (contourData?.annotationUIDsMap instanceof Map) {
        for (const uids of contourData.annotationUIDsMap.values()) {
          if (uids && typeof uids.size === 'number' && uids.size > 0) {
            return true;
          }
        }
      }
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
    eventTarget.removeEventListener(Events.SEGMENTATION_MODIFIED, onSegmentationEvent);
    eventTarget.removeEventListener(Events.SEGMENTATION_DATA_MODIFIED, onSegmentationEvent);
    eventTarget.removeEventListener(Events.SEGMENTATION_ADDED, onSegmentationEvent);
    eventTarget.removeEventListener(Events.SEGMENTATION_REMOVED, onSegmentationEvent);
    eventTarget.removeEventListener(Events.SEGMENTATION_REPRESENTATION_MODIFIED, onSegmentationEvent);
    eventTarget.removeEventListener(Events.SEGMENTATION_REPRESENTATION_ADDED, onSegmentationEvent);
    eventTarget.removeEventListener(Events.SEGMENTATION_REPRESENTATION_REMOVED, onSegmentationEvent);
    eventTarget.removeEventListener(Events.SEGMENTATION_DATA_MODIFIED, onSegmentationDataModified);
    eventTarget.removeEventListener(Events.ANNOTATION_COMPLETED as any, onAnnotationAutoSave);
    eventTarget.removeEventListener(Events.ANNOTATION_MODIFIED as any, onAnnotationAutoSave);
    eventTarget.removeEventListener(Events.ANNOTATION_COMPLETED as any, onAnnotationHistoryEvent);
    eventTarget.removeEventListener(Events.ANNOTATION_MODIFIED as any, onAnnotationHistoryEvent);
    eventTarget.removeEventListener(Events.ANNOTATION_REMOVED as any, onAnnotationHistoryEvent);

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

    // Clean up module-level state
    sourceImageIdsMap.clear();
    loadedColorsMap.clear();
    subSegGroupMap.clear();
    subSegToGroupMap.clear();
    segmentMetaMap.clear();
    groupDimensionsMap.clear();
    groupLabelMap.clear();
    segmentationCounter = 0;

    initialized = false;
    console.log('[segmentationService] Disposed');
  },
};
