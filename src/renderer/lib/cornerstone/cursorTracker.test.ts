import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the cornerstone modules cursorTracker imports — neither is
// reachable in jsdom.
vi.mock('@cornerstonejs/dicom-image-loader', () => ({ wadouri: {} }));
vi.mock('@cornerstonejs/core', () => ({ metaData: { get: vi.fn() } }));

import {
  attach,
  detach,
  pixelToHU,
  __resetCursorTrackerForTests,
  type CursorTrackerViewport,
} from './cursorTracker';
import { useCursorMetricsStore } from '../../stores/cursorMetricsStore';

function makeElement(): HTMLDivElement {
  const el = document.createElement('div');
  // Pin a rect so canvas-relative offsets are deterministic.
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      top: 100, left: 50, right: 250, bottom: 300,
      width: 200, height: 200, x: 50, y: 100, toJSON: () => ({}),
    }),
    configurable: true,
  });
  document.body.appendChild(el);
  return el;
}

function fireMove(el: HTMLElement, clientX: number, clientY: number) {
  const ev = new MouseEvent('mousemove', { clientX, clientY, bubbles: true });
  el.dispatchEvent(ev);
}

beforeEach(() => {
  useCursorMetricsStore.getState().clearAll();
});

afterEach(() => {
  __resetCursorTrackerForTests();
  document.body.innerHTML = '';
});

describe('pixelToHU', () => {
  it('applies slope * raw + intercept (CT default)', () => {
    expect(pixelToHU(0, 1, -1000)).toBe(-1000);
    expect(pixelToHU(1000, 1, -1000)).toBe(0);
    expect(pixelToHU(2000, 1, -1000)).toBe(1000);
  });

  it('non-1 slope (rare CT) and non-zero intercept', () => {
    expect(pixelToHU(100, 0.5, 50)).toBe(100);
  });

  it('defaults (slope=1, intercept=0) → identity', () => {
    expect(pixelToHU(47)).toBe(47);
  });

  it('NaN / non-finite input → NaN', () => {
    expect(pixelToHU(NaN)).toBeNaN();
    expect(pixelToHU(Infinity)).toBeNaN();
  });
});

describe('cursorTracker.attach', () => {
  it('mousemove writes {canvasX, canvasY, world, modality} to the store', () => {
    const el = makeElement();
    const viewport: CursorTrackerViewport = {
      canvasToWorld: ([cx, cy]) => [cx * 0.5, cy * 0.5, 1],
    };
    attach('panel_0', el, viewport, { modality: 'CT' });
    fireMove(el, 70, 110); // canvas (20, 10) → world (10, 5, 1)
    const m = useCursorMetricsStore.getState().metrics.panel_0!;
    expect(m.canvasX).toBe(20);
    expect(m.canvasY).toBe(10);
    expect(m.world).toEqual([10, 5, 1]);
    expect(m.hu).toBeNull();
    expect(m.modality).toBe('CT');
  });

  it('hu populated when viewport supplies a raw sampler + rescale info', () => {
    const el = makeElement();
    const viewport: CursorTrackerViewport = {
      canvasToWorld: () => [0, 0, 0],
      getRawPixelAtWorld: () => 1500, // raw CT density
      getCurrentImageId: () => 'wadouri:test-image-1',
    };
    attach('panel_0', el, viewport, {
      modality: 'CT',
      getRescale: () => ({ slope: 1, intercept: -1000 }),
    });
    fireMove(el, 100, 200);
    // 1500 * 1 + (-1000) = 500.
    expect(useCursorMetricsStore.getState().metrics.panel_0!.hu).toBe(500);
  });

  it('mouseleave clears the panel\'s store entry', () => {
    const el = makeElement();
    const viewport: CursorTrackerViewport = {
      canvasToWorld: () => [0, 0, 0],
    };
    attach('panel_0', el, viewport);
    fireMove(el, 60, 110);
    expect(useCursorMetricsStore.getState().metrics.panel_0).toBeDefined();
    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(useCursorMetricsStore.getState().metrics.panel_0).toBeUndefined();
  });

  it('canvasToWorld throw is swallowed; world becomes null but metrics still record cursor pos', () => {
    const el = makeElement();
    const viewport: CursorTrackerViewport = {
      canvasToWorld: () => { throw new Error('not ready'); },
    };
    attach('panel_0', el, viewport);
    fireMove(el, 60, 110);
    const m = useCursorMetricsStore.getState().metrics.panel_0!;
    expect(m.world).toBeNull();
    expect(m.canvasX).toBe(10);
  });

  it('detach removes listeners and clears the entry', () => {
    const el = makeElement();
    const viewport: CursorTrackerViewport = {
      canvasToWorld: () => [1, 2, 3],
    };
    attach('panel_0', el, viewport);
    fireMove(el, 60, 110);
    expect(useCursorMetricsStore.getState().metrics.panel_0).toBeDefined();
    detach('panel_0');
    expect(useCursorMetricsStore.getState().metrics.panel_0).toBeUndefined();
    // Further moves don't re-populate.
    fireMove(el, 200, 200);
    expect(useCursorMetricsStore.getState().metrics.panel_0).toBeUndefined();
  });

  it('multiple panels are tracked independently', () => {
    const a = makeElement();
    const b = makeElement();
    const vpA: CursorTrackerViewport = { canvasToWorld: () => [1, 1, 1] };
    const vpB: CursorTrackerViewport = { canvasToWorld: () => [2, 2, 2] };
    attach('panel_0', a, vpA, { modality: 'CT' });
    attach('panel_1', b, vpB, { modality: 'MR' });
    fireMove(a, 60, 110);
    fireMove(b, 60, 110);
    expect(useCursorMetricsStore.getState().metrics.panel_0!.world).toEqual([1, 1, 1]);
    expect(useCursorMetricsStore.getState().metrics.panel_1!.world).toEqual([2, 2, 2]);
    expect(useCursorMetricsStore.getState().metrics.panel_0!.modality).toBe('CT');
    expect(useCursorMetricsStore.getState().metrics.panel_1!.modality).toBe('MR');
  });
});
