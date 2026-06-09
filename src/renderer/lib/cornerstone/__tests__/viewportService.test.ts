import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCoreModuleMock,
  createCornerstoneMockState,
  createFakeStackViewport,
} from '../../../test/cornerstone/cornerstoneMocks';
import { resetCornerstoneMocks } from '../../../test/cornerstone/resetCornerstoneMocks';

const cs = createCornerstoneMockState();

let viewportService: (typeof import('../viewportService'))['viewportService'];
let resolveInitialPlane: (typeof import('../viewportService'))['resolveInitialPlane'];

beforeAll(async () => {
  vi.doMock('@cornerstonejs/core', () => createCoreModuleMock(cs));

  ({ viewportService, resolveInitialPlane } = await import('../viewportService'));
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

  it('createUnifiedViewport routes non-volumetric data to a STACK viewport', async () => {
    const element = { dataset: {} } as unknown as HTMLDivElement;
    const viewport = createFakeStackViewport({ setStack: vi.fn(async () => undefined), render: vi.fn() });
    cs.setViewport('panel_0', viewport);

    const res = await viewportService.createUnifiedViewport('panel_0', element, {
      scanId: 's1',
      frameOfReferenceUID: 'for1',
      imageIds: ['img-a'],
      meta: { modality: 'US', imageCount: 1 }, // non-volumetric → stack
    });

    expect(res.type).toBe('stack');
    expect(res.volumeId).toBeNull();
    const engine = cs.getOrCreateEngine('xnatRenderingEngine');
    expect(engine.enableElement).toHaveBeenCalledWith(
      expect.objectContaining({ viewportId: 'panel_0', type: 'STACK' }),
    );
    expect(viewport.setStack).toHaveBeenCalledWith(['img-a']);
    // (The volume path renders a real ImageVolume — verified by the off-screen
    // E2E in P1.4 rather than a heavy volume mock here.)
  });

  it('scrollToSlice on a STACK viewport diffs against the native index', () => {
    const stack = {
      type: 'STACK',
      getCurrentImageIdIndex: vi.fn(() => 3),
      getImageIds: vi.fn(() => Array.from({ length: 10 }, (_, i) => `stk-${i}`)),
      scroll: vi.fn(),
    };
    cs.setViewport('panel_stk', stack as never);

    viewportService.scrollToSlice('panel_stk', 7);
    expect(stack.scroll).toHaveBeenCalledWith(4); // 7 - 3

    stack.scroll.mockClear();
    viewportService.scrollToSlice('panel_stk', 3); // no-op
    expect(stack.scroll).not.toHaveBeenCalled();

    stack.scroll.mockClear();
    viewportService.scrollToSlice('panel_stk', 999); // clamped to last (index 9) ⇒ +6
    expect(stack.scroll).toHaveBeenCalledWith(6);
  });

  it('scrollToSlice on a VOLUME viewport diffs against the REFORMATTED slice axis, not the native index', () => {
    // The volume exposes BOTH APIs; using getCurrentImageIdIndex (the native index)
    // would compute the delta against the wrong axis (the "257/21" class of bug).
    const volume = {
      type: 'ORTHOGRAPHIC',
      getSliceIndex: vi.fn(() => 50), // reformatted current slice
      getNumberOfSlices: vi.fn(() => 256), // reformatted total
      getCurrentImageIdIndex: vi.fn(() => 10), // native — must be IGNORED
      getImageIds: vi.fn(() => Array.from({ length: 21 }, (_, i) => `vol-${i}`)),
      scroll: vi.fn(),
    };
    cs.setViewport('panel_vol', volume as never);

    viewportService.scrollToSlice('panel_vol', 120);
    // delta = 120 - 50 (reformatted) = 70 — NOT 120 - 10 (the native axis).
    expect(volume.scroll).toHaveBeenCalledWith(70);
  });

  it('resolveInitialPlane: explicit wins, else native for non-MPR, else the layout preset', () => {
    // An explicit (user/stored) plane always wins.
    expect(resolveInitialPlane({ explicit: 'CORONAL', preferNative: true, layoutPlane: 'AXIAL', nativePlane: 'SAGITTAL' })).toBe('CORONAL');
    // Non-MPR (preferNative) opens in the scan's NATIVE plane — a sagittal scan ⇒ Sagittal.
    expect(resolveInitialPlane({ preferNative: true, layoutPlane: 'AXIAL', nativePlane: 'SAGITTAL' })).toBe('SAGITTAL');
    // MPR (not preferNative) uses the layout's designated plane, ignoring native.
    expect(resolveInitialPlane({ preferNative: false, layoutPlane: 'CORONAL', nativePlane: 'SAGITTAL' })).toBe('CORONAL');
    // A degenerate native ('STACK') falls back to the layout plane.
    expect(resolveInitialPlane({ preferNative: true, layoutPlane: 'AXIAL', nativePlane: 'STACK' })).toBe('AXIAL');
  });

  it('setOrientation reorients a VOLUME viewport and no-ops on a STACK viewport', () => {
    const volume = { type: 'ORTHOGRAPHIC', setOrientation: vi.fn(), render: vi.fn() };
    cs.setViewport('panel_vol', volume as never);
    viewportService.setOrientation('panel_vol', 'SAGITTAL');
    expect(volume.setOrientation).toHaveBeenCalledTimes(1);
    expect(volume.render).toHaveBeenCalled();

    // A STACK viewport has no setOrientation — must not throw, must not fabricate a call.
    const stack = { type: 'STACK', scroll: vi.fn() };
    cs.setViewport('panel_stk', stack as never);
    expect(() => viewportService.setOrientation('panel_stk', 'CORONAL')).not.toThrow();
  });

  it('readViewportState reads the VOLUME slice axis, not the native source count (the "257/21" bug)', () => {
    // v4 ORTHOGRAPHIC viewports expose BOTH the volume API (reformatted axis) AND
    // the stack API (native source count). Detection must key off viewport.type:
    // reading getImageIds().length here would give the native count (21), while
    // the reformatted axial view has 256 slices.
    const volume = {
      type: 'ORTHOGRAPHIC',
      getSliceIndex: vi.fn(() => 50),
      getNumberOfSlices: vi.fn(() => 256),
      getCurrentImageIdIndex: vi.fn(() => 50), // conflicting native API — must be ignored
      getImageIds: vi.fn(() => Array.from({ length: 21 }, (_, i) => `vol-${i}`)),
      getCurrentImageId: vi.fn(() => 'native-should-not-win'),
      getZoom: vi.fn(() => 1),
      getProperties: vi.fn(() => ({ voiRange: { lower: -100, upper: 300 } })),
      getImageData: vi.fn(() => ({ dimensions: [256, 256, 21] })),
    };
    cs.setViewport('panel_vol', volume as never);

    const s = viewportService.readViewportState('panel_vol');
    expect(s?.total).toBe(256); // reformatted count — NOT 21 (the bug)
    expect(s?.imageIndex).toBe(50);
    expect(s?.currentImageId).toBe('vol-0'); // series-level metadata from source[0]
    expect(s?.ww).toBe(400);
    expect(s?.wc).toBe(100);
  });

  it('readViewportState reads the stack API for STACK viewports', () => {
    const stack = {
      type: 'STACK',
      getCurrentImageIdIndex: vi.fn(() => 5),
      getImageIds: vi.fn(() => Array.from({ length: 10 }, (_, i) => `stk-${i}`)),
      getCurrentImageId: vi.fn(() => 'stk-5'),
      getZoom: vi.fn(() => 2),
      getProperties: vi.fn(() => ({ voiRange: { lower: 0, upper: 200 } })),
      getImageData: vi.fn(() => ({ dimensions: [512, 512] })),
    };
    cs.setViewport('panel_stk', stack as never);

    const s = viewportService.readViewportState('panel_stk');
    expect(s?.total).toBe(10);
    expect(s?.imageIndex).toBe(5);
    expect(s?.currentImageId).toBe('stk-5');
    expect(s?.zoom).toBe(200);
  });
});
