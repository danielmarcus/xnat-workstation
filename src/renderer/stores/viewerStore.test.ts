import type { XnatUploadContext } from '@shared/types/xnat';
import { ToolName } from '@shared/types/viewer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  viewportService: {
    setVOI: vi.fn(),
    resetCamera: vi.fn(),
    setInvert: vi.fn(),
    rotate90: vi.fn(),
    getRotation: vi.fn(() => 90),
    flipH: vi.fn(),
    flipV: vi.fn(),
    getFlipState: vi.fn(() => ({ flipH: true, flipV: false })),
    scroll: vi.fn(),
  },
  toolService: {
    setActiveTool: vi.fn(),
  },
  volumeService: {
    destroy: vi.fn(),
  },
  mprToolService: {
    initialize: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock('../lib/cornerstone/viewportService', () => ({
  viewportService: mocked.viewportService,
}));

vi.mock('../lib/cornerstone/toolService', () => ({
  toolService: mocked.toolService,
}));

vi.mock('../lib/cornerstone/volumeService', () => ({
  volumeService: mocked.volumeService,
  generateVolumeId: () => 'generated-volume-id',
}));

vi.mock('../lib/cornerstone/mprToolService', () => ({
  mprToolService: mocked.mprToolService,
}));

import { useViewerStore } from './viewerStore';

function resetStore(): void {
  useViewerStore.getState().stopAllCine();
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  vi.clearAllMocks();
}

function context(scanId: string, sessionLabel: string): XnatUploadContext {
  return {
    projectId: 'P1',
    subjectId: 'S1',
    sessionId: 'E1',
    sessionLabel,
    scanId,
  };
}

describe('useViewerStore', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    useViewerStore.getState().stopAllCine();
    vi.useRealTimers();
  });

  it('setCustomLayout clamps dimensions and prunes panel-scoped maps', () => {
    const store = useViewerStore.getState();
    store.setCustomLayout(2, 2);
    store.setPanelScan('panel_3', '300');
    store.setPanelSessionLabel('panel_3', 'Session-300');
    store.setPanelSubjectLabel('panel_3', 'Subject-300');
    store.setPanelImageIds('panel_3', ['a', 'b']);

    useViewerStore.getState().setCustomLayout(0, 9);

    const state = useViewerStore.getState();
    expect(state.layout).toBe('custom');
    expect(state.layoutConfig).toEqual({ rows: 1, cols: 8, panelCount: 8 });
    expect(state.panelScanMap.panel_3).toBe('300');

    useViewerStore.getState().setCustomLayout(1, 1);
    expect(useViewerStore.getState().layoutConfig).toEqual({ rows: 1, cols: 1, panelCount: 1 });
    expect(useViewerStore.getState().panelScanMap.panel_3).toBeUndefined();
    expect(useViewerStore.getState().panelSessionLabelMap.panel_3).toBeUndefined();
    expect(useViewerStore.getState().panelSubjectLabelMap.panel_3).toBeUndefined();
    expect(useViewerStore.getState().panelImageIdsMap.panel_3).toBeUndefined();
  });

  it('setActiveViewport syncs xnatContext from panel mappings', () => {
    useViewerStore.getState().setXnatContext(context('10', 'Session-10'));
    useViewerStore.getState().setPanelXnatContext('panel_1', context('11', 'Session-11'));
    useViewerStore.getState().setActiveViewport('panel_1');
    expect(useViewerStore.getState().xnatContext).toEqual(context('11', 'Session-11'));

    useViewerStore.getState().setXnatContext(context('20', 'Session-20'));
    useViewerStore.getState().setPanelScan('panel_2', '21');
    useViewerStore.getState().setPanelSessionLabel('panel_2', 'Session-21');
    useViewerStore.getState().setActiveViewport('panel_2');

    expect(useViewerStore.getState().xnatContext).toEqual({
      ...context('20', 'Session-20'),
      scanId: '21',
      sessionLabel: 'Session-21',
    });
  });

  it('updates requested image index with clamping and clears satisfied requests', () => {
    useViewerStore.getState()._initPanel('panel_0');
    useViewerStore.getState()._updateImageIndex('panel_0', 2, 10);

    useViewerStore.getState()._requestImageIndex('panel_0', 20);
    expect(useViewerStore.getState().viewports.panel_0?.requestedImageIndex).toBe(9);

    useViewerStore.getState()._requestImageIndex('panel_0', 2);
    expect(useViewerStore.getState().viewports.panel_0?.requestedImageIndex).toBeNull();

    useViewerStore.getState()._requestImageIndex('panel_0', 7.5);
    expect(useViewerStore.getState().viewports.panel_0?.requestedImageIndex).toBeNull();

    useViewerStore.getState()._requestImageIndex('panel_0', 7);
    expect(useViewerStore.getState().viewports.panel_0?.requestedImageIndex).toBe(7);

    useViewerStore.getState()._updateImageIndex('panel_0', 7, 10);
    expect(useViewerStore.getState().viewports.panel_0?.requestedImageIndex).toBeNull();
  });

  it('toggles cine deterministically and stops emitting scroll after stop', () => {
    vi.useFakeTimers();
    useViewerStore.getState()._initPanel('panel_0');
    useViewerStore.getState().setCineFps(20);

    useViewerStore.getState().toggleCine();
    expect(useViewerStore.getState().cineStates.panel_0?.isPlaying).toBe(true);

    vi.advanceTimersByTime(500);
    expect(mocked.viewportService.scroll).toHaveBeenCalled();
    const callsWhilePlaying = mocked.viewportService.scroll.mock.calls.length;

    useViewerStore.getState().stopCine('panel_0');
    expect(useViewerStore.getState().cineStates.panel_0?.isPlaying).toBe(false);

    vi.advanceTimersByTime(500);
    expect(mocked.viewportService.scroll).toHaveBeenCalledTimes(callsWhilePlaying);
  });

  it('invokes tool service when changing active tool', () => {
    useViewerStore.getState().setActiveTool(ToolName.Pan);
    expect(useViewerStore.getState().activeTool).toBe(ToolName.Pan);
    expect(mocked.toolService.setActiveTool).toHaveBeenCalledWith(ToolName.Pan);
  });

  it('setLayout prunes removed panel maps and keeps active context in sync', () => {
    const store = useViewerStore.getState();
    store.setCustomLayout(2, 2);
    store.setPanelScan('panel_1', '11');
    store.setPanelSessionLabel('panel_1', 'S-11');
    store.setPanelSubjectLabel('panel_1', 'SUBJ-11');
    store.setPanelImageIds('panel_1', ['i1']);
    store.setPanelOrientation('panel_1', 'AXIAL');
    store.setPanelNativeOrientation('panel_1', 'CORONAL');
    store.setPanelXnatContext('panel_1', context('11', 'Session-11'));
    store.setActiveViewport('panel_1');

    useViewerStore.getState().setLayout('1x1');
    const next = useViewerStore.getState();
    expect(next.activeViewportId).toBe('panel_0');
    expect(next.layout).toBe('1x1');
    expect(next.layoutConfig.panelCount).toBe(1);
    expect(next.panelScanMap.panel_1).toBeUndefined();
    expect(next.panelSessionLabelMap.panel_1).toBeUndefined();
    expect(next.panelSubjectLabelMap.panel_1).toBeUndefined();
    expect(next.panelImageIdsMap.panel_1).toBeUndefined();
    expect(next.panelOrientationMap.panel_1).toBeUndefined();
    expect(next.panelNativeOrientationMap.panel_1).toBeUndefined();
  });

  it('applies viewport actions and keeps state synchronized', () => {
    useViewerStore.getState()._initPanel('panel_0');
    useViewerStore.getState().applyWLPreset({ name: 'Soft', window: 400, level: 40 });
    expect(mocked.viewportService.setVOI).toHaveBeenCalledWith('panel_0', 400, 40);

    useViewerStore.getState().toggleInvert();
    expect(mocked.viewportService.setInvert).toHaveBeenCalledWith('panel_0', true);
    expect(useViewerStore.getState().viewports.panel_0?.invert).toBe(true);

    useViewerStore.getState().rotate90();
    expect(mocked.viewportService.rotate90).toHaveBeenCalledWith('panel_0');
    expect(useViewerStore.getState().viewports.panel_0?.rotation).toBe(90);

    useViewerStore.getState().flipH();
    expect(mocked.viewportService.flipH).toHaveBeenCalledWith('panel_0');
    expect(useViewerStore.getState().viewports.panel_0?.flipH).toBe(true);

    useViewerStore.getState().flipV();
    expect(mocked.viewportService.flipV).toHaveBeenCalledWith('panel_0');
    expect(useViewerStore.getState().viewports.panel_0?.flipV).toBe(false);

    useViewerStore.getState().resetViewport();
    expect(mocked.viewportService.resetCamera).toHaveBeenCalledWith('panel_0');
    expect(useViewerStore.getState().viewports.panel_0).toMatchObject({
      rotation: 0,
      flipH: false,
      flipV: false,
      invert: false,
    });
  });

  it('enters and exits MPR while restoring prior state and scheduling volume cleanup', () => {
    vi.useFakeTimers();
    const store = useViewerStore.getState();
    store.setLayout('2x2');
    store.setActiveTool(ToolName.Zoom);
    store.setActiveViewport('panel_2');

    store.enterMPR('panel_2', 'vol-123');
    let state = useViewerStore.getState();
    expect(state.mprActive).toBe(true);
    expect(state.mprVolumeId).toBe('vol-123');
    expect(state.mprSourcePanelId).toBe('panel_2');
    expect(state.mprPriorState).toMatchObject({
      layout: '2x2',
      activeViewportId: 'panel_2',
      activeTool: ToolName.Zoom,
    });
    expect(mocked.mprToolService.initialize).toHaveBeenCalledTimes(1);

    store.exitMPR();
    state = useViewerStore.getState();
    expect(state.mprActive).toBe(false);
    expect(state.mprVolumeId).toBeNull();
    expect(state.layout).toBe('2x2');
    expect(state.activeTool).toBe(ToolName.Zoom);
    expect(mocked.mprToolService.destroy).toHaveBeenCalledTimes(1);
    expect(mocked.toolService.setActiveTool).toHaveBeenCalledWith(ToolName.Zoom);

    vi.advanceTimersByTime(99);
    expect(mocked.volumeService.destroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mocked.volumeService.destroy).toHaveBeenCalledWith('vol-123');
  });

  it('handles internal panel/update helpers and no-op branches safely', () => {
    const store = useViewerStore.getState();
    store._initPanel('panel_0');
    store._updateVOI('panel_0', 401.4, 38.7);
    store._updateImageDimensions('panel_0', 512, 256);
    store._updateZoom('panel_0', 125);
    store._updateImageIndex('panel_0', 3, 12);
    store._requestImageIndex('panel_0', 3);
    store._requestImageIndex('panel_0', Number.NaN);
    store._requestImageIndex('panel_0', 7);
    store._updateImageIndex('panel_0', 7, 12);
    store._updateMPRSlice('panel_0', 10, 100);
    store._updateMPRSlice('panel_0', 10, 100);
    store._updateMPRVolumeProgress({ loaded: 1, total: 2, percent: 50 });
    store.setCrosshairWorldPoint([1, 2, 3], 'panel_0');

    const state = useViewerStore.getState();
    expect(state.viewports.panel_0).toMatchObject({
      windowWidth: 401,
      windowCenter: 39,
      imageWidth: 512,
      imageHeight: 256,
      zoomPercent: 125,
      imageIndex: 7,
      requestedImageIndex: null,
      totalImages: 12,
    });
    expect(state.mprViewports.panel_0).toMatchObject({ sliceIndex: 10, totalSlices: 100 });
    expect(state.mprVolumeProgress).toMatchObject({ percent: 50 });
    expect(state.crosshairWorldPoint).toEqual([1, 2, 3]);
    expect(state.crosshairSourcePanelId).toBe('panel_0');

    store._destroyPanel('panel_0');
    expect(useViewerStore.getState().viewports.panel_0).toBeUndefined();
    expect(useViewerStore.getState().cineStates.panel_0).toBeUndefined();
  });
});
