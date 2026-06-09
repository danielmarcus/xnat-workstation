import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the cornerstone metadata provider + dataset cache (used by findNearestStackIndex).
const metaGet = vi.fn();
vi.mock('@cornerstonejs/core', () => ({ metaData: { get: (...a: unknown[]) => metaGet(...a) } }));
vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: { dataSetCacheManager: { isLoaded: () => false, get: () => null } },
}));

// Mock the viewport service so getViewport/scrollToIndex are controllable.
const getViewport = vi.fn();
const scrollToIndex = vi.fn();
vi.mock('./viewportService', () => ({
  viewportService: { getViewport: (id: string) => getViewport(id), scrollToIndex: (id: string, i: number) => scrollToIndex(id, i) },
}));

import {
  getWorldPointFromClientPoint,
  getPanelDisplayPointForWorld,
  findNearestStackIndex,
  wireCrosshairPointerHandlers,
  syncCrosshairToPanels,
  type Point3,
} from './unifiedCrosshair';

/** A 512×512 panel el (data-panel-id) with a non-Retina canvas (dpr scale 1). */
function mountPanel(panelId: string): HTMLDivElement {
  const div = document.createElement('div');
  div.setAttribute('data-panel-id', panelId);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  div.appendChild(canvas);
  document.body.appendChild(div);
  const rect = { left: 0, top: 0, right: 512, bottom: 512, width: 512, height: 512, x: 0, y: 0, toJSON() {} };
  div.getBoundingClientRect = () => rect as DOMRect;
  canvas.getBoundingClientRect = () => rect as DOMRect;
  Object.defineProperty(div, 'clientWidth', { value: 512, configurable: true });
  Object.defineProperty(div, 'clientHeight', { value: 512, configurable: true });
  return div;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('unifiedCrosshair geometry', () => {
  it('getWorldPointFromClientPoint maps a client point through canvasToWorld', () => {
    mountPanel('panel_0');
    getViewport.mockReturnValue({
      type: 'orthographic',
      canvasToWorld: (p: [number, number]) => [p[0] * 2, p[1] * 2, 5],
      worldToCanvas: (w: Point3) => [w[0], w[1]],
    });
    // dpr scale = 512/512 = 1 ⇒ canvas point = client point ⇒ world = [200, 100, 5].
    expect(getWorldPointFromClientPoint('panel_0', 100, 50)).toEqual([200, 100, 5]);
  });

  it('getPanelDisplayPointForWorld projects a world point back to the panel', () => {
    mountPanel('panel_0');
    getViewport.mockReturnValue({
      type: 'orthographic',
      canvasToWorld: (p: [number, number]) => [p[0], p[1], 0],
      worldToCanvas: (w: Point3) => [w[0], w[1]],
    });
    expect(getPanelDisplayPointForWorld('panel_0', [120, 240, 0])).toEqual({ x: 120, y: 240, width: 512, height: 512 });
  });

  it('getPanelDisplayPointForWorld returns null when the point projects off-panel', () => {
    mountPanel('panel_0');
    getViewport.mockReturnValue({ type: 'orthographic', worldToCanvas: () => [9999, 9999] });
    expect(getPanelDisplayPointForWorld('panel_0', [1, 2, 3])).toBeNull();
  });

  it('returns null when there is no viewport for the panel', () => {
    mountPanel('panel_0');
    getViewport.mockReturnValue(null);
    expect(getWorldPointFromClientPoint('panel_0', 10, 10)).toBeNull();
  });
});

describe('findNearestStackIndex', () => {
  it('picks the slice whose plane is closest to the world point along the normal', () => {
    // Axial stack: IOP = [1,0,0, 0,1,0] ⇒ normal = +z. IPP z = 0,5,10,15.
    const planes: Record<string, { imagePositionPatient: number[]; imageOrientationPatient: number[] }> = {
      a: { imagePositionPatient: [0, 0, 0], imageOrientationPatient: [1, 0, 0, 0, 1, 0] },
      b: { imagePositionPatient: [0, 0, 5], imageOrientationPatient: [1, 0, 0, 0, 1, 0] },
      c: { imagePositionPatient: [0, 0, 10], imageOrientationPatient: [1, 0, 0, 0, 1, 0] },
      d: { imagePositionPatient: [0, 0, 15], imageOrientationPatient: [1, 0, 0, 0, 1, 0] },
    };
    metaGet.mockImplementation((_mod: string, id: string) => planes[id]);
    // World z = 9 ⇒ nearest plane is c (z=10), index 2.
    expect(findNearestStackIndex(['a', 'b', 'c', 'd'], [0, 0, 9])).toBe(2);
    // World z = 1 ⇒ nearest is a (z=0), index 0.
    expect(findNearestStackIndex(['a', 'b', 'c', 'd'], [0, 0, 1])).toBe(0);
  });

  it('returns null for an empty stack', () => {
    expect(findNearestStackIndex([], [0, 0, 0])).toBeNull();
  });
});

describe('wireCrosshairPointerHandlers', () => {
  function dispatch(el: HTMLElement, type: string, clientX: number, clientY: number): void {
    el.dispatchEvent(new MouseEvent(type, { clientX, clientY, button: 0, bubbles: true }));
  }

  it('fires onWorldPoint for a CLICK (move <= 4px) but not a DRAG', () => {
    const el = mountPanel('panel_0');
    getViewport.mockReturnValue({
      type: 'orthographic',
      canvasToWorld: (p: [number, number]) => [p[0], p[1], 0],
      worldToCanvas: (w: Point3) => [w[0], w[1]],
    });
    const onWorldPoint = vi.fn();
    const dispose = wireCrosshairPointerHandlers({ element: el, panelId: 'panel_0', isCrosshairActive: () => true, onWorldPoint });

    // Click: down + up at the same point.
    dispatch(el, 'pointerdown', 100, 100);
    dispatch(el, 'pointerup', 101, 101);
    expect(onWorldPoint).toHaveBeenCalledTimes(1);
    // The point is set at the pointer-UP location (within the 4px click tolerance).
    expect(onWorldPoint).toHaveBeenCalledWith([101, 101, 0]);

    // Drag: down then up far away ⇒ no crosshair set (left to the W/L primary).
    onWorldPoint.mockClear();
    dispatch(el, 'pointerdown', 100, 100);
    dispatch(el, 'pointerup', 200, 200);
    expect(onWorldPoint).not.toHaveBeenCalled();

    dispose();
  });

  it('does nothing when the crosshair tool is inactive', () => {
    const el = mountPanel('panel_0');
    getViewport.mockReturnValue({ type: 'orthographic', canvasToWorld: () => [0, 0, 0], worldToCanvas: () => [0, 0] });
    const onWorldPoint = vi.fn();
    wireCrosshairPointerHandlers({ element: el, panelId: 'panel_0', isCrosshairActive: () => false, onWorldPoint });
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50, button: 0 }));
    el.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 50, button: 0 }));
    expect(onWorldPoint).not.toHaveBeenCalled();
  });
});

