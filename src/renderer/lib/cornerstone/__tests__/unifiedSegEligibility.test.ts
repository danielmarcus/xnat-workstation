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

import {
  unifiedSegService,
  attachLabelmapToOwnSeries,
  canDrawOnViewport,
  isContainerNativeToViewport,
} from '../unifiedSegService';
import * as sourceImageTracking from '../sourceImageTracking';

/** Make getViewport return a viewport with the given FoR + series. */
function viewportWith(frameOfReferenceUID: string | null, series: string | null): void {
  m.getViewport.mockReturnValue({
    getFrameOfReferenceUID: () => frameOfReferenceUID,
    getImageIds: () => (series ? ['img-0'] : []),
    getCurrentImageId: () => (series ? 'img-0' : null),
  });
  m.metaGet.mockImplementation((mod?: string, id?: string) => {
    // Source-image metadata for the IMPORT path (see importedContainer below); the
    // viewport's own image keeps answering for the viewport's series.
    const imported = importedImageMeta.get(id ?? '');
    if (imported) {
      if (mod === 'generalSeriesModule') return { seriesInstanceUID: imported.series };
      if (mod === 'imagePlaneModule') return { frameOfReferenceUID: imported.forUID };
      return undefined;
    }
    if (mod === 'generalSeriesModule') return { seriesInstanceUID: series };
    if (mod === 'imagePlaneModule') return { frameOfReferenceUID };
    return undefined;
  });
}

/** Metadata for images belonging to an imported container's source series. */
const importedImageMeta = new Map<string, { forUID: string; series: string }>();

/**
 * Stand in for a container LOADED from XNAT: registered with Cornerstone and tracked
 * against its source images, but never passed through a create path — so nothing ever
 * called recordContainerSpatial for it.
 */
function importedContainer(containerId: string, forUID: string, series: string): void {
  const imageId = `${containerId}-src-0`;
  importedImageMeta.set(imageId, { forUID, series });
  sourceImageTracking.setSourceImageIds(containerId, [imageId]);
}

beforeEach(() => {
  unifiedSegService.reset();
  importedImageMeta.clear();
  sourceImageTracking.clearAll();
  Object.values(m).forEach((fn) => (fn as { mockClear?: () => void }).mockClear?.());
  // Container is native to FoR-1 / series-A.
  unifiedSegService._setContainerSpatialForTest('seg1', {
    frameOfReferenceUID: 'FoR-1',
    nativeSeriesInstanceUID: 'series-A',
    referencedSeriesInstanceUIDs: ['series-A'],
  });
});
afterEach(() => vi.clearAllMocks());

/**
 * A mask belongs to the scan it was drawn on: shown on every viewport displaying that
 * scan, and on no others.
 *
 * This replaced requirements A2a–A2d, under which a mask also rendered — dimmed and
 * read-only — on a SIBLING series of the same exam unless a measured anatomical shift
 * suggested the patient had moved. That rule was removed as incorrect, and with it the
 * non-native style, so `setStyle` should now never be called from an attach.
 */
describe('attachLabelmapToOwnSeries', () => {
  it('attaches to a viewport showing its own scan, active and undimmed', () => {
    viewportWith('FoR-1', 'series-A');
    attachLabelmapToOwnSeries('seg1', 'panel_0');
    expect(m.addLabelmapRep).toHaveBeenCalledWith('panel_0', [{ segmentationId: 'seg1' }]);
    expect(m.setStyle).not.toHaveBeenCalled();
    expect(m.setActive).toHaveBeenCalledWith('panel_0', 'seg1');
  });

  it('does NOT attach to a sibling series of the same exam', () => {
    viewportWith('FoR-1', 'series-B');
    attachLabelmapToOwnSeries('seg1', 'panel_1');
    expect(m.addLabelmapRep).not.toHaveBeenCalled();
    expect(m.setStyle).not.toHaveBeenCalled();
  });

  it('does NOT attach to a different frame of reference', () => {
    viewportWith('FoR-2', 'series-X');
    attachLabelmapToOwnSeries('seg1', 'panel_2');
    expect(m.addLabelmapRep).not.toHaveBeenCalled();
  });

  it('fails OPEN when the viewport identity is unresolved — a working render is never suppressed', () => {
    viewportWith(null, null);
    attachLabelmapToOwnSeries('seg1', 'panel_3');
    expect(m.addLabelmapRep).toHaveBeenCalledWith('panel_3', [{ segmentationId: 'seg1' }]);
  });
});

