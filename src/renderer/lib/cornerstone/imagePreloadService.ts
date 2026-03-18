/**
 * Image Preload Service — eagerly loads all images in a stack in the background.
 *
 * When a scan is placed in a viewport, this service starts fetching all images
 * (full pixel data + metadata) so that scrolling and crosshair sync are instant.
 * The first image is skipped (already loaded by Cornerstone's setStack).
 *
 * Uses concurrency limiting to avoid overwhelming the network while leaving
 * bandwidth for user-initiated actions (scrolling to a specific slice, etc.).
 */
import { imageLoader, cache } from '@cornerstonejs/core';
import { pLimit } from '../util/pLimit';

/** Maximum concurrent image downloads. */
const CONCURRENCY = 6;

interface PreloadState {
  /** Set to true when cancelPreload is called. Checked before each load. */
  cancelled: boolean;
  /** Promise that resolves when all images are loaded (or cancelled). */
  promise: Promise<void>;
  /** Number of images successfully loaded. */
  loaded: number;
  /** Total number of images to load (excluding the first). */
  total: number;
}

const panelPreloads = new Map<string, PreloadState>();
const limit = pLimit(CONCURRENCY);

function isImageCached(imageId: string): boolean {
  try {
    // getImageLoadObject returns the load object if the image is in cache.
    return cache.getImageLoadObject(imageId) != null;
  } catch {
    return false;
  }
}

export const imagePreloadService = {
  /**
   * Start background pre-loading for all images in a panel's stack.
   * Non-blocking — returns immediately. Skips the first image (already loaded).
   * If a preload is already in progress for this panel, it is cancelled first.
   */
  startPreload(panelId: string, imageIds: string[]): void {
    // Cancel any existing preload for this panel.
    this.cancelPreload(panelId);

    if (imageIds.length <= 1) return; // Nothing to preload.

    const state: PreloadState = {
      cancelled: false,
      promise: Promise.resolve(),
      loaded: 0,
      total: imageIds.length - 1, // Exclude first image.
    };

    const remaining = imageIds.slice(1);
    const toLoad = remaining.filter((id) => !isImageCached(id));
    // Count already-cached images toward the loaded total.
    state.loaded = remaining.length - toLoad.length;

    if (toLoad.length === 0) {
      state.loaded = state.total;
      panelPreloads.set(panelId, state);
      console.log(`[imagePreload] All ${imageIds.length} images already cached for ${panelId}`);
      return;
    }

    console.log(
      `[imagePreload] Starting preload for ${panelId}: ${toLoad.length}/${imageIds.length - 1} images to fetch`,
    );

    state.promise = (async () => {
      const promises = toLoad.map((imageId) =>
        limit(async () => {
          if (state.cancelled) return;
          if (isImageCached(imageId)) {
            state.loaded++;
            return;
          }
          try {
            await imageLoader.loadAndCacheImage(imageId);
            state.loaded++;
          } catch (err) {
            // Non-fatal: image may be unavailable or network interrupted.
            // The image will be loaded on-demand when the user scrolls to it.
            if (!state.cancelled) {
              console.warn(`[imagePreload] Failed to preload ${imageId}:`, err instanceof Error ? err.message : err);
            }
          }
        }),
      );
      await Promise.all(promises);
      if (!state.cancelled) {
        console.log(`[imagePreload] Completed preload for ${panelId}: ${state.loaded}/${state.total} loaded`);
      }
    })();

    panelPreloads.set(panelId, state);
  },

  /**
   * Cancel any in-progress preload for a panel.
   * Already-started downloads will complete, but no new ones will be initiated.
   */
  cancelPreload(panelId: string): void {
    const existing = panelPreloads.get(panelId);
    if (existing) {
      existing.cancelled = true;
      panelPreloads.delete(panelId);
    }
  },

  /** Check if all images for a panel have been pre-loaded. */
  isFullyLoaded(panelId: string): boolean {
    const state = panelPreloads.get(panelId);
    if (!state) return false;
    return state.loaded >= state.total;
  },

  /** Get preload progress for a panel. Returns null if no preload is active. */
  getProgress(panelId: string): { loaded: number; total: number } | null {
    const state = panelPreloads.get(panelId);
    if (!state) return null;
    return { loaded: state.loaded, total: state.total };
  },
};