describe('syncCrosshairToPanels', () => {
  it('jumps volume panels to the world point and scrolls stack panels to the nearest slice', () => {
    const jumpToWorld = vi.fn();
    const render = vi.fn();
    const planes: Record<string, { imagePositionPatient: number[]; imageOrientationPatient: number[] }> = {
      s0: { imagePositionPatient: [0, 0, 0], imageOrientationPatient: [1, 0, 0, 0, 1, 0] },
      s1: { imagePositionPatient: [0, 0, 10], imageOrientationPatient: [1, 0, 0, 0, 1, 0] },
    };
    metaGet.mockImplementation((_mod: string, id: string) => planes[id]);
    getViewport.mockImplementation((id: string) => {
      if (id === 'panel_vol') return { type: 'orthographic', jumpToWorld, render };
      if (id === 'panel_stack') return { type: 'stack' };
      return null;
    });

    syncCrosshairToPanels('panel_src', [0, 0, 9], ['panel_src', 'panel_vol', 'panel_stack'], {
      panel_stack: ['s0', 's1'],
    });

    // Source panel is skipped; volume jumps; stack scrolls to nearest (z=10 ⇒ index 1).
    expect(jumpToWorld).toHaveBeenCalledWith([0, 0, 9]);
    expect(scrollToIndex).toHaveBeenCalledWith('panel_stack', 1);
  });
});
