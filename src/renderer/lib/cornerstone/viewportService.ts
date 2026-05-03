/**
 * Viewport Service — manages the Cornerstone3D RenderingEngine and
 * provides imperative methods for viewport manipulation.
 *
 * Supports multiple viewports within a single RenderingEngine.
 * Each viewport is identified by a panelId (e.g. 'panel_0').
 *
 * React components should never call Cornerstone3D directly — use this service.
 */
import {
  RenderingEngine,
  getRenderingEngine,
  Enums,
  type Types,
} from '@cornerstonejs/core';
import {
  eligibleViewportType,
  readEligibilityMetadata,
  type ViewportTypeKind,
} from './viewportService/stackEligibility';
import { volumeService } from './volumeService';

const ENGINE_ID = 'xnatRenderingEngine';

/** Track which elements are associated with which viewport IDs */
const elements = new Map<string, HTMLDivElement>();

function getEngine(): RenderingEngine | null {
  return (getRenderingEngine(ENGINE_ID) as RenderingEngine | null) ?? null;
}

/** Ensure the RenderingEngine exists. Creates it if needed. */
function ensureEngine(): RenderingEngine {
  const existing = getEngine();
  if (existing) return existing;
  return new RenderingEngine(ENGINE_ID);
}

function getStackViewport(viewportId: string): Types.IStackViewport | null {
  const engine = getEngine();
  if (!engine) return null;
  try {
    return engine.getViewport(viewportId) as Types.IStackViewport;
  } catch {
    return null;
  }
}

function getVolumeViewport(viewportId: string): Types.IVolumeViewport | null {
  const engine = getEngine();
  if (!engine) return null;
  try {
    return engine.getViewport(viewportId) as Types.IVolumeViewport;
  } catch {
    return null;
  }
}

/** Orientation for volume viewports. */
export type VolumeOrientation = 'AXIAL' | 'SAGITTAL' | 'CORONAL';

function orientationAxisFor(orientation: VolumeOrientation): Enums.OrientationAxis {
  switch (orientation) {
    case 'SAGITTAL': return Enums.OrientationAxis.SAGITTAL;
    case 'CORONAL': return Enums.OrientationAxis.CORONAL;
    case 'AXIAL':
    default:
      return Enums.OrientationAxis.AXIAL;
  }
}

