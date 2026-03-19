// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toolMocks = vi.hoisted(() => {
  class BaseVolumeViewport {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
    getCamera(): { viewPlaneNormal: [number, number, number] } {
      return { viewPlaneNormal: [0, 0, 1] };
    }
  }

  class PaintFillTool {
    memo: unknown;
    doneEditMemo: ReturnType<typeof vi.fn>;
    preMouseDownCallback?: (evt: unknown) => boolean;
    constructor() {
      this.memo = null;
      this.doneEditMemo = vi.fn();
    }
  }

  const segState = {
    representationData: { Labelmap: { volumeId: 'vol-1' } },
  };

  return {
    BaseVolumeViewport,
    PaintFillTool,
    getEnabledElement: vi.fn(),
    transformWorldToIndex: vi.fn(() => [1, 1, 0]),
    uuidv4: vi.fn(() => 'memo-1'),
    cacheGetVolume: vi.fn(() => ({
      dimensions: [10, 10, 1],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      imageData: {},
      voxelManager: {
        getAtIndex: vi.fn(() => 1),
        setAtIndex: vi.fn(),
      },
    })),
    cacheGetImage: vi.fn(() => ({
      voxelManager: {
        getAtIndex: vi.fn(() => 1),
        setAtIndex: vi.fn(),
      },
    })),
    getActiveSegmentation: vi.fn(() => ({ segmentationId: 'seg-1' })),
    getActiveSegmentIndex: vi.fn(() => 3),
    getLockedSegmentIndices: vi.fn(() => []),
    getSegmentation: vi.fn(() => segState),
    getCurrentLabelmapImageIdForViewport: vi.fn(() => 'labelmap-image-1'),
    triggerSegmentationDataModified: vi.fn(),
    segState,
  };
});

vi.mock('@cornerstonejs/core', () => ({
  BaseVolumeViewport: toolMocks.BaseVolumeViewport,
  cache: {
    getVolume: toolMocks.cacheGetVolume,
    getImage: toolMocks.cacheGetImage,
  },
  getEnabledElement: toolMocks.getEnabledElement,
  utilities: {
    transformWorldToIndex: toolMocks.transformWorldToIndex,
    uuidv4: toolMocks.uuidv4,
  },
}));

vi.mock('@cornerstonejs/tools', () => ({
  PaintFillTool: toolMocks.PaintFillTool,
  segmentation: {
    activeSegmentation: {
      getActiveSegmentation: toolMocks.getActiveSegmentation,
    },
    segmentIndex: {
      getActiveSegmentIndex: toolMocks.getActiveSegmentIndex,
    },
    segmentLocking: {
      getLockedSegmentIndices: toolMocks.getLockedSegmentIndices,
      isSegmentIndexLocked: vi.fn(() => false),
    },
    state: {
      getSegmentation: toolMocks.getSegmentation,
      getCurrentLabelmapImageIdForViewport: toolMocks.getCurrentLabelmapImageIdForViewport,
    },
    triggerSegmentationEvents: {
      triggerSegmentationDataModified: toolMocks.triggerSegmentationDataModified,
    },
  },
}));

import { SafePaintFillTool } from './SafePaintFillTool';

describe('SafePaintFillTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when no enabled element or active segmentation is available', () => {
    toolMocks.getEnabledElement.mockReturnValue(null);
    const tool = new SafePaintFillTool() as any;

    const didHandle = tool.preMouseDownCallback?.({
      detail: {
        currentPoints: { world: [0, 0, 0] },
        element: document.createElement('div'),
      },
    });

    expect(didHandle).toBe(true);
    expect(tool.doneEditMemo).not.toHaveBeenCalled();
  });

  it('fills region for volume labelmaps, stores memo changes, and triggers segmentation update', () => {
    const viewport = new toolMocks.BaseVolumeViewport('vp-1');
    toolMocks.getEnabledElement.mockReturnValue({ viewport });

    const tool = new SafePaintFillTool() as any;
    tool.getFixedDimension = vi.fn(() => 2);
    tool.generateHelpers = vi.fn(() => ({
      floodFillGetter: (x: number, y: number) => {
        const key = `${x},${y}`;
        if (key === '1,1' || key === '2,1' || key === '1,2') return 1;
        return undefined;
      },
      getLabelValue: () => 1,
      getScalarDataPositionFromPlane: (x: number, y: number) => x * 10 + y,
      inPlaneSeedPoint: [1, 1],
      fixedDimensionValue: 0,
    }));
    tool.getFramesModified = vi.fn(() => [0]);

    const didHandle = tool.preMouseDownCallback?.({
      detail: {
        currentPoints: { world: [0, 0, 0] },
        element: document.createElement('div'),
      },
    });

    expect(didHandle).toBe(true);
    const segmentationVolume = toolMocks.cacheGetVolume.mock.results[0]?.value;
    expect(segmentationVolume.voxelManager.setAtIndex).toHaveBeenCalled();
    expect(tool.doneEditMemo).toHaveBeenCalledTimes(2);
    expect(tool.memo).toMatchObject({
      id: 'memo-1',
      segmentationId: 'seg-1',
      operationType: 'labelmap',
    });
    expect(toolMocks.triggerSegmentationDataModified).toHaveBeenCalledWith('seg-1', [0], 3);
  });

  it('suppresses edge-connected oversized background fills to avoid accidental full-slice paint', () => {
    const viewport = {
      id: 'vp-stack',
      getCamera: () => ({ viewPlaneNormal: [0, 0, 1] }),
      getImageData: () => ({
        imageData: {
          getDimensions: () => [4, 4, 1],
          getDirection: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
      }),
    };
    toolMocks.getEnabledElement.mockReturnValue({ viewport });
    toolMocks.getSegmentation.mockReturnValue({
      representationData: { Labelmap: {} },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tool = new SafePaintFillTool() as any;
    tool.getFixedDimension = vi.fn(() => 2);
    tool.generateHelpers = vi.fn(() => ({
      floodFillGetter: (x: number, y: number) => {
        if (x < 0 || y < 0 || x > 2 || y > 2) return undefined;
        return 0;
      },
      getLabelValue: () => 0,
      getScalarDataPositionFromPlane: (x: number, y: number) => x * 10 + y,
      inPlaneSeedPoint: [0, 0],
      fixedDimensionValue: 0,
    }));
    tool.getFramesModified = vi.fn(() => [0]);

    const didHandle = tool.preMouseDownCallback?.({
      detail: {
        currentPoints: { world: [0, 0, 0] },
        element: document.createElement('div'),
      },
    });

    expect(didHandle).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ignored background fill connected to slice edge'),
    );
    warnSpy.mockRestore();
  });
});
