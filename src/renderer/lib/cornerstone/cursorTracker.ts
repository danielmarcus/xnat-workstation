/**
 * cursorTracker — mousemove → cursorMetricsStore bridge.
 * Spec §9.1 (`cursorHU`, `cursorCoords`).
 *
 * Listens on a viewport's DOM element. On mousemove:
 *   1. Convert offsetX/Y to a canvas point.
 *   2. `viewport.canvasToWorld(canvas)` → patient-space LPS coords.
 *   3. Best-effort HU sample at the world point via the modality LUT
 *      (`RescaleSlope` / `RescaleIntercept`) + the raw pixel value
 *      at the corresponding image pixel.
 *   4. Push `{canvasX, canvasY, world, hu, modality}` to
 *      `cursorMetricsStore`.
 *
 * On mouseleave the panel's store entry is cleared.
 *
 * Pure DOM listeners — no synthetic events, no React. Designed to be
 * attached from a `useEffect` hook keyed on `(panelId, element)`.
 */
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { metaData } from '@cornerstonejs/core';
import { useCursorMetricsStore, type CursorMetrics } from '../../stores/cursorMetricsStore';

/**
 * Convert a raw stored pixel value to a Hounsfield Unit (or signal
 * intensity) using the DICOM modality LUT.
 *
 *   real = slope * raw + intercept
 *
 * Defaults: slope = 1, intercept = 0 (identity, useful for non-CT
 * modalities that don't ship a modality LUT). Returns NaN when
 * `raw` is not finite.
 */
export function pixelToHU(raw: number, slope = 1, intercept = 0): number {
  if (!Number.isFinite(raw)) return NaN;
  return slope * raw + intercept;
}

/** Per-panel teardown registry so detach can find the right cleanup. */
const cleanups = new Map<string, () => void>();

/** Minimal viewport shape the tracker needs. Lets tests stub easily. */
export interface CursorTrackerViewport {
  canvasToWorld: (canvas: [number, number]) => number[] | { length: number; [i: number]: number };
  getCurrentImageId?: () => string;
  /** Optional best-effort raw sampler — implementations should return a number. */
  getRawPixelAtWorld?: (world: [number, number, number]) => number | null;
}

export interface AttachOptions {
  /** Modality string (e.g. "CT") propagated to the store. */
  modality?: string;
  /** Override the global metaData.get used for slope/intercept (tests). */
  getRescale?: (imageId: string) => { slope: number; intercept: number };
}

/**
 * Attach a mousemove/mouseleave listener pair to `element`. Returns
 * a cleanup function and registers it so `detach(panelId)` can find
 * it.
 */
export function attach(
  panelId: string,
  element: HTMLElement,
  viewport: CursorTrackerViewport,
  options: AttachOptions = {},
): () => void {
  const { modality = null, getRescale = defaultGetRescale } = options;
  const onMove = (e: MouseEvent) => {
    const rect = element.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    let world: [number, number, number] | null = null;
    try {
      const w = viewport.canvasToWorld([canvasX, canvasY]);
      if (w && (w as number[]).length >= 3) {
        world = [Number(w[0]), Number(w[1]), Number(w[2])];
      }
    } catch {
      world = null;
    }
    let hu: number | null = null;
    if (world && viewport.getRawPixelAtWorld) {
      const raw = viewport.getRawPixelAtWorld(world);
      if (raw != null && Number.isFinite(raw)) {
        const imageId = viewport.getCurrentImageId?.();
        const { slope, intercept } = imageId ? getRescale(imageId) : { slope: 1, intercept: 0 };
        hu = pixelToHU(raw, slope, intercept);
      }
    }
    const metrics: CursorMetrics = { canvasX, canvasY, world, hu, modality };
    useCursorMetricsStore.getState().set(panelId, metrics);
  };
  const onLeave = () => {
    useCursorMetricsStore.getState().clear(panelId);
  };
  element.addEventListener('mousemove', onMove);
  element.addEventListener('mouseleave', onLeave);

  const cleanup = () => {
    element.removeEventListener('mousemove', onMove);
    element.removeEventListener('mouseleave', onLeave);
    useCursorMetricsStore.getState().clear(panelId);
    cleanups.delete(panelId);
  };
  cleanups.set(panelId, cleanup);
  return cleanup;
}

/** Detach the listener pair (if any) registered for `panelId`. */
export function detach(panelId: string): void {
  cleanups.get(panelId)?.();
}

/** Test-only — clears every registered cleanup. */
export function __resetCursorTrackerForTests(): void {
  for (const cleanup of cleanups.values()) cleanup();
  cleanups.clear();
}

function defaultGetRescale(imageId: string): { slope: number; intercept: number } {
  try {
    const mod = metaData.get('imagePixelModule', imageId) as
      | { rescaleSlope?: number; rescaleIntercept?: number }
      | undefined;
    const slope = Number(mod?.rescaleSlope);
    const intercept = Number(mod?.rescaleIntercept);
    return {
      slope: Number.isFinite(slope) && slope !== 0 ? slope : 1,
      intercept: Number.isFinite(intercept) ? intercept : 0,
    };
  } catch {
    // wadouri may be lazy — fall back to identity.
    void wadouri;
    return { slope: 1, intercept: 0 };
  }
}
