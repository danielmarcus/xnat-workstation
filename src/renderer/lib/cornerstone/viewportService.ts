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
   * Toggle horizontal flip via setViewPresentation.
   */
  flipH(viewportId: string): void {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;

    const vp = viewport as any;
    const current = vp.flipHorizontal ?? false;

    try {
      if (typeof vp.setViewPresentation === 'function') {
        vp.setViewPresentation({ flipHorizontal: !current });
      } else if (typeof vp.flip === 'function') {
        vp.flip({ flipHorizontal: true });
      }
    } catch (err) {
      console.error('[viewportService] flipH failed:', err);
    }
    viewport.render();
  },

  /**
   * Toggle vertical flip via setViewPresentation.
   */
  flipV(viewportId: string): void {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return;

    const vp = viewport as any;
    const current = vp.flipVertical ?? false;

    try {
      if (typeof vp.setViewPresentation === 'function') {
        vp.setViewPresentation({ flipVertical: !current });
      } else if (typeof vp.flip === 'function') {
        vp.flip({ flipVertical: true });
      }
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
   * Get current zoom level as percentage (100 = fit-to-canvas).
   */
  getZoom(viewportId: string): number {
    const viewport = getStackViewport(viewportId);
    if (!viewport) return 100;
    return Math.round(viewport.getZoom() * 100);
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
    const camera = viewport.getCamera();
    return {
      flipH: camera.flipHorizontal ?? false,
      flipV: camera.flipVertical ?? false,
    };
  },
};
