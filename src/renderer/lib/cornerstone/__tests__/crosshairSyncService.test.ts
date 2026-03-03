// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const metaDataGetMock = vi.hoisted(() => vi.fn());
const scrollToIndexMock = vi.hoisted(() => vi.fn());
const getPanelDisplayPointForWorldMock = vi.hoisted(() => vi.fn());
const getViewportForPanelMock = vi.hoisted(() => vi.fn());
const getWorldPointFromClientPointMock = vi.hoisted(() => vi.fn());

type ViewerState = {
  panelImageIdsMap: Record<string, string[]>;
  viewports: Record<string, { imageIndex: number; requestedImageIndex: number | null; totalImages: number }>;
  crosshairWorldPoint: [number, number, number] | null;
  crosshairSourcePanelId: string | null;
  setCrosshairWorldPoint: (point: [number, number, number], sourcePanelId: string) => void;
  _requestImageIndex: (panelId: string, index: number, total: number) => void;
};

const viewerStoreMock = vi.hoisted(() => {
  const createState = (): ViewerState => ({
    panelImageIdsMap: {
      panel_0: ['img-source'],
      panel_1: ['img-target-a', 'img-target-b', 'img-target-c'],
    },
    viewports: {},
    crosshairWorldPoint: null,
    crosshairSourcePanelId: null,
    setCrosshairWorldPoint(point, sourcePanelId) {
      state.crosshairWorldPoint = point;
      state.crosshairSourcePanelId = sourcePanelId;
    },
    _requestImageIndex(panelId, index, total) {
      const current = state.viewports[panelId] ?? {
        imageIndex: 0,
        requestedImageIndex: null,
        totalImages: total,
      };
      state.viewports[panelId] = {
        ...current,
        totalImages: total,
        requestedImageIndex: index,
      };
    },
  });

  let state = createState();
  return {
    reset: () => {
      state = createState();
    },
    getState: () => state,
    setState: (next: Partial<ViewerState>) => {
      state = { ...state, ...next };
    },
  };
});

vi.mock('@cornerstonejs/core', () => ({
  metaData: {
    get: metaDataGetMock,
  },
}));

vi.mock('../viewportService', () => ({
  viewportService: {
    scrollToIndex: scrollToIndexMock,
  },
}));

vi.mock('../crosshairGeometry', () => ({
  getPanelDisplayPointForWorld: getPanelDisplayPointForWorldMock,
  getViewportForPanel: getViewportForPanelMock,
  getWorldPointFromClientPoint: getWorldPointFromClientPointMock,
}));

vi.mock('../../../stores/viewerStore', () => ({
  useViewerStore: {
    getState: viewerStoreMock.getState,
    setState: viewerStoreMock.setState,
  },
}));

import { crosshairSyncService } from '../crosshairSyncService';

type PlaneMeta = {
  frameOfReferenceUID?: string;
  imagePositionPatient?: number[];
  imageOrientationPatient?: number[];
};

function setMetadata(modules: Record<string, unknown>): void {
  metaDataGetMock.mockImplementation((type: string, imageId: string) => {
    return modules[`${type}|${imageId}`];
  });
}

