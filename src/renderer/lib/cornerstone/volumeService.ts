/**
 * Volume Service — manages Cornerstone3D volume creation, loading, and cleanup.
 *
 * Used by MPR mode to build 3D volumes from stacks of DICOM images.
 * The streaming volume loader progressively loads images into the volume,
 * enabling the rendering engine to display partial data while loading.
 *
 * Volume lifecycle:
 * 1. generateId() — get a unique volume ID
 * 2. create(volumeId, imageIds) — create volume in cache (must await)
 * 3. load(volumeId, onProgress?) — start streaming image data into volume
 * 4. destroy(volumeId) — remove from cache when done
 *
 * create() and load() are separated so that viewports can call setVolume()
 * after create() returns (the volume object exists in cache), while load()
 * progressively fills in pixel data in the background.
 */
import {
  volumeLoader,
  cache,
  Enums,
  eventTarget,
  utilities as csCoreUtilities,
} from '@cornerstonejs/core';

const VOLUME_SCHEME = 'cornerstoneStreamingImageVolume';
/** Scheme that routes to the 4D (dynamic) streaming volume loader. */
const DYNAMIC_VOLUME_SCHEME = 'cornerstoneStreamingDynamicImageVolume';

/**
 * The volume-loader scheme for a series: the DYNAMIC scheme for a 4D / multi-volume
 * (functional) series — so Cornerstone builds a StreamingDynamicImageVolume with
 * correct per-time-point geometry — else the static scheme. `isDynamic` comes from
 * getDynamicVolumeInfo(imageIds). Pure + exported for unit testing.
 */
export function volumeSchemeFor(isDynamic: boolean): string {
  return isDynamic ? DYNAMIC_VOLUME_SCHEME : VOLUME_SCHEME;
}
let lastVolumeTs = 0;
let volumeSeq = 0;

/**
 * Generate a unique volume ID for MPR use.
 * Format: cornerstoneStreamingImageVolume:xnat_mpr_<timestamp>_<seq>
 */
export function generateVolumeId(): string {
  const now = Date.now();
  if (now === lastVolumeTs) {
    volumeSeq += 1;
  } else {
    lastVolumeTs = now;
    volumeSeq = 0;
  }
  return `${VOLUME_SCHEME}:xnat_mpr_${now}_${volumeSeq}`;
}

/** Keep a reference to volumes so we can call load() later */
const volumeRefs = new Map<string, { load: () => void | Promise<void>; imageIds: string[] }>();

/**
 * Ref-counted SHARED volumes keyed by (scanId, FrameOfReferenceUID) — the
 * Phase-1 model where two panels reformatting the same source scan share one
 * `ImageVolume` (design §1.5). A volume stays cached while ≥1 viewport holds it
 * and is destroyed when the last viewport releases it.
 */
const sharedVolumes = new Map<string, { refCount: number; imageIds: string[] }>();

/**
 * Deterministic volume id for a (scanId, FrameOfReferenceUID) pair. The scheme
 * prefix selects the loader — dynamic (4D) vs static — so a 4D series gets the
 * dynamic loader. `acquire` is the only place that builds the id (it has the
 * imageIds to detect 4D); `release` takes the returned id, so the scheme stays
 * consistent without recomputation.
 */
function makeSharedVolumeId(scanId: string, frameOfReferenceUID: string, isDynamic = false): string {
  return `${volumeSchemeFor(isDynamic)}:shared:${scanId}:${frameOfReferenceUID}`;
}

