// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const geometryMocks = vi.hoisted(() => ({
  getVolumeViewport: vi.fn(),
  getStackViewport: vi.fn(),
}));

vi.mock('../viewportService', () => ({
  viewportService: {
    getViewport: geometryMocks.getStackViewport,
    getVolumeViewport: geometryMocks.getVolumeViewport,
  },
}));

import {
  getPanelDisplayPointForWorld,
  getViewportForPanel,
  getWorldPointFromClientPoint,
  wireCrosshairPointerHandlers,
} from '../crosshairGeometry';

function makePanel(panelId: string): HTMLElement {
  const panel = document.createElement('div');
  panel.setAttribute('data-panel-id', panelId);
  Object.defineProperty(panel, 'clientWidth', { value: 200, configurable: true });
  Object.defineProperty(panel, 'clientHeight', { value: 120, configurable: true });
  panel.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      width: 200,
      height: 120,
      right: 210,
      bottom: 140,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(panel);
  return panel;
}

function dispatchPointer(
  el: HTMLElement,
  type: string,
  overrides: Partial<Record<string, unknown>> = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
  Object.assign(event, {
    pointerId: 1,
    clientX: 40,
    clientY: 60,
    button: 0,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  });
  el.dispatchEvent(event);
  return event;
}

describe('crosshairGeometry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('prefers volume viewport (oriented MPR panel) and falls back to stack viewport', () => {
    const volumeViewport = { canvasToWorld: vi.fn(), worldToCanvas: vi.fn() };
    const stackViewport = { canvasToWorld: vi.fn(), worldToCanvas: vi.fn() };

    geometryMocks.getVolumeViewport.mockReturnValue(volumeViewport);
    geometryMocks.getStackViewport.mockReturnValue(stackViewport);
    expect(getViewportForPanel('panel_0')).toBe(volumeViewport);

    geometryMocks.getVolumeViewport.mockReturnValue(null);
    expect(getViewportForPanel('panel_0')).toBe(stackViewport);
  });

  it('maps client points to world points and world points to panel display coordinates', () => {
    makePanel('panel_0');
    const viewport = {
      canvasToWorld: vi.fn(([x, y]: [number, number]) => [x + 1, y + 2, 3]),
      worldToCanvas: vi.fn(([x, y]: [number, number, number]) => [x * 2, y * 2]),
    };
    geometryMocks.getVolumeViewport.mockReturnValue(viewport);
    geometryMocks.getStackViewport.mockReturnValue(null);

    expect(getWorldPointFromClientPoint('panel_0', 30, 50)).toEqual([21, 32, 3]);

    expect(getPanelDisplayPointForWorld('panel_0', [5, 6, 7])).toEqual({
      x: 10,
      y: 12,
      width: 200,
      height: 120,
    });
  });

  it('returns null for missing panel/viewport and out-of-bounds world projections', () => {
    geometryMocks.getVolumeViewport.mockReturnValue(null);
    geometryMocks.getStackViewport.mockReturnValue(null);
    expect(getWorldPointFromClientPoint('missing', 10, 20)).toBeNull();

    makePanel('panel_1');
    geometryMocks.getVolumeViewport.mockReturnValue({
      canvasToWorld: vi.fn(() => [1, 2, 3]),
      worldToCanvas: vi.fn(() => [999, 999]),
    });
    expect(getPanelDisplayPointForWorld('panel_1', [1, 2, 3])).toBeNull();
  });

  it('wires pointer handlers and cleans up listeners on dispose', () => {
    const panel = makePanel('panel_2');
    const viewport = {
      canvasToWorld: vi.fn(([x, y]: [number, number]) => [x, y, 1]),
      worldToCanvas: vi.fn(([x, y]: [number, number, number]) => [x, y]),
    };
    geometryMocks.getVolumeViewport.mockReturnValue(viewport);
    geometryMocks.getStackViewport.mockReturnValue(null);

    const onWorldPoint = vi.fn();
    const dispose = wireCrosshairPointerHandlers({
      element: panel,
      panelId: 'panel_2',
      isCrosshairActive: () => true,
      onWorldPoint,
    });

    dispatchPointer(panel, 'pointermove', { shiftKey: true, clientX: 20, clientY: 30 });
    expect(onWorldPoint).toHaveBeenCalledWith([10, 10, 1]);

    onWorldPoint.mockClear();
    dispatchPointer(panel, 'pointerdown', { pointerId: 7, clientX: 24, clientY: 36 });
    dispatchPointer(panel, 'pointerup', { pointerId: 7, clientX: 26, clientY: 37 });
    expect(onWorldPoint).toHaveBeenCalledTimes(1);

    onWorldPoint.mockClear();
    dispatchPointer(panel, 'pointerdown', { pointerId: 8, clientX: 24, clientY: 36 });
    dispatchPointer(panel, 'pointerup', { pointerId: 8, clientX: 40, clientY: 60 });
    expect(onWorldPoint).not.toHaveBeenCalled();

    dispose();
    dispatchPointer(panel, 'pointermove', { shiftKey: true, clientX: 22, clientY: 33 });
    expect(onWorldPoint).not.toHaveBeenCalled();
  });
});
