import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SegmentationManager, type ManagerDeps } from './SegmentationManager';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';

const viewportReadyServiceMock = vi.hoisted(() => ({
  whenReady: vi.fn(async () => undefined),
  getEpoch: vi.fn(() => 1),
}));

const segmentationServiceMock = vi.hoisted(() => ({
  getPreferredDicomType: vi.fn(() => 'SEG' as const),
  ensureContourRepresentation: vi.fn(async () => undefined),
  addToViewport: vi.fn(async () => undefined),
  segmentationExists: vi.fn(() => true),
  beginSegLoad: vi.fn(),
  endSegLoad: vi.fn(),
  loadDicomSeg: vi.fn(async () => ({
    segmentationId: 'seg-loaded',
    firstNonZeroReferencedImageId: 'img-1',
  })),
  setLabel: vi.fn(),
  getViewportIdsForSegmentation: vi.fn(() => ['panel_0']),
  setActiveSegmentIndex: vi.fn(),
  activateOnViewport: vi.fn(),
  setSegmentColor: vi.fn(),
  notifyContainerDirty: vi.fn(),
  getSegmentVisibility: vi.fn(() => true),
  setSegmentVisibility: vi.fn(),
  toggleSegmentLocked: vi.fn(),
  getSegmentLocked: vi.fn((_segmentationId: string, _segmentIndex: number) => false),
  createStackSegmentation: vi.fn(async () => 'seg-new'),
  ensureEmptySegmentation: vi.fn(),
  createContourSegmentation: vi.fn(async () => 'rt-new'),
  addSegment: vi.fn(async () => 1),
  removeSegmentation: vi.fn(),
  removeSegment: vi.fn(),
  deleteSelectedContourComponents: vi.fn(() => false),
  renameSegmentation: vi.fn(),
  renameSegment: vi.fn(),
  exportToDicomSeg: vi.fn(async () => 'base64-dicom'),
  cancelAutoSave: vi.fn(),
  beginManualSave: vi.fn(),
  endManualSave: vi.fn(),
  suppressDirtyTrackingFor: vi.fn(),
  runWithDirtyTrackingSuppressed: vi.fn((fn: () => unknown) => fn()),
}));

const rtStructServiceMock = vi.hoisted(() => ({
  parseRtStruct: vi.fn(() => ({ referencedSeriesUID: null, rois: [] })),
  loadRtStructAsContours: vi.fn(async () => ({
    segmentationId: 'rt-loaded',
    firstReferencedImageId: 'img-1',
  })),
}));

type MockViewerState = {
  layoutConfig: { panelCount: number };
  panelScanMap: Record<string, string>;
  panelXnatContextMap: Record<string, any>;
  xnatContext: any;
  setActiveTool: ReturnType<typeof vi.fn>;
};

const mockViewerStore = vi.hoisted(() => {
  const setActiveTool = vi.fn();
  const initial: MockViewerState = {
    layoutConfig: { panelCount: 1 },
    panelScanMap: {},
    panelXnatContextMap: {},
    xnatContext: null,
    setActiveTool,
  };
  let state: MockViewerState = { ...initial };
  return {
    getInitialState: () => ({ ...initial }),
    reset: () => { setActiveTool.mockClear(); state = { ...initial }; },
    getState: () => state,
    setState: (next: Partial<MockViewerState>) => {
      state = { ...state, ...next };
    },
  };
});

vi.mock('../cornerstone/viewportReadyService', () => ({
  viewportReadyService: viewportReadyServiceMock,
}));

vi.mock('../cornerstone/segmentationService', () => ({
  segmentationService: segmentationServiceMock,
}));

vi.mock('../cornerstone/rtStructService', () => ({
  rtStructService: rtStructServiceMock,
}));

vi.mock('../../stores/viewerStore', () => ({
  useViewerStore: {
    getState: mockViewerStore.getState,
    setState: mockViewerStore.setState,
    getInitialState: mockViewerStore.getInitialState,
  },
}));

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeDeps(overrides: Partial<ManagerDeps> = {}): ManagerDeps {
  return {
    setPanelImageIds: vi.fn(),
    getPanelImageIds: vi.fn(() => ['img-1', 'img-2']),
    preloadImages: vi.fn(async () => undefined),
    downloadScanFile: vi.fn(async () => new ArrayBuffer(16)),
    getScanImageIds: vi.fn(async () => ['img-1', 'img-2']),
    ...overrides,
  };
}