describe('canDrawOnViewport (Slice 3: gesture-start blocking, B3 / signal 12)', () => {
  it('allows drawing on a viewport native to the active container', () => {
    viewportWith('FoR-1', 'series-A');
    expect(canDrawOnViewport('seg1', 'panel_0')).toEqual({ allowed: true });
  });

  it('blocks drawing on a sibling series of the same exam, with a hint', () => {
    viewportWith('FoR-1', 'series-B');
    const d = canDrawOnViewport('seg1', 'panel_1');
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/different scan|create/i);
  });

  it('blocks drawing on a different frame of reference, with a hint', () => {
    viewportWith('FoR-2', 'series-X');
    const d = canDrawOnViewport('seg1', 'panel_2');
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/different scan|create/i);
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

/**
 * Regression: a container IMPORTED from XNAT never passes through a create path, so
 * `recordContainerSpatial` never ran for it and `containerSpatial` had no entry. Every
 * spatial decision fails open on a missing entry, which meant the draw gate never
 * blocked a loaded container on any viewport and its rows never dimmed — the two
 * symptoms reported against the multi-viewport grid. Spatial identity must therefore be
 * derivable from the container's own source images, not only from its create origin.
 */
describe('spatial identity of an IMPORTED container (no create-path record)', () => {
  it('blocks drawing on a different-FoR viewport', () => {
    importedContainer('loadedSeg', 'FoR-1', 'series-A');
    viewportWith('FoR-2', 'series-X');
    const d = canDrawOnViewport('loadedSeg', 'panel_2');
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/frame of reference|different/i);
  });

  it('blocks drawing on a same-FoR sibling series (read-only there)', () => {
    importedContainer('loadedSeg', 'FoR-1', 'series-A');
    viewportWith('FoR-1', 'series-B');
    expect(canDrawOnViewport('loadedSeg', 'panel_1').allowed).toBe(false);
  });

  it('still allows drawing on its own series', () => {
    importedContainer('loadedSeg', 'FoR-1', 'series-A');
    viewportWith('FoR-1', 'series-A');
    expect(canDrawOnViewport('loadedSeg', 'panel_0')).toEqual({ allowed: true });
  });

  it('reports to the panel which viewport shows its scan, so the list can scope', () => {
    importedContainer('loadedSeg', 'FoR-1', 'series-A');
    viewportWith('FoR-1', 'series-A');
    expect(isContainerNativeToViewport('loadedSeg', 'panel_0')).toBe(true);
    viewportWith('FoR-1', 'series-B');
    expect(isContainerNativeToViewport('loadedSeg', 'panel_1')).toBe(false);
    viewportWith('FoR-2', 'series-X');
    expect(isContainerNativeToViewport('loadedSeg', 'panel_2')).toBe(false);
  });

  it('does not attach to a different-FoR viewport', () => {
    importedContainer('loadedSeg', 'FoR-1', 'series-A');
    viewportWith('FoR-2', 'series-X');
    attachLabelmapToOwnSeries('loadedSeg', 'panel_2');
    expect(m.addLabelmapRep).not.toHaveBeenCalled();
  });

  it('still fails OPEN when the container has no source images to derive from', () => {
    viewportWith('FoR-2', 'series-X');
    expect(canDrawOnViewport('untracked', 'panel_2')).toEqual({ allowed: true });
  });
});
