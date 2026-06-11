import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  addLabelmapRep: vi.fn(),
  setActive: vi.fn(),
  setStyle: vi.fn(),
  setVisibility: vi.fn(),
  getViewport: vi.fn(),
  metaGet: vi.fn((_mod?: string, _id?: string): unknown => undefined),
}));

vi.mock('@cornerstonejs/core', () => ({
  metaData: { get: (mod: string, id: string) => m.metaGet(mod, id) },
  volumeLoader: { createAndCacheDerivedLabelmapVolume: vi.fn() },
  getRenderingEngine: vi.fn(),
  cache: { getVolume: vi.fn() }, // readSourceVolumeGeometry/readLabelmapVoxels (signal 10/23)
}));
vi.mock('@cornerstonejs/tools', () => ({
  segmentation: {
    addLabelmapRepresentationToViewport: (vp: string, s: unknown) => m.addLabelmapRep(vp, s),
    addContourRepresentationToViewport: vi.fn(),
    addSegmentations: vi.fn(),
    activeSegmentation: { setActiveSegmentation: (vp: string, s: string) => m.setActive(vp, s) },
    segmentationStyle: { setStyle: (spec: unknown, st: unknown) => m.setStyle(spec, st) },
    segmentIndex: { setActiveSegmentIndex: vi.fn() },
    config: { visibility: { setSegmentationRepresentationVisibility: (vp: string, s: unknown, v: boolean) => m.setVisibility(vp, s, v) } },
    state: { getSegmentation: () => ({}) },
  },
  Enums: { SegmentationRepresentations: { Labelmap: 'Labelmap', Contour: 'Contour' } },
  utilities: { segmentation: { triggerSegmentationRender: vi.fn() } },
}));
vi.mock('@cornerstonejs/polymorphic-segmentation', () => ({
  canComputeRequestedRepresentation: vi.fn(() => false),
  computeLabelmapData: vi.fn(),
}));
vi.mock('../viewportService', () => ({
  viewportService: { getViewport: (id: string) => m.getViewport(id), ENGINE_ID: 'xnatRenderingEngine' },
}));
// viewerStore transitively imports unifiedToolService → SafePaintFillTool (a heavy
// Cornerstone tool subclass). The eligibility/draw-gate logic under test never reads
// viewerStore, so stub the boundary to keep that whole tool chain out of the graph.
vi.mock('../../../stores/viewerStore', () => ({
  useViewerStore: { getState: () => ({ activeViewportId: 'panel_0' }) },
}));

import { unifiedSegService, attachLabelmapWithEligibility, canDrawOnViewport } from '../unifiedSegService';

/** Make getViewport return a viewport with the given FoR + series. */
function viewportWith(frameOfReferenceUID: string | null, series: string | null): void {
  m.getViewport.mockReturnValue({
    getFrameOfReferenceUID: () => frameOfReferenceUID,
    getImageIds: () => (series ? ['img-0'] : []),
    getCurrentImageId: () => (series ? 'img-0' : null),
  });
  m.metaGet.mockImplementation((mod?: string) =>
    mod === 'generalSeriesModule' ? { seriesInstanceUID: series } : undefined,
  );
}

beforeEach(() => {
  unifiedSegService.reset();
  Object.values(m).forEach((fn) => (fn as { mockClear?: () => void }).mockClear?.());
  // Container is native to FoR-1 / series-A.
  unifiedSegService._setContainerSpatialForTest('seg1', {
    frameOfReferenceUID: 'FoR-1',
    nativeSeriesInstanceUID: 'series-A',
    referencedSeriesInstanceUIDs: ['series-A'],
  });
});
afterEach(() => vi.clearAllMocks());

describe('attachLabelmapWithEligibility (Slice 2: FoR-gated attach + non-native style)', () => {
  it('native viewport (same FoR + series) ⇒ attach, solid (no setStyle), editable', () => {
    viewportWith('FoR-1', 'series-A');
    attachLabelmapWithEligibility('seg1', 'panel_0');
    expect(m.addLabelmapRep).toHaveBeenCalledWith('panel_0', [{ segmentationId: 'seg1' }]);
    expect(m.setStyle).not.toHaveBeenCalled();
    expect(m.setActive).toHaveBeenCalledWith('panel_0', 'seg1');
  });

  it('same-FoR sibling series (A2b) ⇒ attach, non-native style, read-only (not active)', () => {
    viewportWith('FoR-1', 'series-B');
    attachLabelmapWithEligibility('seg1', 'panel_1');
    expect(m.addLabelmapRep).toHaveBeenCalledWith('panel_1', [{ segmentationId: 'seg1' }]);
    expect(m.setStyle).toHaveBeenCalledTimes(1);
    const [spec, style] = m.setStyle.mock.calls[0];
    expect(spec).toMatchObject({ type: 'Labelmap', viewportId: 'panel_1', segmentationId: 'seg1' });
    expect((style as { fillAlpha: number }).fillAlpha).toBeLessThanOrEqual(0.3);
    expect(m.setActive).not.toHaveBeenCalled(); // read-only
  });

  it('different Frame of Reference (A2d) ⇒ does NOT attach here', () => {
    viewportWith('FoR-2', 'series-X');
    attachLabelmapWithEligibility('seg1', 'panel_2');
    expect(m.addLabelmapRep).not.toHaveBeenCalled();
  });

  it('fails OPEN to native when the viewport FoR is unresolved (no regression of single-series render)', () => {
    viewportWith(null, null);
    attachLabelmapWithEligibility('seg1', 'panel_3');
    expect(m.addLabelmapRep).toHaveBeenCalledWith('panel_3', [{ segmentationId: 'seg1' }]);
    expect(m.setStyle).not.toHaveBeenCalled();
  });
});

describe('canDrawOnViewport (Slice 3: gesture-start blocking, B3 / signal 12)', () => {
  it('allows drawing on a viewport native to the active container', () => {
    viewportWith('FoR-1', 'series-A');
    expect(canDrawOnViewport('seg1', 'panel_0')).toEqual({ allowed: true });
  });

  it('blocks drawing on a same-FoR sibling series (read-only) with a hint', () => {
    viewportWith('FoR-1', 'series-B');
    const d = canDrawOnViewport('seg1', 'panel_1');
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/sibling series|switch|create/i);
  });

  it('blocks drawing on a different Frame of Reference with a hint', () => {
    viewportWith('FoR-2', 'series-X');
    const d = canDrawOnViewport('seg1', 'panel_2');
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/frame of reference|different/i);
  });

  it('blocks with a hint when there is no active container', () => {
    viewportWith('FoR-1', 'series-A');
    const d = canDrawOnViewport(null, 'panel_0');
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/no active container|create|select/i);
  });

  it('fails OPEN (allows) when spatial ids are unresolved — never blocks a valid single-series draw', () => {
    viewportWith(null, null);
    expect(canDrawOnViewport('seg1', 'panel_3')).toEqual({ allowed: true });
  });
});
