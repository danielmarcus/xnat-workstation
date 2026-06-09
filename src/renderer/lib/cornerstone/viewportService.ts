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
  imageLoader,
  Enums,
  type Types,
} from '@cornerstonejs/core';
import type { MPRPlane, ViewportOrientation } from '@shared/types/viewer';
import { volumeService } from './volumeService';
import { metadataService } from './metadataService';
import { chooseViewportType, type ViewportType, type ViewportTypeInput } from './viewportType';

const ENGINE_ID = 'xnatRenderingEngine';

/**
 * Resolve the plane a freshly-created viewport should open in. A viewport is
 * (re)created only on mount or a SCAN change, so the initial plane must reflect the
 * scan being loaded — never a stale selection carried over from a previous scan:
 *  - a non-MPR panel (single / generic grid) ALWAYS opens in the new scan's NATIVE
 *    acquisition plane (a sagittal scan opens sagittal, an axial scan opens axial),
 *    regardless of what the previous scan was showing;
 *  - an MPR-preset panel uses its designated (explicit/layout) plane.
 * A user's per-panel override (the orientation dropdown) is applied AFTER creation
 * via setOrientation — NOT here — so it never leaks into the next scan loaded.
 * Pure + exported for unit testing.
 */
export function resolveInitialPlane(opts: {
  explicit?: MPRPlane;
  preferNative: boolean;
  layoutPlane: MPRPlane;
  nativePlane: ViewportOrientation;
}): MPRPlane {
  if (opts.preferNative) return opts.nativePlane !== 'STACK' ? opts.nativePlane : opts.layoutPlane;
  return opts.explicit ?? opts.layoutPlane;
}

/**
 * Map an MPR plane → Cornerstone OrientationAxis. Read lazily (at call time, not
 * module load) so the module imports cleanly even where Enums.OrientationAxis is
 * absent (e.g. the unit-test core mock); only the volume path ever calls it.
 */
function planeOrientation(plane: MPRPlane): Enums.OrientationAxis {
  const { OrientationAxis } = Enums;
  const map: Record<MPRPlane, Enums.OrientationAxis> = {
    AXIAL: OrientationAxis.AXIAL,
    SAGITTAL: OrientationAxis.SAGITTAL,
    CORONAL: OrientationAxis.CORONAL,
  };
  return map[plane];
}

