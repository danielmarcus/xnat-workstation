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
} from '@cornerstonejs/core';

const VOLUME_SCHEME = 'cornerstoneStreamingImageVolume';
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
};
