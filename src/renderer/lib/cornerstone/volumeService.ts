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
  metaData,
} from '@cornerstonejs/core';

const VOLUME_SCHEME = 'cornerstoneStreamingImageVolume';

/**
 * For a 4D / multi-volume series — the SAME slice position imaged at multiple time
 * points (perfusion, DWI, fMRI, cardiac cine) — return just ONE time point's images
 * (the first occurrence at each ImagePositionPatient). Building a single 3D volume
 * from ALL of them packs overlapping positions into one grid → corrupt geometry
 * (off-axis reformat renders garbage; getCurrentImageId throws "No imageId found").
 *
 * Keys off GEOMETRY (repeated IPP), not vendor 4D tags — Cornerstone's
 * getDynamicVolumeInfo only recognizes cardiac TriggerTime / diffusion tags, which
 * a generic EPI perfusion series lacks. A normal 3D series (no repeated positions)
 * is returned unchanged. If geometry metadata is missing, the input is returned
 * unchanged (never reduce on incomplete info). Pure read; exported for testing.
 */
export function selectPrimaryTimepointImageIds(imageIds: string[]): string[] {
  const seen = new Set<string>();
  const primary: string[] = [];
  for (const id of imageIds) {
    const ipp = (metaData.get('imagePlaneModule', id) as { imagePositionPatient?: number[] } | undefined)
      ?.imagePositionPatient;
    if (!Array.isArray(ipp) || ipp.length < 3) return imageIds; // incomplete geometry → don't reduce
    const key = `${ipp[0].toFixed(2)},${ipp[1].toFixed(2)},${ipp[2].toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    primary.push(id);
  }
  // Fewer than the input ⇒ repeated positions ⇒ 4D ⇒ use the reduced (one time point).
  return primary.length < imageIds.length ? primary : imageIds;
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

/** Deterministic volume id for a (scanId, FrameOfReferenceUID) pair. */
function makeSharedVolumeId(scanId: string, frameOfReferenceUID: string): string {
  return `${VOLUME_SCHEME}:shared:${scanId}:${frameOfReferenceUID}`;
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
    const volumeId = makeSharedVolumeId(scanId, frameOfReferenceUID);
    const existing = sharedVolumes.get(volumeId);
    if (existing) {
      existing.refCount += 1;
      return { volumeId, created: false, refCount: existing.refCount };
    }
    // For a 4D / multi-volume (functional) series, build the volume from ONE time
    // point (first image at each position) so the 3D geometry is clean and off-axis
    // reformat works. (Navigating time points is a follow-up.) 3D series: unchanged.
    const volumeImageIds = selectPrimaryTimepointImageIds(imageIds);
    if (volumeImageIds.length < imageIds.length) {
      console.log(
        '[volumeService] 4D / multi-volume series → first time point:',
        `${volumeImageIds.length} of ${imageIds.length} images`,
      );
    }
    const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds: volumeImageIds });
    volumeRefs.set(volumeId, { load: () => volume.load(), imageIds: volumeImageIds });
    sharedVolumes.set(volumeId, { refCount: 1, imageIds: volumeImageIds });
    console.log('[volumeService] Shared volume acquired (new):', volumeId, `(${volumeImageIds.length} images)`);
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
