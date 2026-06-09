import { beforeEach, describe, expect, it, vi } from 'vitest';

type InitMocks = {
  initCore: ReturnType<typeof vi.fn>;
  initTools: ReturnType<typeof vi.fn>;
  addTool: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  initDicomLoader: ReturnType<typeof vi.fn>;
};

async function loadInitModule(options?: { splineRegistered?: boolean }): Promise<{
  initCornerstone: () => Promise<void>;
  mocks: InitMocks;
}> {
  vi.resetModules();

  const initCore = vi.fn();
  const initTools = vi.fn();
  const addTool = vi.fn();
  const register = vi.fn();
  const initDicomLoader = vi.fn();
  const splineTool = { toolName: 'SplineContourSegmentation' };

  const toolNames: Record<string, unknown> = {
    StackScrollTool: { toolName: 'StackScroll' },
    ZoomTool: { toolName: 'Zoom' },
    PanTool: { toolName: 'Pan' },
    WindowLevelTool: { toolName: 'WindowLevel' },
    LengthTool: { toolName: 'Length' },
    AngleTool: { toolName: 'Angle' },
    BidirectionalTool: { toolName: 'Bidirectional' },
    EllipticalROITool: { toolName: 'EllipticalROI' },
    RectangleROITool: { toolName: 'RectangleROI' },
    CircleROITool: { toolName: 'CircleROI' },
    ProbeTool: { toolName: 'Probe' },
    ArrowAnnotateTool: { toolName: 'ArrowAnnotate' },
    PlanarFreehandROITool: { toolName: 'PlanarFreehandROI' },
    CrosshairsTool: { toolName: 'Crosshairs' },
    BrushTool: { toolName: 'Brush' },
    PlanarFreehandContourSegmentationTool: { toolName: 'PlanarFreehandContourSegmentation' },
    SplineContourSegmentationTool: splineTool,
    LivewireContourSegmentationTool: { toolName: 'LivewireContourSegmentation' },
    CircleScissorsTool: { toolName: 'CircleScissors' },
    RectangleScissorsTool: { toolName: 'RectangleScissors' },
    SphereScissorsTool: { toolName: 'SphereScissors' },
    SculptorTool: { toolName: 'Sculptor' },
    SegmentSelectTool: { toolName: 'SegmentSelect' },
    RegionSegmentTool: { toolName: 'RegionSegment' },
    RegionSegmentPlusTool: { toolName: 'RegionSegmentPlus' },
    SegmentBidirectionalTool: { toolName: 'SegmentBidirectional' },
    RectangleROIThresholdTool: { toolName: 'RectangleROIThreshold' },
    CircleROIStartEndThresholdTool: { toolName: 'CircleROIStartEndThreshold' },
    LabelMapEditWithContourTool: { toolName: 'LabelMapEditWithContour' },
  };

  vi.doMock('@cornerstonejs/core', () => ({
    init: initCore,
  }));

  vi.doMock('@cornerstonejs/tools', () => ({
    init: initTools,
    addTool,
    ...toolNames,
    utilities: {
      contours: {
        AnnotationToPointData: {
          TOOL_NAMES: options?.splineRegistered
            ? { [splineTool.toolName]: true }
            : {},
          register,
        },
      },
    },
  }));

  vi.doMock('@cornerstonejs/polymorphic-segmentation', () => ({
    polySeg: true,
  }));

  vi.doMock('@cornerstonejs/dicom-image-loader', () => ({
    init: initDicomLoader,
  }));

  vi.doMock('../tools/SafePaintFillTool', () => ({
    default: { toolName: 'SafePaintFill' },
  }));

  const mod = await import('../init');
  return {
    initCornerstone: mod.initCornerstone,
    mocks: { initCore, initTools, addTool, register, initDicomLoader },
  };
}

describe('initCornerstone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'navigator', {
      value: { hardwareConcurrency: 8 },
      configurable: true,
    });
  });

  it('initializes core/tools/dicom loader once and registers spline adapter when missing', async () => {
    const { initCornerstone, mocks } = await loadInitModule({ splineRegistered: false });

    await initCornerstone();
    await initCornerstone();

    expect(mocks.initCore).toHaveBeenCalledTimes(1);
    expect(mocks.initTools).toHaveBeenCalledTimes(1);
    expect(mocks.initTools).toHaveBeenCalledWith({
      addons: { polySeg: { polySeg: true } },
    });
    expect(mocks.addTool).toHaveBeenCalled();
    expect(mocks.addTool).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'SafePaintFill' }));
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.initDicomLoader).toHaveBeenCalledWith({ maxWebWorkers: 4 });
  });

  it('skips redundant spline registration when already present', async () => {
    const { initCornerstone, mocks } = await loadInitModule({ splineRegistered: true });
    await initCornerstone();
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