export const viewportService = {
  ENGINE_ID,

  /**
   * Create a stack viewport for a panel, attached to a DOM element.
   * Creates the RenderingEngine on first call; subsequent calls reuse it.
   */
  createViewport(viewportId: string, element: HTMLDivElement): void {
    const engine = ensureEngine();

    // If this viewport already exists, disable it first
    if (elements.has(viewportId)) {
      try { engine.disableElement(viewportId); } catch { /* ok */ }
    }

    elements.set(viewportId, element);

    const viewportInput: Types.PublicViewportInput = {
      viewportId,
      type: Enums.ViewportType.STACK,
      element,
    };
    engine.enableElement(viewportInput);

    console.log('[viewportService] Viewport created:', viewportId);
  },

  /**
   * Destroy a single viewport (disable its element in the engine).
   */
  destroyViewport(viewportId: string): void {
    const engine = getEngine();
    if (engine) {
      try { engine.disableElement(viewportId); } catch { /* ok */ }
    }
    elements.delete(viewportId);
    console.log('[viewportService] Viewport destroyed:', viewportId);
  },

  /**
   * Destroy all viewports and the rendering engine.
   */
  destroyAllViewports(): void {
    const engine = getEngine();
    if (engine) {
      try { engine.destroy(); } catch { /* ok */ }
    }
    elements.clear();
    console.log('[viewportService] All viewports destroyed');
  },

  /**
   * Load a stack of images into a specific viewport.
   */
  async loadStack(viewportId: string, imageIds: string[]): Promise<void> {
    const viewport = getStackViewport(viewportId);
    if (!viewport) {
      console.error('[viewportService] No viewport to load stack into:', viewportId);
      return;
    }

    console.log('[viewportService] Loading stack with', imageIds.length, 'images into', viewportId);
    await viewport.setStack(imageIds);
    viewport.render();
  },

  /**
   * Get a StackViewport instance by ID.
   */
  getViewport(viewportId: string): Types.IStackViewport | null {
    return getStackViewport(viewportId);
  },

  /**
   * Get a VolumeViewport instance by ID. Returns null if the viewport is
   * stack-typed or not enabled.
   */
  getVolumeViewport(viewportId: string): Types.IVolumeViewport | null {
    return getVolumeViewport(viewportId);
  },

  // ─── Volume viewport creation (Phase 1.3) ──────────────────────
  //
  // The new path for the multi-viewport rewrite. Creates an
  // ORTHOGRAPHIC viewport with a specified orientation. Callers
  // should already have called volumeService.acquireSharedVolume()
  // to get the volumeId.

  /**
   * Create an ORTHOGRAPHIC volume viewport. Caller is responsible for
   * calling `setVolume()` afterwards (or directly `setVolumes()` on the
   * viewport) to bind the volume.
   */
  createVolumeViewport(
    viewportId: string,
    element: HTMLDivElement,
    orientation: VolumeOrientation = 'AXIAL',
  ): void {
    const engine = ensureEngine();

    if (elements.has(viewportId)) {
      try { engine.disableElement(viewportId); } catch { /* ok */ }
    }

    elements.set(viewportId, element);

    const viewportInput: Types.PublicViewportInput = {
      viewportId,
      type: Enums.ViewportType.ORTHOGRAPHIC,
      element,
      defaultOptions: {
        orientation: orientationAxisFor(orientation),
      },
    };
    engine.enableElement(viewportInput);

    console.log('[viewportService] Volume viewport created:', viewportId, orientation);
  },

  /**
   * Bind a volume to a previously-created volume viewport. The volume
   * must already exist in the Cornerstone cache (via
   * volumeService.create() or volumeService.acquireSharedVolume()).
   */
  async setVolume(viewportId: string, volumeId: string): Promise<void> {
    const viewport = getVolumeViewport(viewportId);
    if (!viewport) {
      console.error('[viewportService] No volume viewport for setVolume:', viewportId);
      return;
    }
    await viewport.setVolumes([{ volumeId }]);
    viewport.render();
  },

  /**
   * Determine the appropriate viewport type for a series, by reading the
   * representative imageId's metadata and applying the stack-eligibility
   * rules from `./viewportService/stackEligibility`.
   *
   * Returns 'volume' when no metadata is yet available — callers should
   * either defer the decision or fall through to a load that will populate
   * the cache.
   */
  resolveViewportType(imageIds: string[]): ViewportTypeKind {
    if (imageIds.length === 0) return 'stack';
    const meta = readEligibilityMetadata(imageIds[0]);
    if (!meta) {
      // Metadata not yet cached. The optimistic default is volume, since
      // the stack-eligibility predicate's negative-list (US, XA, RF, NM,
      // DX, CR, MG) is small and explicitly tracked.
      return 'volume';
    }
    return eligibleViewportType(meta, imageIds.length);
  },

  /**
   * High-level convenience: create a viewport for the given images, picking
   * volume vs stack via the eligibility predicate. Loads images directly.
   *
   * For volume viewports, uses `volumeService.acquireSharedVolume()` to get a
   * shared, refcounted volume keyed on `(scanId, frameOfReferenceUID)`. The
   * caller is responsible for calling `volumeService.releaseSharedVolume()`
   * on viewport teardown.
   *
   * For stack viewports, calls `loadStack()` directly.
   *
   * Returns the chosen viewport type so the caller knows which teardown
   * pattern to use.
   *
   * @param viewportId - Panel ID for the new viewport.
   * @param element - DOM element to attach to.
   * @param imageIds - Source images.
   * @param scanIdentity - Required for volume viewports: stable scan id +
   *                      frame-of-reference UID for the shared-volume cache.
   * @param orientation - Volume orientation (ignored for stack viewports).
   */
  async createViewportForImages(
    viewportId: string,
    element: HTMLDivElement,
    imageIds: string[],
    scanIdentity: { scanId: string; frameOfReferenceUID: string } | null,
    orientation: VolumeOrientation = 'AXIAL',
  ): Promise<ViewportTypeKind> {
    const kind = this.resolveViewportType(imageIds);

    if (kind === 'volume' && scanIdentity) {
      const { volumeId, isNew } = await volumeService.acquireSharedVolume(
        scanIdentity.scanId,
        scanIdentity.frameOfReferenceUID,
        imageIds,
      );
      this.createVolumeViewport(viewportId, element, orientation);
      await this.setVolume(viewportId, volumeId);
      if (isNew) {
        // Fire-and-forget: streaming load fills the volume incrementally
        // while the user is already interacting (per design §1.1).
        void volumeService.load(volumeId);
      }
      return 'volume';
    }

    // Fall through to stack: either eligibility says stack, or no scan
    // identity was supplied (which means we can't share the volume — caller
    // must use the legacy createViewport path or supply identity).
    this.createViewport(viewportId, element);
    await this.loadStack(viewportId, imageIds);
    return 'stack';
  },

  /**
   * Get the DOM element for a viewport.
   */
  getElement(viewportId: string): HTMLDivElement | null {
    return elements.get(viewportId) ?? null;
  },

  /**
   * Resize the rendering engine (updates all viewports).
   */
  resize(): void {
    const engine = getEngine();
    if (engine) {
      engine.resize();
    }
  },

  // ─── Manipulation Methods ──────────────────────────────────────

  /**
   * Set window/level (VOI) by window width and window center.
   */
  setVOI(viewportId: string, windowWidth: number, windowCenter: number): void {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;

    const lower = windowCenter - windowWidth / 2;
    const upper = windowCenter + windowWidth / 2;
    viewport.setProperties({ voiRange: { lower, upper } });
    viewport.render();
  },

  /**
   * Reset camera to default (fit-to-canvas, no rotation/flip).
   */
  resetCamera(viewportId: string): void {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;

    viewport.resetCamera();
    viewport.resetProperties();
    viewport.render();
  },

  /**
   * Set grayscale inversion.
   */
  setInvert(viewportId: string, invert: boolean): void {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;

    viewport.setProperties({ invert });
    viewport.render();
  },

  /**
   * Rotate viewport by 90 degrees clockwise.
   */
  rotate90(viewportId: string): void {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;

    const vp = viewport as any;
    try {
      const cur = typeof vp.getRotation === 'function' ? vp.getRotation() : 0;
      const next = (cur + 90) % 360;
      if (typeof vp.setRotation === 'function') {
        vp.setRotation(next);
      }
    } catch (err) {
      console.error('[viewportService] rotate90 failed:', err);
    }
    viewport.render();
  },

  /**
   * Toggle horizontal flip.
   *
   * Cornerstone3D's viewport.flip() treats any truthy value as "toggle"
   * (i.e., `flip({ flipHorizontal: true })` toggles the current state).
   * We must NOT use setViewPresentation() here because it passes the
   * desired state to flip(), but flip() interprets truthy/falsy as
   * "should I toggle?" — causing setViewPresentation({ flipHorizontal: false })
   * to be a no-op since false is falsy.
   */
  flipH(viewportId: string): void {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;

    const vp = viewport as any;
    try {
      vp.flip({ flipHorizontal: true });
    } catch (err) {
      console.error('[viewportService] flipH failed:', err);
    }
    viewport.render();
  },

  /**
   * Toggle vertical flip.
   * See flipH() for explanation of why we use flip() directly.
   */
  flipV(viewportId: string): void {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;

    const vp = viewport as any;
    try {
      vp.flip({ flipVertical: true });
    } catch (err) {
      console.error('[viewportService] flipV failed:', err);
    }
    viewport.render();
  },

  /**
   * Scroll to a specific image index.
   */
  scrollToIndex(viewportId: string, index: number): void {
    const engine = getEngine();
    if (!engine) return;
    const vp = (() => {
      try {
        return engine.getViewport(viewportId) as unknown as {
          getCurrentImageIdIndex?: () => number;
          getSliceIndex?: () => number;
          setImageIdIndex?: (i: number) => unknown;
          setSliceIndex?: (i: number) => unknown;
          scroll?: (delta: number) => void;
        };
      } catch {
        return null;
      }
    })();
    if (!vp) return;

    // Stack viewports prefer setImageIdIndex (synchronous + idempotent).
    // Volume viewports use setSliceIndex. Fall back to delta scroll() if
    // the index-based setter isn't available.
    if (typeof vp.setImageIdIndex === 'function') {
      vp.setImageIdIndex(index);
      return;
    }
    if (typeof vp.setSliceIndex === 'function') {
      vp.setSliceIndex(index);
      return;
    }
    const currentIndex =
      typeof vp.getCurrentImageIdIndex === 'function'
        ? vp.getCurrentImageIdIndex()
        : typeof vp.getSliceIndex === 'function'
          ? vp.getSliceIndex()
          : 0;
    const delta = index - (Number.isInteger(currentIndex) ? Number(currentIndex) : 0);
    if (delta !== 0 && typeof vp.scroll === 'function') {
      vp.scroll(delta);
    }
  },

  /**
   * Scroll by delta (used for cine playback).
   */
  scroll(viewportId: string, delta: number, loop: boolean = false): void {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;

    viewport.scroll(delta, false, loop);
  },

  /**
   * Get current zoom level as percentage (100 = fit-to-canvas).
   */
  getZoom(viewportId: string): number {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return 100;
    return Math.round(viewport.getZoom() * 100);
  },

  /**
   * Zoom by a relative factor (e.g., 1.2 to zoom in 20%, 0.8 to zoom out 20%).
   */
  zoomBy(viewportId: string, factor: number): void {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;
    const currentZoom = viewport.getZoom();
    viewport.setZoom(currentZoom * factor);
    viewport.render();
  },

  /**
   * Get current camera rotation in degrees.
   */
  getRotation(viewportId: string): number {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return 0;
    return (viewport as any).getRotation();
  },

  /**
   * Get current flip state.
   */
  getFlipState(viewportId: string): { flipH: boolean; flipV: boolean } {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return { flipH: false, flipV: false };
    // Read from the viewport's own instance properties (maintained by
    // setViewPresentation/flip), not getCamera() which may be stale.
    const vp = viewport as any;
    return {
      flipH: vp.flipHorizontal ?? false,
      flipV: vp.flipVertical ?? false,
    };
  },
};
