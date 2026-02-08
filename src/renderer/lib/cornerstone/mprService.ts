/**
 * MPR Service — manages ORTHOGRAPHIC volume viewports for multiplanar
 * reconstruction. Mirrors the viewportService pattern but for volume
 * (MPR) viewports.
 *
 * All MPR viewports share the same RenderingEngine as stack viewports
 * (from viewportService.ENGINE_ID). Each viewport is assigned a fixed
 * orientation (Axial, Sagittal, or Coronal).
 */
import {
  getRenderingEngine,
  Enums,
  type Types,
} from '@cornerstonejs/core';
import { viewportService } from './viewportService';
import type { MPRPlane } from '@shared/types/viewer';

const { ViewportType, OrientationAxis } = Enums;

/** Map MPRPlane string to Cornerstone OrientationAxis */
const PLANE_TO_ORIENTATION: Record<MPRPlane, Enums.OrientationAxis> = {
  AXIAL: OrientationAxis.AXIAL,
  SAGITTAL: OrientationAxis.SAGITTAL,
  CORONAL: OrientationAxis.CORONAL,
};

/** Track which elements are associated with MPR viewport IDs */
const elements = new Map<string, HTMLDivElement>();

function getVolumeViewport(viewportId: string): Types.IVolumeViewport | null {
  const engine = getRenderingEngine(viewportService.ENGINE_ID);
  if (!engine) return null;
  try {
    return engine.getViewport(viewportId) as Types.IVolumeViewport;
  } catch {
    return null;
  }
}

export const mprService = {
  /**
   * Create an ORTHOGRAPHIC viewport for a given MPR plane.
   * Reuses the existing RenderingEngine from viewportService.
   */
  createViewport(viewportId: string, element: HTMLDivElement, plane: MPRPlane): void {
    const engine = getRenderingEngine(viewportService.ENGINE_ID);
    if (!engine) {
      console.error('[mprService] RenderingEngine not found');
      return;
    }

    // Disable any existing viewport with this ID
    if (elements.has(viewportId)) {
      try { engine.disableElement(viewportId); } catch { /* ok */ }
    }

    elements.set(viewportId, element);

    const viewportInput: Types.PublicViewportInput = {
      viewportId,
      type: ViewportType.ORTHOGRAPHIC,
      element,
      defaultOptions: {
        orientation: PLANE_TO_ORIENTATION[plane],
      },
    };
    engine.enableElement(viewportInput);

    console.log(`[mprService] Viewport created: ${viewportId} (${plane})`);
  },

  /**
   * Set a volume on an MPR viewport.
   * The volume must already be created via volumeService.
   */
  async setVolume(viewportId: string, volumeId: string): Promise<void> {
    const viewport = getVolumeViewport(viewportId);
    if (!viewport) {
      console.error('[mprService] No viewport to set volume on:', viewportId);
      return;
    }

    await viewport.setVolumes([{ volumeId }]);
    viewport.render();
    console.log(`[mprService] Volume set on ${viewportId}: ${volumeId}`);
  },

  /**
   * Destroy a single MPR viewport.
   */
  destroyViewport(viewportId: string): void {
    const engine = getRenderingEngine(viewportService.ENGINE_ID);
    if (engine) {
      try { engine.disableElement(viewportId); } catch { /* ok */ }
    }
    elements.delete(viewportId);
    console.log('[mprService] Viewport destroyed:', viewportId);
  },

  /**
   * Get a volume viewport by ID.
   */
  getViewport(viewportId: string): Types.IVolumeViewport | null {
    return getVolumeViewport(viewportId);
  },

  /**
   * Get the DOM element for an MPR viewport.
   */
  getElement(viewportId: string): HTMLDivElement | null {
    return elements.get(viewportId) ?? null;
  },

  // ─── Manipulation Methods ──────────────────────────────────────

  /**
   * Set window/level (VOI) on a volume viewport.
   */
  setVOI(viewportId: string, windowWidth: number, windowCenter: number): void {
    const viewport = getVolumeViewport(viewportId);
    if (!viewport) return;

    const lower = windowCenter - windowWidth / 2;
    const upper = windowCenter + windowWidth / 2;
    viewport.setProperties({ voiRange: { lower, upper } });
    viewport.render();
  },

  /**
   * Reset camera to default orientation and fit to canvas.
   */
  resetCamera(viewportId: string): void {
    const viewport = getVolumeViewport(viewportId);
    if (!viewport) return;

    viewport.resetCamera();
    viewport.render();
  },

  /**
   * Scroll by delta slices in a volume viewport.
   */
  scroll(viewportId: string, delta: number): void {
    const viewport = getVolumeViewport(viewportId);
    if (!viewport) return;

    viewport.scroll(delta);
  },

  /**
   * Scroll to a specific slice index in a volume viewport.
   */
  scrollToIndex(viewportId: string, index: number): void {
    const viewport = getVolumeViewport(viewportId);
    if (!viewport) return;

    const currentIndex = viewport.getSliceIndex();
    const delta = index - currentIndex;
    if (delta !== 0) {
      viewport.scroll(delta);
    }
  },

  /**
   * Get current slice index and total slice count for a volume viewport.
   * Used by the scroll slider and overlay.
   */
  getSliceInfo(viewportId: string): { sliceIndex: number; totalSlices: number } {
    const viewport = getVolumeViewport(viewportId);
    if (!viewport) return { sliceIndex: 0, totalSlices: 0 };

    return {
      sliceIndex: viewport.getSliceIndex(),
      totalSlices: viewport.getNumberOfSlices(),
    };
  },

  /**
   * Get current zoom level as percentage.
   */
  getZoom(viewportId: string): number {
    const viewport = getVolumeViewport(viewportId);
    if (!viewport) return 100;
    return Math.round(viewport.getZoom() * 100);
  },

  /**
   * Set inversion on a volume viewport.
   */
  setInvert(viewportId: string, invert: boolean): void {
    const viewport = getVolumeViewport(viewportId);
    if (!viewport) return;

    viewport.setProperties({ invert });
    viewport.render();
  },
};