/** Track which elements are associated with which viewport IDs */
const elements = new Map<string, HTMLDivElement>();
/** Track the shared volumeId each unified volume viewport holds (for release). */
const viewportVolumes = new Map<string, string>();

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
   * Unified viewport creation (Phase 1). Chooses STACK vs volume ORTHOGRAPHIC
   * from the data (chooseViewportType); for volumes it acquires a SHARED,
   * ref-counted ImageVolume keyed by (scanId, FoR) so panels of the same scan
   * reuse one volume (design §1.1, §1.5). Returns the chosen type + the volumeId
   * (null for stack). Pair with destroyUnifiedViewport() to release the volume.
   */
  async createUnifiedViewport(
    viewportId: string,
    element: HTMLDivElement,
    opts: {
      scanId: string;
      frameOfReferenceUID: string;
      imageIds: string[];
      meta?: ViewportTypeInput;
      /** Explicit plane request (e.g. a user's dropdown choice). Wins over native. */
      orientation?: MPRPlane;
      /** The layout's designated plane (MPR preset / fallback). */
      layoutOrientation?: MPRPlane;
      /** Non-MPR panels open in the scan's native plane unless `orientation` is set. */
      preferNativeOrientation?: boolean;
    },
  ): Promise<{ type: ViewportType; volumeId: string | null; orientation: MPRPlane }> {
    const engine = ensureEngine();
    if (elements.has(viewportId)) {
      try { engine.disableElement(viewportId); } catch { /* ok */ }
    }
    // Release any prior shared volume this panel held before recreating.
    const prevVolume = viewportVolumes.get(viewportId);
    if (prevVolume) {
      volumeService.release(prevVolume);
      viewportVolumes.delete(viewportId);
    }
    elements.set(viewportId, element);

    const meta = opts.meta ?? { imageCount: opts.imageIds.length };
    const type = chooseViewportType(meta);

    const layoutPlane = opts.layoutOrientation ?? 'AXIAL';
    const preferNative = opts.preferNativeOrientation ?? false;

    if (type === 'stack') {
      engine.enableElement({ viewportId, type: Enums.ViewportType.STACK, element });
      const vp = engine.getViewport(viewportId) as Types.IStackViewport;
      await vp.setStack(opts.imageIds);
      vp.render();
      // Stacks display their native plane and can't reformat; report the resolved
      // plane only so the overlay label is sensible (the dropdown is disabled).
      const resolvedPlane = resolveInitialPlane({
        explicit: opts.orientation,
        preferNative,
        layoutPlane,
        nativePlane: metadataService.getNativeOrientation(opts.imageIds[0]),
      });
      console.log('[viewportService] Unified viewport (stack):', viewportId);
      return { type, volumeId: null, orientation: resolvedPlane };
    }

    // Volume path — shared + ref-counted by (scanId, FoR).
    // createAndCacheVolume needs per-image metadata (pixelRepresentation, rows,
    // cols, spacing) up front. For local (in-memory) files nothing pre-fetches
    // it, so register it by loading each image first; soft-fail per image.
    // (For large XNAT series this should become a metadata-only prefetch.)
    // Done BEFORE enableElement so the native plane is known and the viewport is
    // created already oriented — no axial→native flip on load.
    await Promise.all(
      opts.imageIds.map((id) => imageLoader.loadAndCacheImage(id).catch(() => undefined)),
    );
    const resolvedPlane = resolveInitialPlane({
      explicit: opts.orientation,
      preferNative,
      layoutPlane,
      nativePlane: metadataService.getNativeOrientation(opts.imageIds[0]),
    });
    engine.enableElement({
      viewportId,
      type: Enums.ViewportType.ORTHOGRAPHIC,
      element,
      defaultOptions: { orientation: planeOrientation(resolvedPlane) },
    });
    const { volumeId, created } = await volumeService.acquire(
      opts.scanId,
      opts.frameOfReferenceUID,
      opts.imageIds,
    );
    viewportVolumes.set(viewportId, volumeId);
    const vp = engine.getViewport(viewportId) as Types.IVolumeViewport;
    await vp.setVolumes([{ volumeId }]);
    vp.render();
    if (created) {
      // Progressive background load — soft-fail (never throw on the render path).
      volumeService
        .load(volumeId)
        .catch((err) => console.warn('[viewportService] Volume load failed:', volumeId, err));
    }
    console.log('[viewportService] Unified viewport (volume):', viewportId, volumeId, resolvedPlane);
    return { type, volumeId, orientation: resolvedPlane };
  },

  /**
   * Destroy a unified viewport and release its shared-volume hold (if any), so
   * the volume is freed when the last viewport using it closes.
   */
  destroyUnifiedViewport(viewportId: string): void {
    const engine = getEngine();
    if (engine) {
      try { engine.disableElement(viewportId); } catch { /* ok */ }
    }
    elements.delete(viewportId);
    const volumeId = viewportVolumes.get(viewportId);
    if (volumeId) {
      volumeService.release(volumeId);
      viewportVolumes.delete(viewportId);
    }
    console.log('[viewportService] Unified viewport destroyed:', viewportId);
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
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;

    const currentIndex = viewport.getCurrentImageIdIndex();
    const delta = index - currentIndex;
    if (delta !== 0) {
      viewport.scroll(delta);
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
   * Scroll to an ABSOLUTE slice index — type-aware (drives the slice scrollbar).
   * STACK diffs against getCurrentImageIdIndex (the native index); VOLUME /
   * ORTHOGRAPHIC diffs against getSliceIndex (the REFORMATTED axis — never
   * getCurrentImageIdIndex, which is the native source index → the "257/21"
   * axis-mixing bug). Both then scroll by the clamped delta. Soft (no throw).
   */
  scrollToSlice(viewportId: string, index: number): void {
    const engine = getEngine();
    if (!engine) return;
    let vp: any;
    try {
      vp = engine.getViewport(viewportId);
    } catch {
      return;
    }
    if (!vp || typeof vp.scroll !== 'function') return;
    const isStack = vp.type === Enums.ViewportType.STACK;
    const current = isStack ? (vp.getCurrentImageIdIndex?.() ?? 0) : (vp.getSliceIndex?.() ?? 0);
    const total = isStack ? (vp.getImageIds?.().length ?? 0) : (vp.getNumberOfSlices?.() ?? 0);
    if (total <= 0) return;
    const target = Math.max(0, Math.min(total - 1, Math.round(index)));
    const delta = target - current;
    if (delta !== 0) {
      try {
        vp.scroll(delta);
      } catch (err) {
        console.warn('[viewportService] scrollToSlice failed:', viewportId, err);
      }
    }
  },

  /**
   * Reorient a VOLUME viewport in place (axial ⇄ sagittal ⇄ coronal) — drives the
   * orientation selector. Uses VolumeViewport.setOrientation, which reformats the
   * camera without reloading the (shared, ref-counted) volume. No-op on STACK
   * viewports (they have no setOrientation — a single-plane stack can't reformat)
   * and before the viewport exists. Soft (no throw).
   */
  setOrientation(viewportId: string, plane: MPRPlane): void {
    const engine = getEngine();
    if (!engine) return;
    let vp: any;
    try {
      vp = engine.getViewport(viewportId);
    } catch {
      return;
    }
    if (!vp || typeof vp.setOrientation !== 'function') return;
    try {
      vp.setOrientation(planeOrientation(plane));
      vp.render?.();
    } catch (err) {
      console.warn('[viewportService] setOrientation failed:', viewportId, err);
    }
  },

  /**
   * Millimetres per on-screen CSS pixel for a viewport — the TRUE display scale,
   * read from the camera (not reconstructed). `camera.parallelScale` is half the
   * viewport's visible world-height (mm); display pixels are square, so
   * mm/CSS-px = 2·parallelScale / element.clientHeight in both axes. Accounts for
   * zoom (parallelScale shrinks as you zoom in). No DPR involved — clientHeight is
   * CSS px, which is also the unit the ruler is drawn in. Returns null if unknown.
   */
  getMmPerDisplayPixel(viewportId: string): number | null {
    const engine = getEngine();
    if (!engine) return null;
    let vp: any;
    try {
      vp = engine.getViewport(viewportId);
    } catch {
      return null;
    }
    if (!vp || typeof vp.getCamera !== 'function') return null;
    const height = elements.get(viewportId)?.clientHeight ?? 0;
    if (height <= 0) return null;
    const parallelScale = vp.getCamera()?.parallelScale;
    if (!Number.isFinite(parallelScale) || parallelScale <= 0) return null;
    return (2 * parallelScale) / height;
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
   * Read a plain snapshot of the current viewport display state — image index /
   * total, zoom %, window/level, image dimensions, current imageId — for BOTH
   * stack and volume (ORTHOGRAPHIC) viewports.
   *
   * CRITICAL: stack-vs-volume is decided by `viewport.type`, NOT by which methods
   * exist. v4 VOLUME viewports expose BOTH getSliceIndex/getNumberOfSlices (the
   * reformatted axis) AND getCurrentImageIdIndex/getImageIds (the NATIVE source
   * count). Reading the stack API on a volume mixed the two axes → the "257/21"
   * bug (reformatted index over native count). So: STACK → stack API; everything
   * else → volume API, with the current imageId taken from the volume's source
   * list (series-level metadata is constant across the reformat).
   * Returns plain data (no Cornerstone objects); all reads are soft.
   */
  readViewportState(viewportId: string): {
    imageIndex: number;
    total: number;
    zoom: number;
    ww: number | null;
    wc: number | null;
    width: number | null;
    height: number | null;
    currentImageId: string | null;
  } | null {
    const engine = getEngine();
    if (!engine) return null;
    let vp: any;
    try {
      vp = engine.getViewport(viewportId);
    } catch {
      return null;
    }
    if (!vp) return null;

    const isStack = vp.type === Enums.ViewportType.STACK;
    let imageIndex = 0;
    let total = 0;
    let currentImageId: string | null = null;
    try {
      if (isStack) {
        imageIndex = vp.getCurrentImageIdIndex?.() ?? 0;
        total = vp.getImageIds?.().length ?? 0;
        currentImageId = vp.getCurrentImageId?.() ?? null;
      } else {
        // Volume / ORTHOGRAPHIC: slice index + count come from the REFORMATTED
        // axis, never from getImageIds().length (the native source count).
        imageIndex = vp.getSliceIndex?.() ?? 0;
        total = vp.getNumberOfSlices?.() ?? 0;
        // Series-level metadata is constant across the reformat; use any source id.
        const ids: string[] = vp.getImageIds?.() ?? [];
        currentImageId = ids[0] ?? null;
      }
    } catch {
      /* soft */
    }

    let ww: number | null = null;
    let wc: number | null = null;
    try {
      const props = vp.getProperties?.();
      if (props?.voiRange) {
        ww = props.voiRange.upper - props.voiRange.lower;
        wc = props.voiRange.lower + ww / 2;
      }
    } catch {
      /* soft */
    }

    let zoom = 100;
    try {
      if (typeof vp.getZoom === 'function') zoom = Math.round(vp.getZoom() * 100);
    } catch {
      /* soft */
    }

    let width: number | null = null;
    let height: number | null = null;
    try {
      const imageData = vp.getImageData?.();
      if (imageData?.dimensions) {
        width = imageData.dimensions[0] ?? null;
        height = imageData.dimensions[1] ?? null;
      }
    } catch {
      /* soft */
    }

    return { imageIndex, total, zoom, ww, wc, width, height, currentImageId };
  },

  /**
   * Subscribe to the Cornerstone display events that change viewport readouts and
   * invoke `onChange(kind)` so the caller can re-read state + push to the stores.
   * Returns a dispose fn. Events absent in a given build (e.g. VOLUME_NEW_IMAGE
   * in a test mock) are filtered out, so this is safe everywhere.
   */
  subscribeViewportEvents(
    viewportId: string,
    element: HTMLElement,
    onChange: (kind: 'voi' | 'image' | 'camera') => void,
  ): () => void {
    const Events = Enums.Events;
    const bindings: Array<{ type: string; kind: 'voi' | 'image' | 'camera' }> = [
      { type: Events.VOI_MODIFIED, kind: 'voi' as const },
      { type: Events.STACK_NEW_IMAGE, kind: 'image' as const },
      { type: (Events as Record<string, string>).VOLUME_NEW_IMAGE, kind: 'image' as const },
      { type: Events.CAMERA_MODIFIED, kind: 'camera' as const },
    ].filter((b) => typeof b.type === 'string');

    const listeners = bindings.map((b) => {
      const handler = (() => {
        try {
          onChange(b.kind);
        } catch (err) {
          console.warn('[viewportService] state-sync handler error:', viewportId, err);
        }
      }) as EventListener;
      element.addEventListener(b.type, handler);
      return { type: b.type, handler };
    });

    return () => {
      for (const l of listeners) element.removeEventListener(l.type, l.handler);
    };
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
