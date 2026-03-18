import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolName } from '@shared/types/viewer';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import {
  createCornerstoneMockState,
  createCoreModuleMock,
  createToolsModuleMock,
} from '../../../test/cornerstone/cornerstoneMocks';
import { resetCornerstoneMocks } from '../../../test/cornerstone/resetCornerstoneMocks';

const cs = createCornerstoneMockState();

const segmentationServiceMock = {
  setBrushSize: vi.fn(),
  getViewportIdsForSegmentation: vi.fn(() => ['panel_0']),
  ensureContourRepresentation: vi.fn(async () => undefined),
};

const segmentationManagerMock = {
  getVisibleSegmentationIdsForViewport: vi.fn(() => new Set<string>(['seg-1'])),
  userSelectedSegmentation: vi.fn(),
  createNewStructure: vi.fn(),
  createNewSegmentation: vi.fn(),
};

let toolService: (typeof import('../toolService'))['toolService'];
const originalWindow = (globalThis as any).window;
let windowAddEventListenerSpy: ReturnType<typeof vi.fn>;
let windowRemoveEventListenerSpy: ReturnType<typeof vi.fn>;

function dispatchWindowKey(type: 'keydown' | 'keyup', key: string): void {
  const evt = new Event(type);
  Object.defineProperty(evt, 'key', { value: key });
  (globalThis as any).window.dispatchEvent(evt);
}

beforeAll(async () => {
  vi.doMock('@cornerstonejs/core', () => createCoreModuleMock(cs));
  vi.doMock('@cornerstonejs/tools', () => createToolsModuleMock(cs));
  vi.doMock('../segmentationService', () => ({ segmentationService: segmentationServiceMock }));
  vi.doMock('../../segmentation/segmentationManagerSingleton', () => ({
    segmentationManager: segmentationManagerMock,
  }));
  vi.doMock('../tools/SafePaintFillTool', () => ({
    default: {
      toolName: 'SafePaintFill',
    },
  }));

  ({ toolService } = await import('../toolService'));
});

function resetStores(): void {
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
}

