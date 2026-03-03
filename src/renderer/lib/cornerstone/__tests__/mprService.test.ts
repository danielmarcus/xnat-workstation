import { beforeEach, describe, expect, it, vi } from 'vitest';

const mprMocks = vi.hoisted(() => {
  const viewportMap = new Map<string, any>();
  const engine = {
    enableElement: vi.fn(),
    disableElement: vi.fn((viewportId: string) => {
      viewportMap.delete(viewportId);
    }),
    getViewport: vi.fn((viewportId: string) => {
      if (!viewportMap.has(viewportId)) {
        throw new Error(`missing viewport ${viewportId}`);
      }
      return viewportMap.get(viewportId);
    }),
  };

  return {
    viewportMap,
    engine,
    getRenderingEngine: vi.fn(() => engine),
  };
});

vi.mock('@cornerstonejs/core', () => ({
  getRenderingEngine: mprMocks.getRenderingEngine,
  Enums: {
    ViewportType: { ORTHOGRAPHIC: 'ORTHOGRAPHIC' },
    OrientationAxis: {
      AXIAL: 'AXIAL',
      SAGITTAL: 'SAGITTAL',
      CORONAL: 'CORONAL',
    },
  },
}));

vi.mock('../viewportService', () => ({
  viewportService: {
    ENGINE_ID: 'xnatRenderingEngine',
  },
}));

import { mprService } from '../mprService';

function makeViewport(overrides: Partial<any> = {}): any {
  return {
    setVolumes: vi.fn(async () => undefined),
    render: vi.fn(),
    setProperties: vi.fn(),
    resetCamera: vi.fn(),
    scroll: vi.fn(),
    getSliceIndex: vi.fn(() => 5),
    getNumberOfSlices: vi.fn(() => 20),
    getZoom: vi.fn(() => 1.4),
    ...overrides,
  };
}

describe('mprService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mprMocks.viewportMap.clear();
    mprMocks.getRenderingEngine.mockReturnValue(mprMocks.engine);
  });

  it('creates and destroys orthographic viewports with plane orientation mapping', () => {
    const el = { dataset: {} } as unknown as HTMLDivElement;

    mprService.createViewport('mpr_axial', el, 'AXIAL');
    mprService.createViewport('mpr_sagittal', el, 'SAGITTAL');
    mprService.createViewport('mpr_coronal', el, 'CORONAL');

    expect(mprMocks.engine.enableElement).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        viewportId: 'mpr_axial',
        type: 'ORTHOGRAPHIC',
        defaultOptions: { orientation: 'AXIAL' },
      }),
    );
    expect(mprMocks.engine.enableElement).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        viewportId: 'mpr_sagittal',
        defaultOptions: { orientation: 'SAGITTAL' },
      }),
    );
    expect(mprMocks.engine.enableElement).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        viewportId: 'mpr_coronal',
        defaultOptions: { orientation: 'CORONAL' },
      }),
    );

    expect(mprService.getElement('mpr_axial')).toBe(el);
    mprService.destroyViewport('mpr_axial');
    expect(mprMocks.engine.disableElement).toHaveBeenCalledWith('mpr_axial');
    expect(mprService.getElement('mpr_axial')).toBeNull();
  });

  it('sets volume and core viewport manipulation methods for existing viewports', async () => {
    const viewport = makeViewport();
    mprMocks.viewportMap.set('mpr_axial', viewport);

    await mprService.setVolume('mpr_axial', 'vol-1');
    expect(viewport.setVolumes).toHaveBeenCalledWith([{ volumeId: 'vol-1' }]);
    expect(viewport.render).toHaveBeenCalled();

    mprService.setVOI('mpr_axial', 400, 50);
    expect(viewport.setProperties).toHaveBeenCalledWith({ voiRange: { lower: -150, upper: 250 } });

    mprService.resetCamera('mpr_axial');
    expect(viewport.resetCamera).toHaveBeenCalled();

    mprService.scroll('mpr_axial', 3);
    expect(viewport.scroll).toHaveBeenCalledWith(3);

    mprService.scrollToIndex('mpr_axial', 8);
    expect(viewport.scroll).toHaveBeenCalledWith(3);

    expect(mprService.getSliceInfo('mpr_axial')).toEqual({ sliceIndex: 5, totalSlices: 20 });
    expect(mprService.getZoom('mpr_axial')).toBe(140);

    mprService.setInvert('mpr_axial', true);
    expect(viewport.setProperties).toHaveBeenCalledWith({ invert: true });
  });

  it('handles missing engine/viewports with safe no-op defaults', async () => {
    mprMocks.getRenderingEngine.mockReturnValue(null);
    const el = { dataset: {} } as unknown as HTMLDivElement;
    mprService.createViewport('missing', el, 'AXIAL');
    expect(mprMocks.engine.enableElement).not.toHaveBeenCalled();

    await expect(mprService.setVolume('missing', 'vol-1')).resolves.toBeUndefined();
    expect(() => mprService.setVOI('missing', 400, 40)).not.toThrow();
    expect(() => mprService.resetCamera('missing')).not.toThrow();
    expect(() => mprService.scroll('missing', 1)).not.toThrow();
    expect(() => mprService.scrollToIndex('missing', 3)).not.toThrow();
    expect(() => mprService.setInvert('missing', false)).not.toThrow();
    expect(mprService.getSliceInfo('missing')).toEqual({ sliceIndex: 0, totalSlices: 0 });
    expect(mprService.getZoom('missing')).toBe(100);
    expect(mprService.getViewport('missing')).toBeNull();
  });

  it('avoids unnecessary scroll in scrollToIndex when already at target', () => {
    const viewport = makeViewport({
      getSliceIndex: vi.fn(() => 7),
      scroll: vi.fn(),
    });
    mprMocks.viewportMap.set('mpr_axial', viewport);

    mprService.scrollToIndex('mpr_axial', 7);
    expect(viewport.scroll).not.toHaveBeenCalled();
  });
});
