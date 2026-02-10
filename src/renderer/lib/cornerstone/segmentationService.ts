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
 *   getUndoState()            — Query undo/redo availability
 *   cancelAutoSave()          — Cancel pending auto-save timer
 *   sync()                    — Force re-sync to store
 *   dispose()                 — Remove event listeners
 */
import { eventTarget, metaData, imageLoader, cache, utilities as csUtilities, getEnabledElementByViewportId } from '@cornerstonejs/core';
import type { Types as CoreTypes } from '@cornerstonejs/core';
import {
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
import { useSegmentationStore } from '../../stores/segmentationStore';
import type { SegmentationSummary, SegmentSummary } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
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

/**
 * Serialize a denaturalized DICOM dataset to an ArrayBuffer via dcmjs.
 *
 * First attempts a normal DicomDict.write(). If dcmjs throws "Not a number"
 * (caused by NaN in its internal byte-count arithmetic, not our dataset values),
 * retries once with a scoped NaN-guard on WriteBufferStream.prototype. The
 * guard is removed in a finally block — no permanent prototype mutation.
 */
function writeDicomDict(
  DicomDictClass: any,
  denaturalizedMeta: any,
  denaturalizedDict: any,
): ArrayBuffer {
  const dict = new DicomDictClass(denaturalizedMeta);
  dict.dict = denaturalizedDict;

  // Attempt 1: normal write — no prototype patching
  try {
    return dict.write();
  } catch (firstErr: any) {
    if (!(firstErr instanceof Error) || !firstErr.message.includes('Not a number')) {
      throw firstErr; // not the NaN error — rethrow
    }
    console.warn(
      '[segmentationService] DicomDict.write() hit NaN in dcmjs internals; retrying with NaN guard',
    );
  }

  // Attempt 2: scoped NaN-guard fallback
  const { WriteBufferStream } = dcmjsData as any;
  const proto = WriteBufferStream?.prototype;
  if (!proto) {
    // Can't access prototype — rethrow by trying again (will fail the same way)
    return dict.write();
  }

  const origWrite16 = proto.writeUint16;
  const origWrite32 = proto.writeUint32;
  try {
    proto.writeUint16 = function (value: any) {
      return origWrite16.call(this, isNaN(value) ? 0 : value);
    };
    proto.writeUint32 = function (value: any) {
      return origWrite32.call(this, isNaN(value) ? 0 : value);
    };

    // Fresh DicomDict — the first write() may have left internal state inconsistent
    const retryDict = new DicomDictClass(denaturalizedMeta);
    retryDict.dict = denaturalizedDict;
    return retryDict.write();
  } finally {
    proto.writeUint16 = origWrite16;
    proto.writeUint32 = origWrite32;
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

    for (const seg of allSegmentations) {
      const segments: SegmentSummary[] = [];

      // Iterate over segments (skip index 0 = background)
      if (seg.segments) {
        for (const [idxStr, segment] of Object.entries(seg.segments)) {
          const idx = Number(idxStr);
          if (idx === 0) continue; // Skip background
          if (!segment) continue;

          // Get color from first viewport that has this segmentation
          let color: [number, number, number, number] = DEFAULT_COLORS[(idx - 1) % DEFAULT_COLORS.length];
          const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(seg.segmentationId);
          if (viewportIds.length > 0) {
            try {
              const c = csSegmentation.config.color.getSegmentIndexColor(
                viewportIds[0],
                seg.segmentationId,
                idx,
              );
              if (c && c.length >= 4) {
                color = [c[0], c[1], c[2], c[3]];
              }
            } catch {
              // Use default color
            }
          }

          // Check visibility - from the representation's per-segment visibility
          // Try Labelmap first, then Contour
          let visible = true;
          if (viewportIds.length > 0) {
            try {
              visible = csSegmentation.config.visibility.getSegmentIndexVisibility(
                viewportIds[0],
                { segmentationId: seg.segmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
                idx,
              );
            } catch {
              try {
                visible = csSegmentation.config.visibility.getSegmentIndexVisibility(
                  viewportIds[0],
                  { segmentationId: seg.segmentationId, type: ToolEnums.SegmentationRepresentations.Contour },
                  idx,
                );
              } catch {
                // default visible
              }
            }
          }

          segments.push({
            segmentIndex: idx,
            label: segment.label || `Segment ${idx}`,
            color,
            visible,
            locked: segment.locked ?? false,
          });
        }
      }

      // Sort segments by index
      segments.sort((a, b) => a.segmentIndex - b.segmentIndex);

      const store = useSegmentationStore.getState();
      summaries.push({
        segmentationId: seg.segmentationId,
        label: seg.label || `Segmentation ${seg.segmentationId}`,
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

/** Push canUndo/canRedo booleans into the Zustand store. */
function refreshUndoState(): void {
  useSegmentationStore.getState()._refreshUndoState(
    DefaultHistoryMemo.canUndo,
    DefaultHistoryMemo.canRedo,
  );
}

// ─── Auto-Save Logic ─────────────────────────────────────────────

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY = 10_000; // 10 seconds after last edit

/** Called when segmentation pixel data changes — debounces auto-save. */
function onSegmentationDataModified(): void {
  scheduleAutoSave();
}

function scheduleAutoSave(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(performAutoSave, AUTO_SAVE_DELAY);
}

/** Cancel any pending auto-save (e.g. when a manual save starts). */
function cancelAutoSave(): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

async function performAutoSave(): Promise<void> {
  autoSaveTimer = null;
  const segStore = useSegmentationStore.getState();
  if (!segStore.autoSaveEnabled) return;

  const xnatContext = useViewerStore.getState().xnatContext;
  if (!xnatContext) return; // Not connected to XNAT or no context

  const activeSegId = segStore.activeSegmentationId;
  if (!activeSegId) return;

  // Determine source scan: from origin if loaded from XNAT, else from context
  const origin = segStore.xnatOriginMap[activeSegId];
  const sourceScanId = origin?.sourceScanId ?? xnatContext.scanId;

  segStore._setAutoSaveStatus('saving');
  try {
    const base64 = await segmentationService.exportToDicomSeg(activeSegId);
    const result = await window.electronAPI.xnat.autoSaveTemp(
      xnatContext.sessionId,
      sourceScanId,
      base64,
    );
    if (result.ok) {
      segStore._setAutoSaveStatus('saved');
      console.log(`[segmentationService] Auto-saved to temp resource for source scan ${sourceScanId}`);
    } else {
      console.error('[segmentationService] Auto-save to temp failed:', result.error);
      segStore._setAutoSaveStatus('error');
    }
  } catch (err) {
    console.error('[segmentationService] Auto-save failed:', err);
    segStore._setAutoSaveStatus('error');
  }
}

let initialized = false;

// ─── Public API ─────────────────────────────────────────────────

export const segmentationService = {
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

    // Increase undo ring buffer from default 50 to 200 for deep undo history
    DefaultHistoryMemo.size = 200;

    initialized = true;
    console.log('[segmentationService] Initialized — listening for segmentation events');
  },

  /**
   * Create a stack-based labelmap segmentation for the given source images.
   *
   * Creates an empty labelmap (one image per source image) with one default
   * segment. Returns the segmentationId.
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
  ): Promise<string> {
    segmentationCounter++;
    const segmentationId = `seg_${Date.now()}_${segmentationCounter}`;
    const segLabel = label || `Segmentation ${segmentationCounter}`;

    // Step 1: Determine image dimensions from a loaded source image.
    // Try each sourceImageId until we find one that's cached (the currently
    // displayed image is guaranteed to be cached).
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

    // Step 2: Pre-load all source images so their metadata is available.
    //
    // Stack segmentation in Cornerstone3D requires every source image to have
    // imagePlaneModule and generalSeriesModule metadata registered. With wadouri
    // images, metadata is only available after the DICOM file is fetched. If we
    // create labelmaps before all images are loaded, Cornerstone crashes when
    // scrolling to unloaded slices (matchImagesForOverlay and buildMetadata
    // both assume metadata is present).
    //
    // We fire off all loads in parallel and wait for them to complete. Images
    // that are already cached resolve instantly.
    console.log(`[segmentationService] Pre-loading ${sourceImageIds.length} images for segmentation metadata...`);
    const loadPromises = sourceImageIds.map((id) => {
      // If already cached, skip the load
      if (cache.getImage(id)) return Promise.resolve();
      return imageLoader.loadAndCacheImage(id).catch((err: any) => {
        console.warn(`[segmentationService] Failed to pre-load image ${id}:`, err);
      });
    });
    await Promise.all(loadPromises);
    console.log(`[segmentationService] All images pre-loaded, creating labelmaps...`);

    // Step 3: Create blank labelmap images using createAndCacheLocalImage().
    // Now that all source images are loaded, every one has valid metadata.
    //
    // We pass origin, direction, and frameOfReferenceUID from each source
    // image's imagePlaneModule so the labelmap overlay can be matched to the
    // correct source slice. We also register generalSeriesModule (for modality)
    // which Cornerstone's buildMetadata() requires.
    const labelmapImageIds: string[] = [];
    const pixelCount = rows * columns;

    // Grab generalSeriesModule from any source image (same for all slices in a series)
    let refGeneralSeriesMeta: any = null;
    for (const srcId of sourceImageIds) {
      refGeneralSeriesMeta = metaData.get('generalSeriesModule', srcId);
      if (refGeneralSeriesMeta) break;
    }

    const genericMeta = (csUtilities as any).genericMetadataProvider;

    for (let i = 0; i < sourceImageIds.length; i++) {
      const labelmapImageId = `generated:labelmap_${segmentationId}_${i}`;
      const srcImageId = sourceImageIds[i];

      // Get per-slice spatial metadata from the source image.
      const imagePlane = metaData.get('imagePlaneModule', srcImageId);

      imageLoader.createAndCacheLocalImage(labelmapImageId, {
        scalarData: new Uint8Array(pixelCount),
        dimensions: [columns, rows],
        spacing: [columnPixelSpacing, rowPixelSpacing],
        origin: imagePlane?.imagePositionPatient,
        direction: imagePlane?.imageOrientationPatient,
        frameOfReferenceUID: imagePlane?.frameOfReferenceUID,
        referencedImageId: srcImageId,
      } as any);

      // Register generalSeriesModule metadata for the labelmap image.
      // Cornerstone's buildMetadata() destructures { modality } from this
      // module and crashes if it's missing when adding the overlay.
      if (refGeneralSeriesMeta) {
        genericMeta.add(labelmapImageId, {
          type: 'generalSeriesModule',
          metadata: refGeneralSeriesMeta,
        });
      }

      labelmapImageIds.push(labelmapImageId);
    }

    // Step 4: Register the segmentation with Cornerstone's state,
    // providing the labelmap imageIds so the state manager can map them.
    csSegmentation.addSegmentations([
      {
        segmentationId,
        representation: {
          type: ToolEnums.SegmentationRepresentations.Labelmap,
          data: {
            imageIds: labelmapImageIds,
          } as any,
        },
        config: {
          label: segLabel,
          segments: {
            1: { label: 'Segment 1', locked: false, active: true } as any,
          },
        },
      },
    ]);

    // Immediately add empty Contour representation data so contour tools can
    // work without needing PolySeg to convert from labelmap (which fails for
    // stack-based labelmaps). Direct mutation is safe here — Object.freeze is
    // shallow, and this is the same pattern used by the official
    // addRepresentationData API internally.
    const segObj = csSegmentation.state.getSegmentation(segmentationId);
    if (segObj) {
      (segObj.representationData as any).Contour = {
        annotationUIDsMap: new Map(),
      };
    }

    // Store: set as active segmentation + segment index 1
    const store = useSegmentationStore.getState();
    store.setActiveSegmentation(segmentationId);
    store.setActiveSegmentIndex(1);

    // Set the active segment index in Cornerstone
    csSegmentation.segmentIndex.setActiveSegmentIndex(segmentationId, 1);

    // Track source imageIds for DICOM SEG export
    sourceImageIdsMap.set(segmentationId, [...sourceImageIds]);

    console.log(`[segmentationService] Created stack segmentation: ${segmentationId} (${labelmapImageIds.length} labelmap images, ${columns}×${rows})`);

    syncSegmentations();
    return segmentationId;
  },

  /**
   * Add a new segment to an existing segmentation.
   * Returns the new segment index (1-based).
   */
  addSegment(
    segmentationId: string,
    label: string,
    color?: [number, number, number, number],
  ): number {
    const seg = csSegmentation.state.getSegmentation(segmentationId);
    if (!seg) {
      throw new Error(`[segmentationService] Segmentation not found: ${segmentationId}`);
    }

    // Find next available segment index
    const existingIndices = Object.keys(seg.segments || {}).map(Number).filter(n => n > 0);
    const nextIndex = existingIndices.length > 0 ? Math.max(...existingIndices) + 1 : 1;

    // Update segmentation state with new segment
    csSegmentation.updateSegmentations([
      {
        segmentationId,
        config: {
          segments: {
            ...seg.segments,
            [nextIndex]: {
              label: label || `Segment ${nextIndex}`,
              locked: false,
              active: false,
              segmentIndex: nextIndex,
              cachedStats: {},
            } as any,
          },
        },
      },
    ] as any);

    // Set color on all viewports that have this segmentation
    const segColor = color || DEFAULT_COLORS[(nextIndex - 1) % DEFAULT_COLORS.length];
    const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(segmentationId);
    for (const vpId of viewportIds) {
      try {
        csSegmentation.config.color.setSegmentIndexColor(
          vpId,
          segmentationId,
          nextIndex,
          segColor as any,
        );
      } catch {
        // Color may not be settable if representation not fully loaded
      }
    }

    console.log(`[segmentationService] Added segment ${nextIndex} to ${segmentationId}: "${label}"`);

    syncSegmentations();
    return nextIndex;
  },

  /**
   * Remove a segment from a segmentation.
   */
  removeSegment(segmentationId: string, segmentIndex: number): void {
    try {
      csSegmentation.removeSegment(segmentationId, segmentIndex);
      console.log(`[segmentationService] Removed segment ${segmentIndex} from ${segmentationId}`);
    } catch (err) {
      console.error('[segmentationService] Failed to remove segment:', err);
    }
    syncSegmentations();
  },

  /**
   * Remove an entire segmentation from Cornerstone state.
   */
  removeSegmentation(segmentationId: string): void {
    try {
      // Remove representations from all viewports first (both Labelmap and Contour)
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

      // Remove the segmentation itself
      csSegmentation.removeSegmentation(segmentationId);

      // Clean up source imageId tracking
      sourceImageIdsMap.delete(segmentationId);

      // Update store
      const store = useSegmentationStore.getState();
      if (store.activeSegmentationId === segmentationId) {
        store.setActiveSegmentation(null);
      }

      console.log(`[segmentationService] Removed segmentation: ${segmentationId}`);
    } catch (err) {
      console.error('[segmentationService] Failed to remove segmentation:', err);
    }
    syncSegmentations();
  },

  /**
   * Display a segmentation on a viewport as a labelmap overlay.
   * Creates the representation and sets it as active.
   */
  async addToViewport(viewportId: string, segmentationId: string): Promise<void> {
    // Step 0: Wait for the viewport to be fully ready.
    // After React re-renders that change imageIds, the CornerstoneViewport
    // useEffect destroys and recreates the viewport. We need to wait until
    // the new viewport exists and has images loaded.
    {
      let viewport: any = null;
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          const enabledEl = getEnabledElementByViewportId(viewportId);
          viewport = enabledEl?.viewport;
          if (viewport && viewport.getImageIds().length > 0 && viewport.getCurrentImageId()) {
            break;
          }
        } catch { /* viewport not ready yet */ }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!viewport) {
        console.error(`[segmentationService] Viewport ${viewportId} not ready after 5s, aborting addToViewport`);
        return;
      }
      console.log(`[segmentationService] Viewport ${viewportId} ready, adding segmentation ${segmentationId}`);
    }

    // Step 1: Add labelmap representation (core requirement for brush tools)
    try {
      csSegmentation.addLabelmapRepresentationToViewport(viewportId, [
        {
          segmentationId,
        },
      ]);
    } catch (err) {
      console.error('[segmentationService] Failed to add labelmap to viewport:', err);
      syncSegmentations();
      return; // Can't continue without labelmap
    }

    // Step 2: Set as active segmentation + apply styles (must succeed for brush to work)
    try {
      csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
    } catch (err) {
      console.error('[segmentationService] Failed to set active segmentation:', err);
    }

    // Apply current style settings
    try {
      const store = useSegmentationStore.getState();
      this.updateStyle(store.fillAlpha, store.renderOutline);
    } catch (err) {
      console.error('[segmentationService] Failed to update style:', err);
    }

    // Set colors for all segments
    const seg = csSegmentation.state.getSegmentation(segmentationId);
    if (seg?.segments) {
      for (const [idxStr] of Object.entries(seg.segments)) {
        const idx = Number(idxStr);
        if (idx === 0) continue;
        const color = DEFAULT_COLORS[(idx - 1) % DEFAULT_COLORS.length];
        try {
          csSegmentation.config.color.setSegmentIndexColor(
            viewportId,
            segmentationId,
            idx,
            color as any,
          );
        } catch {
          // Might fail if representation not ready yet
        }
      }
    }

    // Step 3: Add contour representation (optional — for contour tools).
    try {
      csSegmentation.addContourRepresentationToViewport(viewportId, [
        { segmentationId },
      ]);
    } catch (err) {
      console.debug('[segmentationService] Contour representation add failed (non-critical):', err);
    }

    // Step 4: Trigger segmentation render to ensure overlay is visible.
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
    syncSegmentations();
  },

  /**
   * Remove all segmentations that are associated with a specific viewport.
   * Call this before loading a new scan into a viewport to clean up stale
   * segmentation overlays from the previous scan. Without this cleanup,
   * Cornerstone crashes in matchImagesForOverlay when the new source images
   * don't match the old labelmap metadata.
   */
  removeSegmentationsFromViewport(viewportId: string): void {
    try {
      const allSegmentations = csSegmentation.state.getSegmentations();
      const toRemoveFully: string[] = [];

      for (const seg of allSegmentations) {
        const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(seg.segmentationId);
        if (viewportIds.includes(viewportId)) {
          // Remove representations from this viewport
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

          // If this was the only viewport, fully remove the segmentation
          // to prevent stale entries in the panel that can't be re-activated.
          if (viewportIds.length <= 1) {
            toRemoveFully.push(seg.segmentationId);
          }

          console.log(`[segmentationService] Removed segmentation ${seg.segmentationId} from viewport ${viewportId}`);
        }
      }

      // Fully remove segmentations that are no longer on any viewport
      for (const segId of toRemoveFully) {
        try {
          csSegmentation.removeSegmentation(segId);
          sourceImageIdsMap.delete(segId);
          console.log(`[segmentationService] Fully removed orphaned segmentation: ${segId}`);
        } catch {
          // Already removed
        }
      }

      // Clear active segmentation if it was removed
      if (toRemoveFully.length > 0) {
        const store = useSegmentationStore.getState();
        if (store.activeSegmentationId && toRemoveFully.includes(store.activeSegmentationId)) {
          store.setActiveSegmentation(null);
        }
      }

      syncSegmentations();
    } catch (err) {
      console.error('[segmentationService] Failed to remove segmentations from viewport:', err);
    }
  },

  /**
   * Switch the active segmentation on a viewport (Cornerstone-level).
   * Called when the user selects a different segmentation in the panel.
   * Also ensures the contour representation exists so contour tools keep working.
   */
  activateOnViewport(viewportId: string, segmentationId: string): void {
    // First check if this segmentation actually has a representation on this viewport.
    // If not (e.g., it was cleaned up when switching scans), skip activation.
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

    // Ensure contour representation is registered on this viewport
    // for the newly-activated segmentation (non-critical, for contour tools).
    try {
      csSegmentation.addContourRepresentationToViewport(viewportId, [
        { segmentationId },
      ]);
    } catch (err) {
      console.debug('[segmentationService] activateOnViewport contour:', err);
    }
  },

  /**
   * Set the active segment index for painting.
   * Index 0 = background (eraser mode), 1+ = segments.
   */
  setActiveSegmentIndex(segmentationId: string, segmentIndex: number): void {
    csSegmentation.segmentIndex.setActiveSegmentIndex(segmentationId, segmentIndex);
    useSegmentationStore.getState().setActiveSegmentIndex(segmentIndex);
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
    // Toggle visibility for both Labelmap and Contour representations
    let currentVisible = true;

    // Try to get current visibility from Labelmap first, then Contour
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

    // Set visibility on Labelmap representation
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

    // Set visibility on Contour representation
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
  },

  /**
   * Toggle lock for a segment (locked segments can't be painted over).
   */
  toggleSegmentLocked(segmentationId: string, segmentIndex: number): void {
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
    segmentationCounter++;
    const segmentationId = `seg_dicom_${Date.now()}_${segmentationCounter}`;

    try {
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
      const srcImg = cache.getImage(sourceImageIds[0]);
      const pixMod = metaData.get('imagePixelModule', sourceImageIds[0]);
      const sourceRows = pixMod?.rows ?? srcImg?.rows ?? srcImg?.height;
      const sourceCols = pixMod?.columns ?? srcImg?.columns ?? srcImg?.width;
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
      const loadMetadataProvider = {
        get: (type: string, imageId: string) => {
          const result = metaData.get(type, imageId);
          if (type === 'instance' && result) {
            if (result.Rows == null || result.Columns == null) {
              // Return a shallow copy to avoid mutating the cached metadata object
              return { ...result, Rows: result.Rows ?? sourceRows, Columns: result.Columns ?? sourceCols };
            }
          }
          return result;
        },
      };

      // Parse the DICOM SEG using the adapter. createFromDICOMSegBuffer
      // creates derived labelmap images (with derived:{uuid} imageIds) for
      // every source image, spatially matches each SEG frame to the correct
      // source image, and writes pixel data directly into the matched images.
      const result = await adaptersSEG.Cornerstone3D.Segmentation.createFromDICOMSegBuffer(
        sourceImageIds,
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
        }
      }

      // Use the adapter's derived labelmap images directly.
      //
      // The adapter's createFromDICOMSegBuffer:
      //   1. Creates one derived:uuid labelmap image per source image
      //   2. Spatially matches each SEG frame to the correct source image
      //   3. Writes pixel data directly into the correct labelmap image
      //   4. Each image has .imageId and .referencedImageId set
      //
      // The derived images already have correct spatial metadata inherited
      // from the source images (via createAndCacheDerivedLabelmapImage),
      // so Cornerstone's matchImagesForOverlay will match them properly.
      const labelmapImageIds: string[] = [];

      for (let i = 0; i < adapterImages.length; i++) {
        const adapterImg = adapterImages[i];
        if (!adapterImg || !adapterImg.imageId) {
          console.warn(`[segmentationService] Adapter image ${i} missing or has no imageId`);
          continue;
        }
        labelmapImageIds.push(adapterImg.imageId);
      }

      const { referencedImageId, labelmapImageId } = findFirstNonZeroRef(adapterImages);

      // Register the segmentation with Cornerstone
      csSegmentation.addSegmentations([
        {
          segmentationId,
          representation: {
            type: ToolEnums.SegmentationRepresentations.Labelmap,
            data: labelmapImageIds.length > 0
              ? { imageIds: labelmapImageIds } as any
              : undefined,
          },
          config: {
            label: segMetadata?.seriesInstanceUid
              ? `DICOM SEG`
              : `DICOM SEG ${segmentationCounter}`,
            segments,
          },
        },
      ]);

      // Add empty Contour representation data so contour tools work without
      // PolySeg conversion (which fails for stack-based labelmaps).
      const segObjDicom = csSegmentation.state.getSegmentation(segmentationId);
      if (segObjDicom) {
        (segObjDicom.representationData as any).Contour = {
          annotationUIDsMap: new Map(),
        };
      }

      // Track source imageIds for DICOM SEG re-export
      sourceImageIdsMap.set(segmentationId, [...sourceImageIds]);

      // Update store
      const store = useSegmentationStore.getState();
      store.setActiveSegmentation(segmentationId);
      store.setActiveSegmentIndex(1);
      csSegmentation.segmentIndex.setActiveSegmentIndex(segmentationId, 1);

      console.log(
        `[segmentationService] Loaded DICOM SEG: ${segmentationId}`,
        `(${Object.keys(segments).length} segments, ${labelmapImageIds.length} labelmap images)`,
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
      const activeIdx = useSegmentationStore.getState().activeSegmentIndex;
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
  updateContourStyle(): void {
    try {
      csSegmentation.segmentationStyle.setStyle(
        { type: ToolEnums.SegmentationRepresentations.Contour },
        {
          renderFill: false,
          renderOutline: true,
          outlineWidth: 2,
          outlineOpacity: 1,
          renderFillInactive: false,
          renderOutlineInactive: true,
          outlineWidthInactive: 1,
          outlineOpacityInactive: 0.6,
        },
      );
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
    let srcImageIds = [...storedSrcImageIds];

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
    for (const srcId of srcImageIds) {
      const img = cache.getImage(srcId);
      if (!img) {
        throw new Error(`[segmentationService] Source image not in cache: ${srcId}. All source images must be loaded.`);
      }
      sourceImages.push(img);
    }

    // Step 2: Build labelmaps2D array — one entry per source image slice.
    // Each entry has { pixelData, segmentsOnLabelmap, rows, columns }.
    //
    // CRITICAL: labelmaps2D[i] must correspond to sourceImages[i] (and
    // srcImageIds[i]).  generateSegmentation pairs them by index.
    //
    // However, labelmapImageIds may be in a DIFFERENT order than srcImageIds
    // because Cornerstone's matchImagesForOverlay can reorder labelmap images
    // by spatial position (IPP). If we naively zip labelmapImageIds[i] with
    // srcImageIds[i], the pixel data ends up on the wrong source slice —
    // causing the "slice 2 shows on slice 19" mirroring bug.
    //
    // Fix: build a lookup from referencedImageId → labelmap cached image,
    // then iterate srcImageIds and pull the correct labelmap for each.
    const labelmaps2D: any[] = [];
    const rows = sourceImages[0].rows ?? sourceImages[0].height ?? 512;
    const columns = sourceImages[0].columns ?? sourceImages[0].width ?? 512;

    // Build referencedImageId → labelmap image lookup.
    // Each labelmap image's .referencedImageId tells us which source image it
    // corresponds to. This is the ONLY reliable way to pair them — we cannot
    // use array index because the viewport may have reordered the labelmap
    // images by spatial position (IPP), reversing them relative to srcImageIds.
    const refIdToLabelmap = new Map<string, any>();
    for (let li = 0; li < labelmapImageIds.length; li++) {
      const lmId = labelmapImageIds[li];
      const lmImage = cache.getImage(lmId);
      if (!lmImage) continue;
      const refId = (lmImage as any).referencedImageId;
      if (refId) {
        refIdToLabelmap.set(refId, lmImage);
      }
    }

    const useRefIdLookup = refIdToLabelmap.size > 0;

    for (let i = 0; i < srcImageIds.length; i++) {
      const srcId = srcImageIds[i];
      const lmImage = useRefIdLookup
        ? refIdToLabelmap.get(srcId)
        : cache.getImage(labelmapImageIds[i]);

      if (!lmImage) {
        labelmaps2D.push({
          pixelData: new Uint8Array(rows * columns),
          segmentsOnLabelmap: [],
          rows,
          columns,
        });
        continue;
      }

      // Get pixel data from the labelmap image
      let pixelData: Uint8Array;
      if (lmImage.voxelManager) {
        const scalarData = lmImage.voxelManager.getScalarData();
        pixelData = new Uint8Array(scalarData);
      } else if ((lmImage as any).getPixelData) {
        pixelData = new Uint8Array((lmImage as any).getPixelData());
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
        segmentsOnLabelmap: Array.from(segmentsOnSlice),
        rows,
        columns,
      });
    }

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

        segmentMetadata.push({
          SegmentLabel: segment.label || `Segment ${idx}`,
          SegmentNumber: idx,
          SegmentAlgorithmType: 'SEMIAUTOMATIC',
          SegmentAlgorithmName: 'XNAT Viewer',
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
          recommendedDisplayRGBValue: [color[0], color[1], color[2]],
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
   * Track source image IDs for a segmentation (used for DICOM SEG/RTSTRUCT export).
   * Called by rtStructService when loading RTSTRUCT contours.
   */
  trackSourceImageIds(segmentationId: string, imageIds: string[]): void {
    sourceImageIdsMap.set(segmentationId, [...imageIds]);
  },

  // ─── Undo / Redo ──────────────────────────────────────────────

  /**
   * Undo the last segmentation/contour edit.
   * Uses Cornerstone3D's DefaultHistoryMemo ring buffer.
   */
  undo(): void {
    if (!DefaultHistoryMemo.canUndo) return;
    DefaultHistoryMemo.undo();
    syncSegmentations();
    refreshUndoState();
  },

  /**
   * Redo a previously undone edit.
   */
  redo(): void {
    if (!DefaultHistoryMemo.canRedo) return;
    DefaultHistoryMemo.redo();
    syncSegmentations();
    refreshUndoState();
  },

  /**
   * Get current undo/redo availability (for external callers).
   */
  getUndoState(): { canUndo: boolean; canRedo: boolean } {
    return {
      canUndo: DefaultHistoryMemo.canUndo,
      canRedo: DefaultHistoryMemo.canRedo,
    };
  },

  /**
   * Cancel any pending auto-save timer (e.g. when a manual save starts).
   */
  cancelAutoSave,

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

    // Cancel pending auto-save
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }

    // Clean up module-level state
    sourceImageIdsMap.clear();
    segmentationCounter = 0;

    initialized = false;
    console.log('[segmentationService] Disposed');
  },
};