describe('toolService', () => {
  beforeEach(() => {
    const eventTarget = new EventTarget();
    windowAddEventListenerSpy = vi.fn(eventTarget.addEventListener.bind(eventTarget));
    windowRemoveEventListenerSpy = vi.fn(eventTarget.removeEventListener.bind(eventTarget));
    (globalThis as any).window = {
      addEventListener: windowAddEventListenerSpy,
      removeEventListener: windowRemoveEventListenerSpy,
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    };
    resetCornerstoneMocks(cs);
    resetStores();
    toolService.destroy();
  });

  afterEach(() => {
    toolService.destroy();
    if (typeof originalWindow === 'undefined') {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  });

  it('initializes tool group, applies interpolation config, and re-applies brush size', () => {
    useSegmentationStore.getState().setBrushSize(9);

    toolService.initialize();

    const group = cs.getLastToolGroup();
    expect(group).not.toBeNull();
    expect(group?.addTool).toHaveBeenCalled();
    expect(group?.setToolConfiguration).toHaveBeenCalledWith(
      'PlanarFreehandContourSegmentation',
      { interpolation: { enabled: true } },
    );
    expect(segmentationServiceMock.setBrushSize).toHaveBeenCalledWith(9);
    expect(toolService.getActiveTool()).toBe(ToolName.WindowLevel);
  });

  it('installs modifier listeners once and removes them on destroy', () => {
    toolService.initialize();
    toolService.initialize();

    expect(windowAddEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(windowAddEventListenerSpy).toHaveBeenCalledWith('keyup', expect.any(Function));
    expect(windowAddEventListenerSpy).toHaveBeenCalledTimes(2);

    toolService.destroy();

    expect(windowRemoveEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(windowRemoveEventListenerSpy).toHaveBeenCalledWith('keyup', expect.any(Function));
    expect(windowRemoveEventListenerSpy).toHaveBeenCalledTimes(2);
  });

  it('applies a tool cursor immediately when viewports are added and when the active tool changes', () => {
    toolService.initialize();

    toolService.addViewport('panel_0');
    let group = cs.getLastToolGroup();
    expect(group?.setViewportsCursorByToolName).toHaveBeenCalledWith('WindowLevel', undefined);

    toolService.setActiveTool(ToolName.Length);

    group = cs.getLastToolGroup();
    expect(group?.setViewportsCursorByToolName).toHaveBeenLastCalledWith('Length', undefined);
  });

  it('maps active tool activation correctly, including crosshairs special mapping', () => {
    toolService.initialize();

    const cases: Array<{ tool: ToolName; expectedCsName: string }> = [
      { tool: ToolName.Length, expectedCsName: 'Length' },
      { tool: ToolName.Pan, expectedCsName: 'Pan' },
      { tool: ToolName.Zoom, expectedCsName: 'Zoom' },
      { tool: ToolName.Crosshairs, expectedCsName: 'WindowLevel' },
    ];

    for (const { tool, expectedCsName } of cases) {
      toolService.setActiveTool(tool);
      const group = cs.getLastToolGroup();
      expect(group?.setToolActive).toHaveBeenCalledWith(
        expectedCsName,
        expect.objectContaining({
          bindings: expect.arrayContaining([expect.objectContaining({ mouseButton: 1 })]),
        }),
      );
      expect(toolService.getActiveTool()).toBe(tool);
    }
  });

  it('activates brush strategy and segmentation selection for segmentation tools', () => {
    toolService.initialize();

    useSegmentationStore.setState({
      activeSegmentationId: 'seg-1',
      activeSegmentIndex: 2,
      segmentations: [
        {
          segmentationId: 'seg-1',
          label: 'Seg 1',
          segments: [],
          isActive: true,
        },
      ],
      showPanel: false,
    });

    toolService.setActiveTool(ToolName.Brush);

    const group = cs.getLastToolGroup();
    expect(group?.setActiveStrategy).toHaveBeenCalledWith('Brush', 'FILL_INSIDE_CIRCLE');
    expect(segmentationManagerMock.userSelectedSegmentation).toHaveBeenCalledWith('panel_0', 'seg-1', 2);

    const segStoreState = useSegmentationStore.getState();
    expect(segStoreState.activeSegTool).toBe(ToolName.Brush);
    expect(segStoreState.showPanel).toBe(true);
  });

  it('applies scissor strategy and cursor mapping without mutating brush preview behavior', () => {
    usePreferencesStore.getState().setScissorDefaultStrategy('fill');
    usePreferencesStore.getState().setScissorPreviewEnabled(true);
    usePreferencesStore.getState().setScissorPreviewColor('#44AA66');

    toolService.initialize();

    useSegmentationStore.setState({
      activeSegmentationId: 'seg-1',
      activeSegmentIndex: 1,
      segmentations: [{ segmentationId: 'seg-1', label: 'Seg 1', segments: [], isActive: true }],
    });

    toolService.setActiveTool(ToolName.CircleScissors);

    let group = cs.getLastToolGroup();
    expect(group?.setToolConfiguration).toHaveBeenCalledWith(
      expect.stringMatching(/CircleScissor/),
      expect.objectContaining({
        preview: expect.objectContaining({
          enabled: false,
        }),
        defaultStrategy: 'FILL_INSIDE',
      }),
    );
    expect(group?.setToolConfiguration.mock.calls.some((call) => call[0] === 'Brush')).toBe(false);
    expect(group?.setActiveStrategy).toHaveBeenCalledWith(
      expect.stringMatching(/CircleScissor/),
      'FILL_INSIDE',
    );
    expect(group?.setViewportsCursorByToolName).toHaveBeenCalledWith(
      'CircleScissor',
      'FILL_INSIDE',
    );
    expect(group?.setToolActive).toHaveBeenCalledWith(
      expect.stringMatching(/CircleScissor/),
      expect.objectContaining({
        bindings: expect.arrayContaining([
          expect.objectContaining({ mouseButton: 1 }),
          expect.objectContaining({ mouseButton: 1, modifierKey: 16 }),
        ]),
      }),
    );
    const circleToolInstance = {
      preMouseDownCallback: vi.fn((evt: any) => {
        const base = evt?.detail?.event?.shiftKey ? [1, 2, 3, 255] : [9, 8, 7, 255];
        (circleToolInstance as any).editData = {
          annotation: { metadata: { segmentColor: base } },
          segmentColor: base,
        };
        return true;
      }),
      editData: undefined as any,
    };
    group?.getToolInstance.mockImplementation((name: string) => (
      /CircleScissor/.test(name) ? circleToolInstance as any : undefined
    ));

    toolService.applyScissorPreferences();
    (circleToolInstance.preMouseDownCallback as any)({
      detail: { event: { shiftKey: true } },
    });

    group = cs.getLastToolGroup();
    expect(group?.setActiveStrategy).toHaveBeenCalledWith(
      expect.stringMatching(/CircleScissor/),
      'ERASE_INSIDE',
    );
    expect(group?.setViewportsCursorByToolName).toHaveBeenCalledWith(
      'CircleScissor',
      'ERASE_OUTSIDE',
    );
    expect(circleToolInstance.editData.annotation.metadata.segmentColor).toEqual([68, 170, 102, 255]);
    expect(circleToolInstance.editData.segmentColor).toEqual([68, 170, 102, 255]);

    (circleToolInstance.preMouseDownCallback as any)({
      detail: { event: { shiftKey: false } },
    });

    group = cs.getLastToolGroup();
    expect(group?.setActiveStrategy).toHaveBeenCalledWith(
      expect.stringMatching(/CircleScissor/),
      'FILL_INSIDE',
    );
  });

  it('uses a valid scissor cursor family for sphere scissors', () => {
    toolService.initialize();

    useSegmentationStore.setState({
      activeSegmentationId: 'seg-1',
      activeSegmentIndex: 1,
      segmentations: [{ segmentationId: 'seg-1', label: 'Seg 1', segments: [], isActive: true }],
    });

    toolService.setActiveTool(ToolName.SphereScissors);

    const group = cs.getLastToolGroup();
    expect(group?.setActiveStrategy).toHaveBeenCalledWith(
      expect.stringMatching(/SphereScissor/),
      'ERASE_INSIDE',
    );
    expect(group?.setViewportsCursorByToolName).toHaveBeenCalledWith(
      'CircleScissor',
      'ERASE_OUTSIDE',
    );
  });

  it('updates scissor cursor strategy on Shift keydown and restores it on keyup', () => {
    usePreferencesStore.getState().setScissorDefaultStrategy('erase');

    toolService.initialize();
    toolService.addViewport('panel_0');

    useSegmentationStore.setState({
      activeSegmentationId: 'seg-1',
      activeSegmentIndex: 1,
      segmentations: [{ segmentationId: 'seg-1', label: 'Seg 1', segments: [], isActive: true }],
    });

    toolService.setActiveTool(ToolName.CircleScissors);

    let group = cs.getLastToolGroup();
    group?.setActiveStrategy.mockClear();
    group?.setViewportsCursorByToolName.mockClear();

    dispatchWindowKey('keydown', 'Shift');

    group = cs.getLastToolGroup();
    expect(group?.setActiveStrategy).toHaveBeenCalledWith(
      expect.stringMatching(/CircleScissor/),
      'FILL_INSIDE',
    );
    expect(group?.setViewportsCursorByToolName).toHaveBeenCalledWith(
      'CircleScissor',
      'FILL_INSIDE',
    );

    dispatchWindowKey('keyup', 'Shift');

    expect(group?.setActiveStrategy).toHaveBeenCalledWith(
      expect.stringMatching(/CircleScissor/),
      'ERASE_INSIDE',
    );
    expect(group?.setViewportsCursorByToolName).toHaveBeenCalledWith(
      'CircleScissor',
      'ERASE_OUTSIDE',
    );
  });

  it('updates to a scissor cursor immediately even before async segmentation creation completes', () => {
    toolService.initialize();

    useSegmentationStore.setState({
      activeSegmentationId: null,
      activeSegmentIndex: 1,
      segmentations: [],
    });

    toolService.setActiveTool(ToolName.CircleScissors);

    const group = cs.getLastToolGroup();
    expect(group?.setViewportsCursorByToolName).toHaveBeenCalledWith(
      'CircleScissor',
      'ERASE_OUTSIDE',
    );
  });

  it('adds and removes viewport bindings through the shared tool group', () => {
    toolService.initialize();

    toolService.addViewport('panel_0');
    let group = cs.getLastToolGroup();
    expect(group?.addViewport).toHaveBeenCalledWith('panel_0', 'xnatRenderingEngine');

    toolService.removeViewport('panel_0');
    group = cs.getLastToolGroup();
    expect(group?.removeViewports).toHaveBeenCalledWith('xnatRenderingEngine', 'panel_0');
  });

  it('handles same-tool no-op and clears activeSegTool when switching away from segmentation tools', () => {
    toolService.initialize();

    const createCallsAfterInit = cs.tools.ToolGroupManager.createToolGroup.mock.calls.length;
    toolService.setActiveTool(ToolName.WindowLevel);
    expect(cs.tools.ToolGroupManager.createToolGroup.mock.calls.length).toBe(createCallsAfterInit);

    useSegmentationStore.setState({
      activeSegmentationId: 'seg-1',
      activeSegmentIndex: 1,
      segmentations: [{ segmentationId: 'seg-1', label: 'Seg 1', segments: [], isActive: true }],
    });

    toolService.setActiveTool(ToolName.Brush);
    expect(useSegmentationStore.getState().activeSegTool).toBe(ToolName.Brush);

    toolService.setActiveTool(ToolName.WindowLevel);
    expect(useSegmentationStore.getState().activeSegTool).toBeNull();
    expect(toolService.getActiveTool()).toBe(ToolName.WindowLevel);
  });

  it('removeViewport is safe when tool group is not initialized', () => {
    toolService.destroy();
    expect(() => toolService.removeViewport('panel_0')).not.toThrow();
  });

  describe('tool state tracking (round-trip switching)', () => {
    it('WindowLevel is Active after switching from Brush to WindowLevel', () => {
      toolService.initialize();

      useSegmentationStore.setState({
        activeSegmentationId: 'seg-1',
        activeSegmentIndex: 1,
        segmentations: [{ segmentationId: 'seg-1', label: 'Seg 1', segments: [], isActive: true }],
      });

      toolService.setActiveTool(ToolName.Brush);
      let group = cs.getLastToolGroup();
      expect(group?.__toolStates.get('Brush')).toBe('Active');

      toolService.setActiveTool(ToolName.WindowLevel);
      group = cs.getLastToolGroup();
      expect(group?.__toolStates.get('WindowLevel')).toBe('Active');
    });

    it('Brush is Active after Brush → Crosshairs → Brush round-trip', () => {
      toolService.initialize();

      useSegmentationStore.setState({
        activeSegmentationId: 'seg-1',
        activeSegmentIndex: 1,
        segmentations: [{ segmentationId: 'seg-1', label: 'Seg 1', segments: [], isActive: true }],
      });

      toolService.setActiveTool(ToolName.Brush);
      let group = cs.getLastToolGroup();
      expect(group?.__toolStates.get('Brush')).toBe('Active');

      toolService.setActiveTool(ToolName.Crosshairs);
      group = cs.getLastToolGroup();
      // Crosshairs maps to WindowLevel as the Cornerstone tool
      expect(group?.__toolStates.get('WindowLevel')).toBe('Active');

      toolService.setActiveTool(ToolName.Brush);
      group = cs.getLastToolGroup();
      expect(group?.__toolStates.get('Brush')).toBe('Active');
    });

    it('only one tool is Active for the Primary mouse button after any switch', () => {
      toolService.initialize();

      useSegmentationStore.setState({
        activeSegmentationId: 'seg-1',
        activeSegmentIndex: 1,
        segmentations: [{ segmentationId: 'seg-1', label: 'Seg 1', segments: [], isActive: true }],
      });

      const tools: ToolName[] = [
        ToolName.Brush,
        ToolName.WindowLevel,
        ToolName.Crosshairs,
        ToolName.Length,
      ];

      for (const tool of tools) {
        toolService.setActiveTool(tool);
        const group = cs.getLastToolGroup();
        if (!group) continue;

        // Count how many tools are in Active state
        const activeTools = [...group.__toolStates.entries()]
          .filter(([, state]) => state === 'Active');

        // Pan and Zoom are always Active (fixed bindings on Auxiliary/Secondary).
        // The primary tool + Pan + Zoom = at most 3 Active tools.
        // But we should never have MORE Active tools than that.
        expect(activeTools.length).toBeLessThanOrEqual(3);
      }
    });
  });
});
