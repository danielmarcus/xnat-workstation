// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const metaDataGetMock = vi.hoisted(() => vi.fn());
const scrollToIndexMock = vi.hoisted(() => vi.fn());
const mprScrollToIndexMock = vi.hoisted(() => vi.fn());
const getPanelDisplayPointForWorldMock = vi.hoisted(() => vi.fn());
const getViewportForPanelMock = vi.hoisted(() => vi.fn());
const getWorldPointFromClientPointMock = vi.hoisted(() => vi.fn());

type ViewerState = {
  panelImageIdsMap: Record<string, string[]>;
  viewports: Record<string, { imageIndex: number; requestedImageIndex: number | null; totalImages: number }>;
  panelXnatContextMap: Record<string, { subjectId: string; sessionId: string }>;
  panelSubjectLabelMap: Record<string, string>;
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
    panelXnatContextMap: {},
    panelSubjectLabelMap: {},
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
  Enums: {
    ViewportType: { STACK: 'STACK' },
  },
}));

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      isLoaded: vi.fn(() => false),
      get: vi.fn(() => null),
      load: vi.fn(async () => undefined),
    },
  },
}));

vi.mock('../viewportService', () => ({
  viewportService: {
    scrollToIndex: scrollToIndexMock,
  },
}));

vi.mock('../mprService', () => ({
  mprService: {
    getViewport: vi.fn(() => null),
    scrollToIndex: mprScrollToIndexMock,
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
    // Invalidate any leftover metadata-loaded state from previous tests.
    crosshairSyncService.invalidatePanel('panel_0');
    crosshairSyncService.invalidatePanel('panel_1');
    crosshairSyncService.invalidatePanel('panel_2');
  });

  it('publishes crosshair point, jumps matching viewport, and syncs requested index from viewport state', () => {
    setMetadata({
      'imagePlaneModule|img-source': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|img-source': { seriesInstanceUID: 'SER-1' },
      'imagePlaneModule|img-target-a': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|img-target-a': { seriesInstanceUID: 'SER-1' },
    });

    const targetViewport = {
      type: 'orthogonal',
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
      type: 'orthogonal',
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
      type: 'orthogonal',
      jumpToWorld: vi.fn(() => false),
    });

    // Mark target panel metadata as loaded so stack fallback works synchronously.
    crosshairSyncService._markMetadataLoaded('panel_1');

    crosshairSyncService.syncFromViewport('panel_0', [0, 0, 9]);

    expect(viewerStoreMock.getState().viewports.panel_1?.requestedImageIndex).toBe(1);
    expect(mprScrollToIndexMock).toHaveBeenCalledWith('panel_1', 1);
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
      type: 'orthogonal',
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

  it('proceeds with sync when target frame-of-reference UID is missing (lenient matching)', () => {
    // When FOR metadata is unavailable (e.g. wadouri image not yet decoded),
    // sync should proceed rather than silently skipping the panel.
    setMetadata({
      'imagePlaneModule|img-source': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|img-source': { seriesInstanceUID: 'SER-1' },
      'imagePlaneModule|img-target-a': {},  // No FOR available
      'generalSeriesModule|img-target-a': { seriesInstanceUID: 'SER-2' },  // Different series — should still sync
    });
    const targetViewport = {
      type: 'orthogonal',
      jumpToWorld: vi.fn(() => true),
    };
    getViewportForPanelMock.mockReturnValue(targetViewport);

    crosshairSyncService.syncFromViewport('panel_0', [3, 2, 1]);
    expect(targetViewport.jumpToWorld).toHaveBeenCalledWith([3, 2, 1]);
  });

  it('proceeds with sync when source frame-of-reference UID is missing', () => {
    setMetadata({
      'imagePlaneModule|img-source': {},  // No FOR available
      'generalSeriesModule|img-source': { seriesInstanceUID: 'SER-1' },
      'imagePlaneModule|img-target-a': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|img-target-a': { seriesInstanceUID: 'SER-2' },
    });
    const targetViewport = {
      type: 'orthogonal',
      jumpToWorld: vi.fn(() => true),
    };
    getViewportForPanelMock.mockReturnValue(targetViewport);

    crosshairSyncService.syncFromViewport('panel_0', [3, 2, 1]);
    expect(targetViewport.jumpToWorld).toHaveBeenCalledWith([3, 2, 1]);
  });

  describe('multi-scan same-session sync', () => {
    it('syncs two different scans sharing the same FrameOfReferenceUID to the same world point', () => {
      // Simulate two scans from the same session: T1 (scan 1) and T2 (scan 2),
      // different series UIDs but same frame of reference (same patient position).
      viewerStoreMock.setState({
        panelImageIdsMap: {
          panel_0: ['scan1-slice0', 'scan1-slice1', 'scan1-slice2'],
          panel_1: ['scan2-slice0', 'scan2-slice1', 'scan2-slice2', 'scan2-slice3'],
        },
      });

      setMetadata({
        'imagePlaneModule|scan1-slice0': { frameOfReferenceUID: 'FOR-SESSION-1' },
        'generalSeriesModule|scan1-slice0': { seriesInstanceUID: 'SER-T1' },
        'imagePlaneModule|scan2-slice0': { frameOfReferenceUID: 'FOR-SESSION-1' },
        'generalSeriesModule|scan2-slice0': { seriesInstanceUID: 'SER-T2' },
      });

      const targetViewport = {
        type: 'orthogonal',
        jumpToWorld: vi.fn(() => true),
        getCurrentImageIdIndex: vi.fn(() => 1),
        render: vi.fn(),
      };
      getViewportForPanelMock.mockImplementation((panelId: string) =>
        panelId === 'panel_1' ? targetViewport : null,
      );

      crosshairSyncService.syncFromViewport('panel_0', [50, 60, 70]);

      expect(targetViewport.jumpToWorld).toHaveBeenCalledWith([50, 60, 70]);
      expect(targetViewport.render).toHaveBeenCalled();
      const state = viewerStoreMock.getState();
      expect(state.crosshairWorldPoint).toEqual([50, 60, 70]);
      expect(state.crosshairSourcePanelId).toBe('panel_0');
      expect(state.viewports.panel_1?.requestedImageIndex).toBe(1);
    });

    it('syncs bidirectionally: clicking in either panel navigates the other', () => {
      viewerStoreMock.setState({
        panelImageIdsMap: {
          panel_0: ['scanA-0', 'scanA-1', 'scanA-2'],
          panel_1: ['scanB-0', 'scanB-1', 'scanB-2'],
        },
      });

      setMetadata({
        'imagePlaneModule|scanA-0': { frameOfReferenceUID: 'FOR-1' },
        'generalSeriesModule|scanA-0': { seriesInstanceUID: 'SER-A' },
        'imagePlaneModule|scanB-0': { frameOfReferenceUID: 'FOR-1' },
        'generalSeriesModule|scanB-0': { seriesInstanceUID: 'SER-B' },
      });

      const viewportA = {
        type: 'orthogonal',
        jumpToWorld: vi.fn(() => true),
        getCurrentImageIdIndex: vi.fn(() => 0),
        render: vi.fn(),
      };
      const viewportB = {
        type: 'orthogonal',
        jumpToWorld: vi.fn(() => true),
        getCurrentImageIdIndex: vi.fn(() => 2),
        render: vi.fn(),
      };
      getViewportForPanelMock.mockImplementation((panelId: string) => {
        if (panelId === 'panel_0') return viewportA;
        if (panelId === 'panel_1') return viewportB;
        return null;
      });

      // Click in panel_0 → panel_1 should sync
      crosshairSyncService.syncFromViewport('panel_0', [10, 20, 30]);
      expect(viewportB.jumpToWorld).toHaveBeenCalledWith([10, 20, 30]);
      expect(viewportA.jumpToWorld).not.toHaveBeenCalled();

      vi.clearAllMocks();

      // Click in panel_1 → panel_0 should sync
      crosshairSyncService.syncFromViewport('panel_1', [40, 50, 60]);
      expect(viewportA.jumpToWorld).toHaveBeenCalledWith([40, 50, 60]);
      expect(viewportB.jumpToWorld).not.toHaveBeenCalled();
    });

    it('syncs across three panels from different scans in the same session', () => {
      viewerStoreMock.setState({
        panelImageIdsMap: {
          panel_0: ['t1-0'],
          panel_1: ['t2-0'],
          panel_2: ['flair-0'],
        },
      });

      setMetadata({
        'imagePlaneModule|t1-0': { frameOfReferenceUID: 'FOR-SESSION' },
        'generalSeriesModule|t1-0': { seriesInstanceUID: 'SER-T1' },
        'imagePlaneModule|t2-0': { frameOfReferenceUID: 'FOR-SESSION' },
        'generalSeriesModule|t2-0': { seriesInstanceUID: 'SER-T2' },
        'imagePlaneModule|flair-0': { frameOfReferenceUID: 'FOR-SESSION' },
        'generalSeriesModule|flair-0': { seriesInstanceUID: 'SER-FLAIR' },
      });

      const vpT2 = { type: 'orthogonal', jumpToWorld: vi.fn(() => true), getCurrentImageIdIndex: vi.fn(() => 0), render: vi.fn() };
      const vpFlair = { type: 'orthogonal', jumpToWorld: vi.fn(() => true), getCurrentImageIdIndex: vi.fn(() => 0), render: vi.fn() };
      getViewportForPanelMock.mockImplementation((panelId: string) => {
        if (panelId === 'panel_1') return vpT2;
        if (panelId === 'panel_2') return vpFlair;
        return null;
      });

      crosshairSyncService.syncFromViewport('panel_0', [5, 10, 15]);

      expect(vpT2.jumpToWorld).toHaveBeenCalledWith([5, 10, 15]);
      expect(vpFlair.jumpToWorld).toHaveBeenCalledWith([5, 10, 15]);
    });
  });

  it('syncs same-subject panels across different sessions by slice geometry when FOR UIDs differ', () => {
    viewerStoreMock.setState({
      panelImageIdsMap: {
        panel_0: ['sess1-0', 'sess1-1', 'sess1-2'],
        panel_1: ['sess2-0', 'sess2-1', 'sess2-2', 'sess2-3'],
      },
      panelXnatContextMap: {
        panel_0: { subjectId: 'SUB-1', sessionId: 'SESS-1' },
        panel_1: { subjectId: 'SUB-1', sessionId: 'SESS-2' },
      },
    });

    const axialPlane = (z: number, forUid: string): PlaneMeta => ({
      frameOfReferenceUID: forUid,
      imagePositionPatient: [0, 0, z],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    });

    setMetadata({
      'imagePlaneModule|sess1-0': axialPlane(0, 'FOR-SESS-1'),
      'imagePlaneModule|sess1-1': axialPlane(5, 'FOR-SESS-1'),
      'imagePlaneModule|sess1-2': axialPlane(10, 'FOR-SESS-1'),
      'generalSeriesModule|sess1-0': { seriesInstanceUID: 'SER-SESS-1' },
      'imagePlaneModule|sess2-0': axialPlane(0, 'FOR-SESS-2'),
      'imagePlaneModule|sess2-1': axialPlane(4, 'FOR-SESS-2'),
      'imagePlaneModule|sess2-2': axialPlane(8, 'FOR-SESS-2'),
      'imagePlaneModule|sess2-3': axialPlane(12, 'FOR-SESS-2'),
      'generalSeriesModule|sess2-0': { seriesInstanceUID: 'SER-SESS-2' },
    });

    crosshairSyncService._markMetadataLoaded('panel_1');
    const targetViewport = {
      type: 'stack',
      jumpToWorld: vi.fn(() => true),
      getCamera: vi.fn(),
      setCamera: vi.fn(),
      render: vi.fn(),
    };
    getViewportForPanelMock.mockReturnValue(targetViewport);

    crosshairSyncService.syncFromViewport('panel_0', [0, 0, 9]);

    expect(targetViewport.jumpToWorld).not.toHaveBeenCalled();
    expect(viewerStoreMock.getState().viewports.panel_1?.requestedImageIndex).toBe(2);
    expect(scrollToIndexMock).toHaveBeenCalledWith('panel_1', 2);
    expect(targetViewport.setCamera).not.toHaveBeenCalled();
    expect(targetViewport.render).toHaveBeenCalled();
  });

  it('still skips panels from different known subjects when FOR UIDs differ', () => {
    viewerStoreMock.setState({
      panelImageIdsMap: {
        panel_0: ['sub1-0'],
        panel_1: ['sub2-0'],
      },
      panelXnatContextMap: {
        panel_0: { subjectId: 'SUB-1', sessionId: 'SESS-1' },
        panel_1: { subjectId: 'SUB-2', sessionId: 'SESS-9' },
      },
    });

    setMetadata({
      'imagePlaneModule|sub1-0': { frameOfReferenceUID: 'FOR-1' },
      'generalSeriesModule|sub1-0': { seriesInstanceUID: 'SER-1' },
      'imagePlaneModule|sub2-0': { frameOfReferenceUID: 'FOR-2' },
      'generalSeriesModule|sub2-0': { seriesInstanceUID: 'SER-2' },
    });

    const targetViewport = {
      type: 'stack',
      jumpToWorld: vi.fn(() => true),
      render: vi.fn(),
    };
    getViewportForPanelMock.mockReturnValue(targetViewport);

    crosshairSyncService.syncFromViewport('panel_0', [0, 0, 10]);

    expect(targetViewport.jumpToWorld).not.toHaveBeenCalled();
    expect(scrollToIndexMock).not.toHaveBeenCalled();
    expect(viewerStoreMock.getState().viewports.panel_1).toBeUndefined();
  });

  describe('different slice spacing and count', () => {
    it('selects the nearest slice when target scan has coarser spacing than source', () => {
      // Source: 1mm slices (0–4mm), Target: 2mm slices (0, 2, 4, 6, 8mm)
      viewerStoreMock.setState({
        panelImageIdsMap: {
          panel_0: ['fine-0', 'fine-1', 'fine-2', 'fine-3', 'fine-4'],
          panel_1: ['coarse-0', 'coarse-1', 'coarse-2', 'coarse-3', 'coarse-4'],
        },
      });

      const axialPlane = (z: number): PlaneMeta => ({
        frameOfReferenceUID: 'FOR-1',
        imagePositionPatient: [0, 0, z],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      });

      setMetadata({
        'imagePlaneModule|fine-0': axialPlane(0),
        'imagePlaneModule|fine-1': axialPlane(1),
        'imagePlaneModule|fine-2': axialPlane(2),
        'imagePlaneModule|fine-3': axialPlane(3),
        'imagePlaneModule|fine-4': axialPlane(4),
        'generalSeriesModule|fine-0': { seriesInstanceUID: 'SER-FINE' },
        'imagePlaneModule|coarse-0': axialPlane(0),
        'imagePlaneModule|coarse-1': axialPlane(2),
        'imagePlaneModule|coarse-2': axialPlane(4),
        'imagePlaneModule|coarse-3': axialPlane(6),
        'imagePlaneModule|coarse-4': axialPlane(8),
        'generalSeriesModule|coarse-0': { seriesInstanceUID: 'SER-COARSE' },
      });

      crosshairSyncService._markMetadataLoaded('panel_1');
      getViewportForPanelMock.mockReturnValue({ jumpToWorld: vi.fn(() => false) });

      // Click at z=3 in fine scan → nearest coarse slice is z=2 (index 1) or z=4 (index 2)
      crosshairSyncService.syncFromViewport('panel_0', [0, 0, 3]);

      const targetIndex = viewerStoreMock.getState().viewports.panel_1?.requestedImageIndex;
      // z=3 is equidistant from z=2 (index 1) and z=4 (index 2); first match wins → index 1
      expect(targetIndex).toBe(1);
      expect(scrollToIndexMock).toHaveBeenCalledWith('panel_1', 1);
    });

    it('selects the nearest slice when target scan has finer spacing than source', () => {
      // Source: 5mm slices, Target: 1mm slices
      viewerStoreMock.setState({
        panelImageIdsMap: {
          panel_0: ['thick-0', 'thick-1'],
          panel_1: ['thin-0', 'thin-1', 'thin-2', 'thin-3', 'thin-4', 'thin-5', 'thin-6', 'thin-7', 'thin-8', 'thin-9', 'thin-10'],
        },
      });

      const axialPlane = (z: number): PlaneMeta => ({
        frameOfReferenceUID: 'FOR-1',
        imagePositionPatient: [0, 0, z],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      });

      const meta: Record<string, unknown> = {
        'generalSeriesModule|thick-0': { seriesInstanceUID: 'SER-THICK' },
        'generalSeriesModule|thin-0': { seriesInstanceUID: 'SER-THIN' },
      };
      meta['imagePlaneModule|thick-0'] = axialPlane(0);
      meta['imagePlaneModule|thick-1'] = axialPlane(5);
      for (let i = 0; i <= 10; i++) {
        meta[`imagePlaneModule|thin-${i}`] = axialPlane(i);
      }
      setMetadata(meta);

      crosshairSyncService._markMetadataLoaded('panel_1');
      getViewportForPanelMock.mockReturnValue({ jumpToWorld: vi.fn(() => false) });

      // Click at z=5 (thick-1) → target should land on thin-5 (z=5, index 5)
      crosshairSyncService.syncFromViewport('panel_0', [0, 0, 5]);

      expect(viewerStoreMock.getState().viewports.panel_1?.requestedImageIndex).toBe(5);
      expect(scrollToIndexMock).toHaveBeenCalledWith('panel_1', 5);
    });

    it('handles non-axial (sagittal) orientation with different slice counts', () => {
      // Sagittal slices: varying along X axis
      viewerStoreMock.setState({
        panelImageIdsMap: {
          panel_0: ['sag-src-0', 'sag-src-1', 'sag-src-2'],
          panel_1: ['sag-tgt-0', 'sag-tgt-1', 'sag-tgt-2', 'sag-tgt-3', 'sag-tgt-4'],
        },
      });

      const sagittalPlane = (x: number): PlaneMeta => ({
        frameOfReferenceUID: 'FOR-1',
        imagePositionPatient: [x, 0, 0],
        // Sagittal: row=Y, col=Z → normal=X
        imageOrientationPatient: [0, 1, 0, 0, 0, 1],
      });

      const meta: Record<string, unknown> = {
        'generalSeriesModule|sag-src-0': { seriesInstanceUID: 'SER-SAG-SRC' },
        'generalSeriesModule|sag-tgt-0': { seriesInstanceUID: 'SER-SAG-TGT' },
        'imagePlaneModule|sag-src-0': sagittalPlane(0),
        'imagePlaneModule|sag-src-1': sagittalPlane(10),
        'imagePlaneModule|sag-src-2': sagittalPlane(20),
        'imagePlaneModule|sag-tgt-0': sagittalPlane(0),
        'imagePlaneModule|sag-tgt-1': sagittalPlane(5),
        'imagePlaneModule|sag-tgt-2': sagittalPlane(10),
        'imagePlaneModule|sag-tgt-3': sagittalPlane(15),
        'imagePlaneModule|sag-tgt-4': sagittalPlane(20),
      };
      setMetadata(meta);

      crosshairSyncService._markMetadataLoaded('panel_1');
      getViewportForPanelMock.mockReturnValue({ jumpToWorld: vi.fn(() => false) });

      // Click at world x=12 → nearest target slice is x=10 (index 2)
      crosshairSyncService.syncFromViewport('panel_0', [12, 0, 0]);

      expect(viewerStoreMock.getState().viewports.panel_1?.requestedImageIndex).toBe(2);
    });
  });

  describe('partial anatomic overlap', () => {
    it('navigates to the closest edge slice when click is beyond target scan coverage', () => {
      // Source covers z=0..100, target covers z=0..50
      viewerStoreMock.setState({
        panelImageIdsMap: {
          panel_0: ['wide-0', 'wide-1'],
          panel_1: ['short-0', 'short-1', 'short-2'],
        },
      });

      const axialPlane = (z: number): PlaneMeta => ({
        frameOfReferenceUID: 'FOR-1',
        imagePositionPatient: [0, 0, z],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      });

      setMetadata({
        'imagePlaneModule|wide-0': axialPlane(0),
        'imagePlaneModule|wide-1': axialPlane(100),
        'generalSeriesModule|wide-0': { seriesInstanceUID: 'SER-WIDE' },
        'imagePlaneModule|short-0': axialPlane(0),
        'imagePlaneModule|short-1': axialPlane(25),
        'imagePlaneModule|short-2': axialPlane(50),
        'generalSeriesModule|short-0': { seriesInstanceUID: 'SER-SHORT' },
      });

      crosshairSyncService._markMetadataLoaded('panel_1');
      getViewportForPanelMock.mockReturnValue({ jumpToWorld: vi.fn(() => false) });

      // Click at z=80, beyond the short scan's last slice at z=50
      crosshairSyncService.syncFromViewport('panel_0', [0, 0, 80]);

      // Should clamp to the nearest available slice: z=50 (index 2)
      expect(viewerStoreMock.getState().viewports.panel_1?.requestedImageIndex).toBe(2);
      expect(scrollToIndexMock).toHaveBeenCalledWith('panel_1', 2);
    });

    it('does not sync to a panel from a completely different frame of reference', () => {
      viewerStoreMock.setState({
        panelImageIdsMap: {
          panel_0: ['brain-0'],
          panel_1: ['knee-0'],
        },
      });

      setMetadata({
        'imagePlaneModule|brain-0': { frameOfReferenceUID: 'FOR-BRAIN' },
        'generalSeriesModule|brain-0': { seriesInstanceUID: 'SER-BRAIN' },
        'imagePlaneModule|knee-0': { frameOfReferenceUID: 'FOR-KNEE' },
        'generalSeriesModule|knee-0': { seriesInstanceUID: 'SER-KNEE' },
      });

      const targetViewport = { type: 'orthogonal', jumpToWorld: vi.fn(() => true), render: vi.fn() };
      getViewportForPanelMock.mockReturnValue(targetViewport);

      crosshairSyncService.syncFromViewport('panel_0', [0, 0, 50]);

      // Different body region → no sync
      expect(targetViewport.jumpToWorld).not.toHaveBeenCalled();
      expect(scrollToIndexMock).not.toHaveBeenCalled();
    });
  });

  describe('end-to-end pointer to store flow', () => {
    it('propagates world point from source click through sync to all compatible target panels', () => {
      // Set up a 3-panel layout: T1, T2 (same session), PET (different session)
      viewerStoreMock.setState({
        panelImageIdsMap: {
          panel_0: ['t1-0', 't1-1', 't1-2'],
          panel_1: ['t2-0', 't2-1', 't2-2'],
          panel_2: ['pet-0', 'pet-1'],
        },
      });

      const axialPlane = (z: number, forUid: string): PlaneMeta => ({
        frameOfReferenceUID: forUid,
        imagePositionPatient: [0, 0, z],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      });

      setMetadata({
        'imagePlaneModule|t1-0': axialPlane(0, 'FOR-MR'),
        'imagePlaneModule|t1-1': axialPlane(5, 'FOR-MR'),
        'imagePlaneModule|t1-2': axialPlane(10, 'FOR-MR'),
        'generalSeriesModule|t1-0': { seriesInstanceUID: 'SER-T1' },
        'imagePlaneModule|t2-0': axialPlane(0, 'FOR-MR'),
        'imagePlaneModule|t2-1': axialPlane(5, 'FOR-MR'),
        'imagePlaneModule|t2-2': axialPlane(10, 'FOR-MR'),
        'generalSeriesModule|t2-0': { seriesInstanceUID: 'SER-T2' },
        'imagePlaneModule|pet-0': axialPlane(0, 'FOR-PET'),
        'imagePlaneModule|pet-1': axialPlane(5, 'FOR-PET'),
        'generalSeriesModule|pet-0': { seriesInstanceUID: 'SER-PET' },
      });

      const vpT2 = {
        type: 'orthogonal',
        jumpToWorld: vi.fn(() => true),
        getCurrentImageIdIndex: vi.fn(() => 1),
        render: vi.fn(),
      };
      const vpPET = {
        type: 'orthogonal',
        jumpToWorld: vi.fn(() => true),
        getCurrentImageIdIndex: vi.fn(() => 0),
        render: vi.fn(),
      };
      getViewportForPanelMock.mockImplementation((panelId: string) => {
        if (panelId === 'panel_1') return vpT2;
        if (panelId === 'panel_2') return vpPET;
        return null;
      });

      crosshairSyncService.syncFromViewport('panel_0', [0, 0, 5]);

      const state = viewerStoreMock.getState();

      // Global crosshair state should be set
      expect(state.crosshairWorldPoint).toEqual([0, 0, 5]);
      expect(state.crosshairSourcePanelId).toBe('panel_0');

      // T2 (same FOR) should have synced
      expect(vpT2.jumpToWorld).toHaveBeenCalledWith([0, 0, 5]);
      expect(vpT2.render).toHaveBeenCalled();
      expect(state.viewports.panel_1?.requestedImageIndex).toBe(1);

      // PET (different FOR) should NOT have synced
      expect(vpPET.jumpToWorld).not.toHaveBeenCalled();
      expect(state.viewports.panel_2).toBeUndefined();
    });
  });
});
