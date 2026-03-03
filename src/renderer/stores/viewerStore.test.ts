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
});