export const volumeService = {
  /**
   * Generate a unique volume ID.
   */
  generateId(): string {
    return generateVolumeId();
  },

  /**
   * Create a streaming volume in the Cornerstone cache.
   * After this resolves, viewports can call setVolume() with the volumeId.
   * The volume will be empty (no pixel data) until load() is called.
   */
  async create(volumeId: string, imageIds: string[]): Promise<void> {
    const volume = await volumeLoader.createAndCacheVolume(volumeId, {
      imageIds,
    });
    volumeRefs.set(volumeId, { load: () => volume.load(), imageIds });
    console.log('[volumeService] Volume created:', volumeId, `(${imageIds.length} images)`);
  },

  /**
   * Start loading image data into a previously created volume.
   * Call after create() and after viewports have called setVolume().
   *
   * @param volumeId - Volume ID from create()
   * @param onProgress - Optional callback for loading progress
   * @returns Promise that resolves when all images are loaded
   */
  async load(
    volumeId: string,
    onProgress?: (p: { loaded: number; total: number }) => void,
  ): Promise<void> {
    const ref = volumeRefs.get(volumeId);
    if (!ref) {
      throw new Error(`[volumeService] Volume not found: ${volumeId}`);
    }

    const { imageIds } = ref;

    // Set up progress tracking via event listener
    if (onProgress) {
      let loadedCount = 0;
      const total = imageIds.length;

      const handleImageLoaded = () => {
        loadedCount++;
        onProgress({ loaded: loadedCount, total });
      };

      // Listen for volume completion
      eventTarget.addEventListener(
        Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,
        function onComplete() {
          eventTarget.removeEventListener(
            Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,
            onComplete,
          );
          // Ensure final progress update
          onProgress({ loaded: total, total });
        },
      );

      // Track per-image progress via the IMAGE_LOADED event
      const handlePerImage = ((evt: Event) => {
        const detail = (evt as CustomEvent).detail;
        // Only count images that belong to our volume
        if (detail?.image?.imageId && imageIds.includes(detail.image.imageId)) {
          handleImageLoaded();
        }
      }) as EventListener;

      eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, handlePerImage);

      // Clean up per-image listener when volume is complete
      eventTarget.addEventListener(
        Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,
        function cleanup() {
          eventTarget.removeEventListener(Enums.Events.IMAGE_LOADED, handlePerImage);
          eventTarget.removeEventListener(
            Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,
            cleanup,
          );
        },
      );
    }

    // Start loading the volume
    await ref.load();
  },

  /**
   * Remove a volume from the Cornerstone cache.
   * Should be called when exiting MPR mode to free memory.
   */
  destroy(volumeId: string): void {
    volumeRefs.delete(volumeId);
    try {
      cache.removeVolumeLoadObject(volumeId);
      console.log('[volumeService] Volume destroyed:', volumeId);
    } catch {
      // Volume may not exist in cache — ignore
    }
  },

  // ─── Shared, ref-counted volumes (Phase 1, design §1.5) ──────────

  /** Deterministic shared volume id for a (scanId, FrameOfReferenceUID) pair. */
  sharedVolumeId(scanId: string, frameOfReferenceUID: string): string {
    return makeSharedVolumeId(scanId, frameOfReferenceUID);
  },

  /**
   * Acquire the shared `ImageVolume` for (scanId, FoR), creating + caching it on
   * first use and reusing it (refcount++) thereafter. `created` is true only on
   * the first acquire — the caller should then `load(volumeId)` once. Use this
   * (not create/generateId) for the unified viewport path so panels of the same
   * scan share one volume.
   */
  async acquire(
    scanId: string,
    frameOfReferenceUID: string,
    imageIds: string[],
  ): Promise<{ volumeId: string; created: boolean; refCount: number }> {
    // Detect 4D / multi-volume (functional) series and route to the dynamic loader
    // so each time point keeps its own geometry (otherwise off-axis reformat is
    // corrupt). Detection is by repeated ImagePositionPatient across the series.
    let isDynamic = false;
    try {
      isDynamic = csCoreUtilities.getDynamicVolumeInfo(imageIds).isDynamicVolume === true;
    } catch {
      isDynamic = false;
    }
    const volumeId = makeSharedVolumeId(scanId, frameOfReferenceUID, isDynamic);
    const existing = sharedVolumes.get(volumeId);
    if (existing) {
      existing.refCount += 1;
      return { volumeId, created: false, refCount: existing.refCount };
    }
    if (isDynamic) {
      console.log('[volumeService] 4D / multi-volume series → dynamic volume:', volumeId, `(${imageIds.length} images)`);
    }
    const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
    volumeRefs.set(volumeId, { load: () => volume.load(), imageIds });
    sharedVolumes.set(volumeId, { refCount: 1, imageIds });
    console.log('[volumeService] Shared volume acquired (new):', volumeId, `(${imageIds.length} images)`);
    return { volumeId, created: true, refCount: 1 };
  },

  /**
   * Release one hold on a shared volume. Destroys + uncaches it when the last
   * holder releases (refcount → 0). Returns the remaining refcount (0 if freed).
   */
  release(volumeId: string): number {
    const entry = sharedVolumes.get(volumeId);
    if (!entry) return 0;
    entry.refCount -= 1;
    if (entry.refCount > 0) return entry.refCount;
    sharedVolumes.delete(volumeId);
    volumeRefs.delete(volumeId);
    try {
      cache.removeVolumeLoadObject(volumeId);
      console.log('[volumeService] Shared volume freed (refcount 0):', volumeId);
    } catch {
      // Volume may not exist in cache — ignore
    }
    return 0;
  },

  /** Current refcount for a shared volume (0 if not held). */
  getRefCount(volumeId: string): number {
    return sharedVolumes.get(volumeId)?.refCount ?? 0;
  },
};
