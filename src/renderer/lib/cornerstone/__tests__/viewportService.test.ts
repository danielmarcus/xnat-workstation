import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCoreModuleMock,
  createCornerstoneMockState,
  createFakeStackViewport,
} from '../../../test/cornerstone/cornerstoneMocks';
import { resetCornerstoneMocks } from '../../../test/cornerstone/resetCornerstoneMocks';

const cs = createCornerstoneMockState();

let viewportService: (typeof import('../viewportService'))['viewportService'];

beforeAll(async () => {
  vi.doMock('@cornerstonejs/core', () => createCoreModuleMock(cs));

  ({ viewportService } = await import('../viewportService'));
});

describe('viewportService', () => {
  beforeEach(() => {
    resetCornerstoneMocks(cs);
    viewportService.destroyAllViewports();
  });

  afterEach(() => {
    viewportService.destroyAllViewports();
  });

  it('creates and destroys viewports while tracking attached elements', () => {
    const element = { dataset: {} } as unknown as HTMLDivElement;

    viewportService.createViewport('panel_0', element);

    expect(viewportService.getElement('panel_0')).toBe(element);
    const engine = cs.getOrCreateEngine('xnatRenderingEngine');
    expect(engine.enableElement).toHaveBeenCalledWith(
      expect.objectContaining({ viewportId: 'panel_0', type: 'STACK' }),
    );

    viewportService.destroyViewport('panel_0');
    expect(viewportService.getElement('panel_0')).toBeNull();
    expect(engine.disableElement).toHaveBeenCalledWith('panel_0');
  });

  it('scrollToIndex computes delta and avoids no-op scroll calls', () => {
    const viewport = createFakeStackViewport({
      getCurrentImageIdIndex: vi.fn(() => 5),
      scroll: vi.fn(),
    });
    cs.setViewport('panel_0', viewport);

    viewportService.scrollToIndex('panel_0', 8);
    expect(viewport.scroll).toHaveBeenCalledWith(3);

    viewport.scroll.mockClear();
    viewportService.scrollToIndex('panel_0', 5);
    expect(viewport.scroll).not.toHaveBeenCalled();
  });

  it('scroll delegates with loop flag and VOI uses lower/upper bounds', () => {
    const viewport = createFakeStackViewport({
      scroll: vi.fn(),
      setProperties: vi.fn(),
      render: vi.fn(),
    });
    cs.setViewport('panel_0', viewport);

    viewportService.scroll('panel_0', 2, true);
    expect(viewport.scroll).toHaveBeenCalledWith(2, false, true);

    viewportService.setVOI('panel_0', 400, 40);
    expect(viewport.setProperties).toHaveBeenCalledWith({ voiRange: { lower: -160, upper: 240 } });
    expect(viewport.render).toHaveBeenCalled();
  });

  it('zoomBy uses current zoom and updates viewport', () => {
    const viewport = createFakeStackViewport({
      getZoom: vi.fn(() => 1.25),
      setZoom: vi.fn(),
      render: vi.fn(),
    });
    cs.setViewport('panel_0', viewport);

    viewportService.zoomBy('panel_0', 1.2);

    expect(viewport.setZoom).toHaveBeenCalledWith(1.5);
    expect(viewport.render).toHaveBeenCalled();
  });

  it('loads stack, manipulates camera properties, and exposes getter helpers', async () => {
    const viewport = createFakeStackViewport({
      setStack: vi.fn(async () => undefined),
      resetCamera: vi.fn(),
      resetProperties: vi.fn(),
      setProperties: vi.fn(),
      render: vi.fn(),
      getZoom: vi.fn(() => 1.4),
      getRotation: vi.fn(() => 180),
      flip: vi.fn(),
      flipHorizontal: true,
      flipVertical: false,
    });
    cs.setViewport('panel_0', viewport);

    await viewportService.loadStack('panel_0', ['image-1', 'image-2']);
    expect(viewport.setStack).toHaveBeenCalledWith(['image-1', 'image-2']);

    viewportService.resetCamera('panel_0');
    expect(viewport.resetCamera).toHaveBeenCalled();
    expect(viewport.resetProperties).toHaveBeenCalled();

    viewportService.setInvert('panel_0', true);
    expect(viewport.setProperties).toHaveBeenCalledWith({ invert: true });

    viewportService.rotate90('panel_0');
    expect(viewport.setRotation).toHaveBeenCalledWith(270);

    viewportService.flipH('panel_0');
    viewportService.flipV('panel_0');
    expect(viewport.flip).toHaveBeenCalledWith({ flipHorizontal: true });
    expect(viewport.flip).toHaveBeenCalledWith({ flipVertical: true });

    expect(viewportService.getZoom('panel_0')).toBe(140);
    expect(viewportService.getRotation('panel_0')).toBe(180);
    expect(viewportService.getFlipState('panel_0')).toEqual({ flipH: true, flipV: false });
  });

  it('returns safe defaults and no-ops when viewport is missing', async () => {
    expect(viewportService.getViewport('missing')).toBeNull();
    expect(viewportService.getElement('missing')).toBeNull();
    expect(viewportService.getZoom('missing')).toBe(100);
    expect(viewportService.getRotation('missing')).toBe(0);
    expect(viewportService.getFlipState('missing')).toEqual({ flipH: false, flipV: false });

    await expect(viewportService.loadStack('missing', ['image-1'])).resolves.toBeUndefined();
    expect(() => viewportService.setVOI('missing', 100, 50)).not.toThrow();
    expect(() => viewportService.resetCamera('missing')).not.toThrow();
    expect(() => viewportService.setInvert('missing', true)).not.toThrow();
    expect(() => viewportService.rotate90('missing')).not.toThrow();
    expect(() => viewportService.flipH('missing')).not.toThrow();
    expect(() => viewportService.flipV('missing')).not.toThrow();
    expect(() => viewportService.scroll('missing', 1, true)).not.toThrow();
    expect(() => viewportService.zoomBy('missing', 1.1)).not.toThrow();
    expect(() => viewportService.resize()).not.toThrow();
  });
});