describe('crosshairSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewerStoreMock.reset();
    getPanelDisplayPointForWorldMock.mockReturnValue([1, 1]);
    getWorldPointFromClientPointMock.mockReturnValue([0, 0, 0]);
  });

  it('publishes crosshair point, jumps matching viewport, and syncs requested index from viewport state', () => {
    setMetadata({
      'imagePlaneModule|img-source': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|img-source': { seriesInstanceUID: 'SER-1' },
      'imagePlaneModule|img-target-a': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|img-target-a': { seriesInstanceUID: 'SER-1' },
    });

    const targetViewport = {
      jumpToWorld: vi.fn(() => true),
      getCurrentImageIdIndex: vi.fn(() => 2),
      render: vi.fn(),
    };
    getViewportForPanelMock.mockImplementation((panelId: string) => (
      panelId === 'panel_1' ? targetViewport : null
    ));

    crosshairSyncService.syncFromViewport('panel_0', [10, 20, 30]);

    const state = viewerStoreMock.getState();
    expect(state.crosshairWorldPoint).toEqual([10, 20, 30]);
    expect(state.crosshairSourcePanelId).toBe('panel_0');
    expect(targetViewport.jumpToWorld).toHaveBeenCalledWith([10, 20, 30]);
    expect(state.viewports.panel_1?.requestedImageIndex).toBe(2);
    expect(scrollToIndexMock).not.toHaveBeenCalled();
  });

  it('skips target panels that do not match frame-of-reference/series compatibility', () => {
    setMetadata({
      'imagePlaneModule|img-source': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|img-source': { seriesInstanceUID: 'SER-1' },
      'imagePlaneModule|img-target-a': { frameOfReferenceUID: 'FOR-2' },
      'generalSeriesModule|img-target-a': { seriesInstanceUID: 'SER-2' },
    });

    const targetViewport = {
      jumpToWorld: vi.fn(() => true),
    };
    getViewportForPanelMock.mockReturnValue(targetViewport);

    crosshairSyncService.syncFromViewport('panel_0', [1, 2, 3]);
    expect(targetViewport.jumpToWorld).not.toHaveBeenCalled();
    expect(scrollToIndexMock).not.toHaveBeenCalled();
  });

  it('falls back to nearest stack index when jumpToWorld is unavailable/unsuccessful', () => {
    const plane = (z: number): PlaneMeta => ({
      frameOfReferenceUID: 'FOR-1',
      imagePositionPatient: [0, 0, z],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    });
    setMetadata({
      'imagePlaneModule|img-source': plane(5),
      'generalSeriesModule|img-source': { seriesInstanceUID: 'SER-1' },
      'imagePlaneModule|img-target-a': plane(0),
      'imagePlaneModule|img-target-b': plane(10),
      'imagePlaneModule|img-target-c': plane(20),
      'generalSeriesModule|img-target-a': { seriesInstanceUID: 'SER-1' },
    });

    getViewportForPanelMock.mockReturnValue({
      jumpToWorld: vi.fn(() => false),
    });

    crosshairSyncService.syncFromViewport('panel_0', [0, 0, 9]);

    expect(viewerStoreMock.getState().viewports.panel_1?.requestedImageIndex).toBe(1);
    expect(scrollToIndexMock).toHaveBeenCalledWith('panel_1', 1);
  });

  it('keeps jumped point visible by in-plane camera pan when offscreen', () => {
    setMetadata({
      'imagePlaneModule|img-source': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|img-source': { seriesInstanceUID: 'SER-1' },
      'imagePlaneModule|img-target-a': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|img-target-a': { seriesInstanceUID: 'SER-1' },
    });
    getPanelDisplayPointForWorldMock.mockReturnValue(null);

    const panelEl = document.createElement('div');
    panelEl.setAttribute('data-panel-id', 'panel_1');
    Object.defineProperty(panelEl, 'getBoundingClientRect', {
      value: () => ({ left: 10, top: 20, width: 100, height: 80 }),
    });
    document.body.appendChild(panelEl);

    const setCamera = vi.fn();
    const targetViewport = {
      jumpToWorld: vi.fn(() => true),
      getCurrentImageIdIndex: vi.fn(() => 0),
      getCamera: vi.fn(() => ({
        focalPoint: [0, 0, 0],
        position: [0, -100, 50],
        viewPlaneNormal: [0, 0, 1],
      })),
      setCamera,
      render: vi.fn(),
    };
    getViewportForPanelMock.mockReturnValue(targetViewport);

    crosshairSyncService.syncFromViewport('panel_0', [10, 0, 5]);

    expect(setCamera).toHaveBeenCalledWith({
      focalPoint: [10, 0, 0],
      position: [10, -100, 50],
    });
    expect(targetViewport.render).toHaveBeenCalled();
  });

  it('uses series UID fallback when target frame UID is missing', () => {
    setMetadata({
      'imagePlaneModule|img-source': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|img-source': { seriesInstanceUID: 'SER-1' },
      'imagePlaneModule|img-target-a': {},
      'generalSeriesModule|img-target-a': { seriesInstanceUID: 'SER-1' },
    });
    const targetViewport = {
      jumpToWorld: vi.fn(() => true),
    };
    getViewportForPanelMock.mockReturnValue(targetViewport);

    crosshairSyncService.syncFromViewport('panel_0', [3, 2, 1]);
    expect(targetViewport.jumpToWorld).toHaveBeenCalledWith([3, 2, 1]);
  });
});
