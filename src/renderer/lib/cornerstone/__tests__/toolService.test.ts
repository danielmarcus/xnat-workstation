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
    resetCornerstoneMocks(cs);
    resetStores();
    toolService.destroy();
  });

  afterEach(() => {
    toolService.destroy();
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
});