function seedViewerPanelContext(): void {
  mockViewerStore.setState({
    layoutConfig: { panelCount: 4 },
    xnatContext: {
      projectId: 'P1',
      subjectId: 'S1',
      sessionId: 'SESS1',
      sessionLabel: 'Session 1',
      scanId: '10',
      serverUrl: 'https://xnat.example',
      username: 'dan',
    },
    panelXnatContextMap: {
      panel_0: {
        projectId: 'P1',
        subjectId: 'S1',
        sessionId: 'SESS1',
        sessionLabel: 'Session 1',
        scanId: '10',
        serverUrl: 'https://xnat.example',
        username: 'dan',
      },
      panel_1: {
        projectId: 'P1',
        subjectId: 'S1',
        sessionId: 'SESS1',
        sessionLabel: 'Session 1',
        scanId: '10',
        serverUrl: 'https://xnat.example',
        username: 'dan',
      },
    },
    panelScanMap: {
      panel_0: '10',
      panel_1: '10',
      panel_2: '99',
    },
  });
}

describe('SegmentationManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSegmentationManagerStore.setState(useSegmentationManagerStore.getInitialState(), true);
    useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
    mockViewerStore.reset();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  it('initializes, resets on dispose, and delegates segmentation existence checks', () => {
    const manager = new SegmentationManager();
    const deps = makeDeps();

    useSegmentationManagerStore.getState().setPanelSourceScan('panel_0', '10', 1);
    manager.initialize(deps);
    expect(manager.segmentationExists('seg-1')).toBe(true);
    expect(segmentationServiceMock.segmentationExists).toHaveBeenCalledWith('seg-1');

    manager.dispose();
    expect(useSegmentationManagerStore.getState().panelState).toEqual({});
  });

  it('waits for viewport readiness and falls back to timeout path', async () => {
    const manager = new SegmentationManager();
    viewportReadyServiceMock.whenReady.mockResolvedValueOnce(undefined);

    await manager.waitForPanelReady('panel_0');
    expect(viewportReadyServiceMock.getEpoch).toHaveBeenCalledWith('panel_0');
    expect(viewportReadyServiceMock.whenReady).toHaveBeenCalledWith('panel_0', 1);

    vi.useFakeTimers();
    viewportReadyServiceMock.whenReady.mockRejectedValueOnce(new Error('timeout'));
    const pending = manager.waitForPanelReady('panel_0', 7);
    await vi.runAllTimersAsync();
    await pending;
    vi.useRealTimers();
    expect(viewportReadyServiceMock.whenReady).toHaveBeenCalledWith('panel_0', 7);
  });

  it('resolves visible segmentation ids using loaded overlays, XNAT origin, and local origins', () => {
    const manager = new SegmentationManager();
    seedViewerPanelContext();

    useSegmentationManagerStore.setState({
      ...useSegmentationManagerStore.getState(),
      loadedBySourceScan: {
        'P1/SESS1/10': {
          '3010': { segmentationId: 'seg-loaded', loadedAt: 111 },
        },
      },
      localOriginBySegId: { 'seg-local': 'P1/SESS1/10' },
    });
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      xnatOriginMap: {
        'seg-origin': {
          scanId: '3010',
          sourceScanId: '10',
          projectId: 'P1',
          sessionId: 'SESS1',
        },
      },
    });

    const visible = manager.getVisibleSegmentationIdsForViewport('panel_0');
    expect(visible).toEqual(new Set(['seg-loaded', 'seg-origin', 'seg-local']));

    mockViewerStore.setState({
      panelScanMap: { ...mockViewerStore.getState().panelScanMap, panel_0: '' },
    });
    expect(manager.getVisibleSegmentationIdsForViewport('panel_0')).toBeNull();
  });

  it('ensures attach + activate on user selection and normalizes invalid segment index', async () => {
    const manager = new SegmentationManager();
    seedViewerPanelContext();
    segmentationServiceMock.getViewportIdsForSegmentation.mockReturnValue([]);
    manager.initialize(makeDeps());

    manager.userSelectedSegmentation('panel_0', 'seg-1', Number.NaN as unknown as number);
    await flushPromises();

    expect(useSegmentationStore.getState().activeSegmentationId).toBe('seg-1');
    expect(segmentationServiceMock.addToViewport).toHaveBeenCalledWith('panel_0', 'seg-1');
    expect(segmentationServiceMock.setActiveSegmentIndex).toHaveBeenCalledWith('seg-1', 1);
    expect(segmentationServiceMock.activateOnViewport).toHaveBeenCalledWith('panel_0', 'seg-1');
  });

  it('toggles visibility across all attached viewports and persists presentation state', () => {
    const manager = new SegmentationManager();
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      segmentations: [
        {
          segmentationId: 'seg-1',
          label: 'Seg 1',
          isActive: true,
          segments: [{ segmentIndex: 1, label: 'A', color: [255, 0, 0, 255], visible: true, locked: false }],
        },
      ],
    });
    segmentationServiceMock.getViewportIdsForSegmentation.mockReturnValue(['panel_0', 'panel_1']);

    manager.userToggledVisibility('panel_0', 'seg-1', 1);
    expect(segmentationServiceMock.setSegmentVisibility).toHaveBeenCalledWith('panel_0', 'seg-1', 1, false);
    expect(segmentationServiceMock.setSegmentVisibility).toHaveBeenCalledWith('panel_1', 'seg-1', 1, false);
    expect(useSegmentationManagerStore.getState().presentation['seg-1']?.visibility[1]).toBe(false);
  });

  it('persists a color change AND marks the container dirty so the new color is re-saved (round-trips to the DICOM SEG, not reverting on reload)', () => {
    const manager = new SegmentationManager();
    const newColor: [number, number, number, number] = [12, 34, 56, 255];

    manager.userChangedSegmentColor('seg-1', 2, newColor);

    // Applies to Cornerstone + caches in presentation state (cross-recreation).
    expect(segmentationServiceMock.setSegmentColor).toHaveBeenCalledWith('seg-1', 2, newColor);
    expect(useSegmentationManagerStore.getState().presentation['seg-1']?.color[2]).toEqual(newColor);

    // The actual fix: a color change is a real edit → container dirty + queued for
    // save, so export writes the new RecommendedDisplayCIELabValue. Without this the
    // color reverts to the file's saved value on reload.
    expect(useSegmentationManagerStore.getState().dirtySegIds['seg-1']).toBe(true);
    expect(segmentationServiceMock.notifyContainerDirty).toHaveBeenCalledWith('seg-1');
  });

  it('hides/shows ALL members across viewports and persists each into presentation (kebab Hide all)', () => {
    const manager = new SegmentationManager();
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      segmentations: [
        {
          segmentationId: 'seg-1',
          label: 'Seg 1',
          isActive: true,
          segments: [
            { segmentIndex: 1, label: 'A', color: [255, 0, 0, 255], visible: true, locked: false },
            { segmentIndex: 2, label: 'B', color: [0, 255, 0, 255], visible: true, locked: false },
          ],
        },
      ],
    });
    segmentationServiceMock.getViewportIdsForSegmentation.mockReturnValue(['panel_0', 'panel_1']);

    manager.setAllMembersVisible('seg-1', false);

    // Applied to every (segment × viewport) pair.
    expect(segmentationServiceMock.setSegmentVisibility).toHaveBeenCalledWith('panel_0', 'seg-1', 1, false);
    expect(segmentationServiceMock.setSegmentVisibility).toHaveBeenCalledWith('panel_1', 'seg-1', 2, false);
    expect(segmentationServiceMock.setSegmentVisibility).toHaveBeenCalledTimes(4);
    expect(useSegmentationManagerStore.getState().presentation['seg-1']?.visibility[1]).toBe(false);
    expect(useSegmentationManagerStore.getState().presentation['seg-1']?.visibility[2]).toBe(false);
  });

  it('locks ALL members (toggling only those whose state differs) and persists into presentation (kebab Lock all)', () => {
    const manager = new SegmentationManager();
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      segmentations: [
        {
          segmentationId: 'seg-1',
          label: 'Seg 1',
          isActive: true,
          segments: [
            { segmentIndex: 1, label: 'A', color: [255, 0, 0, 255], visible: true, locked: false },
            { segmentIndex: 2, label: 'B', color: [0, 255, 0, 255], visible: true, locked: false },
          ],
        },
      ],
    });
    // segment 1 already locked, segment 2 unlocked → only segment 2 needs a toggle.
    segmentationServiceMock.getSegmentLocked.mockImplementation((_id: string, idx: number) => idx === 1);

    manager.setAllMembersLocked('seg-1', true);

    expect(segmentationServiceMock.toggleSegmentLocked).toHaveBeenCalledTimes(1);
    expect(segmentationServiceMock.toggleSegmentLocked).toHaveBeenCalledWith('seg-1', 2);
    expect(useSegmentationManagerStore.getState().presentation['seg-1']?.locked[1]).toBe(true);
    expect(useSegmentationManagerStore.getState().presentation['seg-1']?.locked[2]).toBe(true);
  });

  it('toggles lock state, persists state, and deactivates Cornerstone tool when locking active segment', () => {
    const manager = new SegmentationManager();
    segmentationServiceMock.getSegmentLocked.mockReturnValueOnce(true);

    // Set up: seg-1 segment 3 is active with a brush tool selected
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegmentationId: 'seg-1',
      activeSegmentIndex: 3,
      activeSegTool: 'Brush',
    });

    manager.userToggledLock('seg-1', 3);
    expect(segmentationServiceMock.toggleSegmentLocked).toHaveBeenCalledWith('seg-1', 3);
    expect(useSegmentationManagerStore.getState().presentation['seg-1']?.locked[3]).toBe(true);
    expect(mockViewerStore.getState().setActiveTool).toHaveBeenCalledWith('WindowLevel');
  });

  it('deactivates tool when selecting a locked segment', () => {
    const manager = new SegmentationManager();
    segmentationServiceMock.getSegmentLocked.mockReturnValue(true);
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegTool: 'Brush',
    });

    manager.userSelectedSegmentation('panel_0', 'seg-1', 1);
    expect(mockViewerStore.getState().setActiveTool).toHaveBeenCalledWith('WindowLevel');
  });

  it('deactivates labelmap tool when switching to a contour segmentation', () => {
    const manager = new SegmentationManager();
    segmentationServiceMock.getSegmentLocked.mockReturnValue(false);
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegTool: 'Brush',
      dicomTypeBySegmentationId: { 'rt-1': 'RTSTRUCT' },
    });

    manager.userSelectedSegmentation('panel_0', 'rt-1', 1);
    expect(mockViewerStore.getState().setActiveTool).toHaveBeenCalledWith('WindowLevel');
  });

  it('deactivates contour tool when switching to a labelmap segmentation', () => {
    const manager = new SegmentationManager();
    segmentationServiceMock.getSegmentLocked.mockReturnValue(false);
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegTool: 'FreehandContour',
      dicomTypeBySegmentationId: { 'seg-1': 'SEG' },
    });

    manager.userSelectedSegmentation('panel_0', 'seg-1', 1);
    expect(mockViewerStore.getState().setActiveTool).toHaveBeenCalledWith('WindowLevel');
  });

  it('deactivates editing when switching from an unlocked annotation to a locked annotation', () => {
    const manager = new SegmentationManager();
    segmentationServiceMock.getSegmentLocked.mockImplementation((segmentationId: string) => segmentationId === 'rt-2');

    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegmentationId: 'rt-1',
      activeSegmentIndex: 1,
      activeSegTool: 'FreehandContour',
      dicomTypeBySegmentationId: {
        'rt-1': 'RTSTRUCT',
        'rt-2': 'RTSTRUCT',
      },
      segmentations: [
        {
          segmentationId: 'rt-1',
          label: 'RT 1',
          isActive: true,
          segments: [{ segmentIndex: 1, label: 'A', color: [255, 0, 0, 255], visible: true, locked: false }],
        },
        {
          segmentationId: 'rt-2',
          label: 'RT 2',
          isActive: false,
          segments: [{ segmentIndex: 1, label: 'B', color: [0, 255, 0, 255], visible: true, locked: true }],
        },
      ],
    });

    manager.userSelectedSegmentation('panel_0', 'rt-2', 1);

    expect(mockViewerStore.getState().setActiveTool).toHaveBeenCalledWith('WindowLevel');
  });

  it('creates new segmentations/structures and records local origins', async () => {
    const manager = new SegmentationManager();
    seedViewerPanelContext();

    const segId = await manager.createNewSegmentation('panel_0', ['img-1'], 'My SEG', true);
    expect(segId).toBe('seg-new');
    expect(segmentationServiceMock.createStackSegmentation).toHaveBeenCalledWith(['img-1'], 'My SEG', false);
    expect(segmentationServiceMock.addToViewport).toHaveBeenCalledWith('panel_0', 'seg-new');
    expect(segmentationServiceMock.ensureEmptySegmentation).toHaveBeenCalledWith('seg-new');
    expect(segmentationServiceMock.addSegment).toHaveBeenCalledWith('seg-new', 'Segment 1');
    expect(useSegmentationStore.getState().dicomTypeBySegmentationId['seg-new']).toBe('SEG');
    expect(useSegmentationManagerStore.getState().localOriginBySegId['seg-new']).toBe('P1/SESS1/10');

    const rtId = await manager.createNewStructure('panel_0', ['img-1'], 'My RT');
    expect(rtId).toBe('rt-new');
    expect(segmentationServiceMock.createContourSegmentation).toHaveBeenCalledWith(['img-1'], 'My RT', false);
    expect(segmentationServiceMock.ensureContourRepresentation).toHaveBeenCalledWith('panel_0', 'rt-new');
    expect(useSegmentationStore.getState().dicomTypeBySegmentationId['rt-new']).toBe('RTSTRUCT');
  });

  it('loads overlays for a source scan, tracks status, applies default visibility, and clears active edit context', async () => {
    const manager = new SegmentationManager();
    seedViewerPanelContext();
    const deps = makeDeps();
    manager.initialize(deps);

    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      segmentations: [
        {
          segmentationId: 'seg-loaded',
          label: 'SEG',
          isActive: true,
          segments: [{ segmentIndex: 1, label: 'A', color: [255, 0, 0, 255], visible: true, locked: false }],
        },
        {
          segmentationId: 'rt-loaded',
          label: 'RT',
          isActive: false,
          segments: [{ segmentIndex: 1, label: 'B', color: [0, 255, 0, 255], visible: true, locked: false }],
        },
      ],
    });

    await manager.requestShowOverlaysForSourceScan(
      'panel_0',
      '10',
      [
        { type: 'SEG', scanId: '3010', sessionId: 'SESS1', label: 'Liver' },
        { type: 'RTSTRUCT', scanId: '4010', sessionId: 'SESS1', label: 'Contour' },
      ],
      { defaultVisibility: 'hidden' },
    );

    expect(deps.downloadScanFile).toHaveBeenCalledTimes(2);
    expect(segmentationServiceMock.loadDicomSeg).toHaveBeenCalledTimes(1);
    expect(rtStructServiceMock.parseRtStruct).toHaveBeenCalledTimes(1);
    expect(rtStructServiceMock.loadRtStructAsContours).toHaveBeenCalledTimes(1);
    expect(useSegmentationStore.getState().dicomTypeBySegmentationId).toMatchObject({
      'seg-loaded': 'SEG',
      'rt-loaded': 'RTSTRUCT',
    });
    expect(useSegmentationStore.getState().activeSegmentationId).toBeNull();
    expect(useSegmentationStore.getState().activeSegTool).toBeNull();

    const statuses = useSegmentationManagerStore.getState().loadStatus;
    expect(statuses['3010']).toBe('loaded');
    expect(statuses['4010']).toBe('loaded');
    expect(segmentationServiceMock.setSegmentVisibility).toHaveBeenCalled();
  });

  it('marks overlay load failures as error without throwing', async () => {
    const manager = new SegmentationManager();
    seedViewerPanelContext();
    const deps = makeDeps({
      downloadScanFile: vi.fn(async () => {
        throw new Error('download failed');
      }),
    });
    manager.initialize(deps);

    await manager.requestShowOverlaysForSourceScan('panel_0', '10', [
      { type: 'SEG', scanId: '3010', sessionId: 'SESS1' },
    ]);

    expect(useSegmentationManagerStore.getState().loadStatus['3010']).toBe('error');
  });

  it('loads SEG and RTSTRUCT from array buffers with readiness and cleanup semantics', async () => {
    const manager = new SegmentationManager();
    seedViewerPanelContext();
    const deps = makeDeps();
    manager.initialize(deps);

    const segResult = await manager.loadSegFromArrayBuffer('panel_0', new ArrayBuffer(8), ['img-1'], {
      label: 'Loaded SEG',
      epoch: 3,
    });
    expect(segResult).toEqual({
      segmentationId: 'seg-loaded',
      firstNonZeroReferencedImageId: 'img-1',
    });
    expect(viewportReadyServiceMock.whenReady).toHaveBeenCalledWith('panel_0', 3);
    expect(segmentationServiceMock.beginSegLoad).toHaveBeenCalled();
    expect(segmentationServiceMock.endSegLoad).toHaveBeenCalled();
    expect(segmentationServiceMock.setLabel).toHaveBeenCalledWith('seg-loaded', 'Loaded SEG');

    const rtResult = await manager.loadRtStructFromArrayBuffer('panel_0', new ArrayBuffer(8), ['img-1'], {
      label: 'Loaded RT',
      epoch: 4,
    });
    expect(rtResult).toEqual({
      segmentationId: 'rt-loaded',
      firstReferencedImageId: 'img-1',
    });
    expect(rtStructServiceMock.parseRtStruct).toHaveBeenCalled();
    expect(rtStructServiceMock.loadRtStructAsContours).toHaveBeenCalledWith(
      expect.any(Object),
      ['img-1'],
      'panel_0',
    );
    expect(segmentationServiceMock.setLabel).toHaveBeenCalledWith('rt-loaded', 'Loaded RT');
  });

  describe('applySessionSwitch (A13 retention, Change 1c)', () => {
    function seed(opts: {
      from: string;
      segs: Array<{ id: string; sessionId?: string; dirty?: boolean }>;
    }) {
      mockViewerStore.setState({ xnatContext: { sessionId: opts.from } as never });
      useSegmentationStore.setState({
        segmentations: opts.segs.map((s) => ({ segmentationId: s.id, label: s.id, segments: [] })) as never,
        xnatOriginMap: Object.fromEntries(
          opts.segs.filter((s) => s.sessionId).map((s) => [s.id, { scanId: '3001', sourceScanId: '4', projectId: 'P', sessionId: s.sessionId }]),
        ) as never,
      });
      useSegmentationManagerStore.setState({
        dirtySegIds: Object.fromEntries(opts.segs.filter((s) => s.dirty).map((s) => [s.id, true])),
      });
    }

    it('keeps target-session, retains dirty other-session, unloads only clean other-session', () => {
      seed({
        from: 'S1',
        segs: [
          { id: 'newB', sessionId: 'S2' },           // target session → keep
          { id: 'oldClean', sessionId: 'S1' },        // other session, clean → unload
          { id: 'oldDirty', sessionId: 'S1', dirty: true }, // other session, dirty → retain
        ],
      });
      const manager = new SegmentationManager();
      const decisions = manager.applySessionSwitch('S2');

      const by = Object.fromEntries(decisions.map((d) => [d.containerId, d.disposition]));
      expect(by).toEqual({ newB: 'keep', oldClean: 'unload', oldDirty: 'retain-unsaved' });
      // Only the clean other-session container is actually removed.
      expect(segmentationServiceMock.removeSegmentation).toHaveBeenCalledTimes(1);
      expect(segmentationServiceMock.removeSegmentation).toHaveBeenCalledWith('oldClean');
      expect(segmentationServiceMock.removeSegmentation).not.toHaveBeenCalledWith('oldDirty');
      expect(segmentationServiceMock.removeSegmentation).not.toHaveBeenCalledWith('newB');
    });

    it('retains a dirty never-saved (no-XNAT-origin) container — treated as the current session', () => {
      seed({ from: 'S1', segs: [{ id: 'localDirty', dirty: true }] }); // no sessionId → current session
      const manager = new SegmentationManager();
      const decisions = manager.applySessionSwitch('S2');
      expect(decisions[0]).toEqual({ containerId: 'localDirty', disposition: 'retain-unsaved' });
      expect(segmentationServiceMock.removeSegmentation).not.toHaveBeenCalled();
    });
  });
});
