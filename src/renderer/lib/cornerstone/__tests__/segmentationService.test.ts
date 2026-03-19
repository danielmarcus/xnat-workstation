import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSegmentationManagerStore } from '../../../stores/segmentationManagerStore';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import {
  createAdaptersModuleMock,
  createCoreModuleMock,
  createCornerstoneMockState,
  createToolsModuleMock,
} from '../../../test/cornerstone/cornerstoneMocks';
import { expectListenersRegistered, expectNoListenersLeft } from '../../../test/cornerstone/listenerAssertions';
import { resetCornerstoneMocks } from '../../../test/cornerstone/resetCornerstoneMocks';

const cs = createCornerstoneMockState();

let segmentationService: (typeof import('../segmentationService'))['segmentationService'];
const Events = cs.tools.Enums.Events;

beforeAll(async () => {
  vi.doMock('@cornerstonejs/core', () => createCoreModuleMock(cs));
  vi.doMock('@cornerstonejs/tools', () => createToolsModuleMock(cs));
  vi.doMock('@cornerstonejs/adapters', () => createAdaptersModuleMock(cs));
  vi.doMock('../tools/SafePaintFillTool', () => ({
    default: {
      toolName: 'SafePaintFill',
    },
  }));
  vi.doMock('../rtStructService', () => ({
    rtStructService: {
      parseRtStruct: vi.fn(() => ({ referencedSeriesUID: null })),
    },
  }));

  ({ segmentationService } = await import('../segmentationService'));
});

function resetStores(): void {
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
  useSegmentationManagerStore.setState(useSegmentationManagerStore.getInitialState(), true);
}

describe('segmentationService', () => {
  beforeEach(() => {
    resetCornerstoneMocks(cs);
    resetStores();
    segmentationService.dispose();
  });

  afterEach(() => {
    segmentationService.dispose();
    expectNoListenersLeft(cs.eventTarget);
  });

  it('registers and disposes segmentation/annotation listeners', () => {
    segmentationService.initialize();

    expectListenersRegistered(cs.eventTarget, [
      Events.SEGMENTATION_MODIFIED,
      Events.SEGMENTATION_DATA_MODIFIED,
      Events.SEGMENTATION_ADDED,
      Events.SEGMENTATION_REMOVED,
      Events.SEGMENTATION_REPRESENTATION_MODIFIED,
      Events.SEGMENTATION_REPRESENTATION_ADDED,
      Events.SEGMENTATION_REPRESENTATION_REMOVED,
      Events.ANNOTATION_COMPLETED,
      Events.ANNOTATION_MODIFIED,
      Events.ANNOTATION_REMOVED,
    ]);

    segmentationService.dispose();
    expectNoListenersLeft(cs.eventTarget);
  });

  it('updateStyle and setBrushSize delegate to Cornerstone segmentation APIs', () => {
    cs.setSegmentations([{ segmentationId: 'seg-1', label: 'Seg 1', segments: {} }]);
    cs.setViewportIdsForSegmentation('seg-1', ['panel_0', 'panel_1']);

    const render0 = vi.fn();
    const render1 = vi.fn();
    cs.setEnabledElement('panel_0', { viewport: { render: render0 } });
    cs.setEnabledElement('panel_1', { viewport: { render: render1 } });

    segmentationService.updateStyle(0.4, true);

    expect(cs.tools.segmentation.segmentationStyle.setStyle).toHaveBeenCalledWith(
      { type: 'Labelmap' },
      expect.objectContaining({
        renderFill: true,
        fillAlpha: 0.4,
        renderOutline: true,
        outlineWidth: 2,
      }),
    );
    expect(cs.tools.utilities.segmentation.triggerSegmentationRender).toHaveBeenCalledWith('panel_0');
    expect(cs.tools.utilities.segmentation.triggerSegmentationRender).toHaveBeenCalledWith('panel_1');
    expect(render0).toHaveBeenCalled();
    expect(render1).toHaveBeenCalled();

    segmentationService.setBrushSize(13);
    expect(cs.tools.utilities.segmentation.setBrushSizeForToolGroup).toHaveBeenCalledWith(
      'xnatToolGroup_primary',
      13,
    );
  });

  it('syncs segmentation summaries into Zustand store from mocked state', () => {
    useSegmentationStore.setState({ activeSegmentationId: 'seg-1' });

    cs.setSegmentations([
      {
        segmentationId: 'seg-1',
        label: 'Liver Segmentation',
        segments: {
          1: { label: 'Liver', locked: false },
          2: { label: 'Tumor', locked: true },
        },
      },
    ]);
    cs.setViewportIdsForSegmentation('seg-1', ['panel_0']);
    cs.setSegmentColor('panel_0', 'seg-1', 1, [255, 0, 0, 255]);
    cs.setSegmentColor('panel_0', 'seg-1', 2, [0, 255, 0, 255]);
    cs.setSegmentVisibility('panel_0', 'seg-1', 1, true);
    cs.setSegmentVisibility('panel_0', 'seg-1', 2, false);
    cs.setSegmentLocked('seg-1', 2, true);

    segmentationService.sync();

    const summaries = useSegmentationStore.getState().segmentations;
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      segmentationId: 'seg-1',
      label: 'Liver Segmentation',
      isActive: true,
    });
    expect(summaries[0]?.segments).toHaveLength(2);
    expect(summaries[0]?.segments[0]).toMatchObject({
      segmentIndex: 1,
      label: 'Liver',
      visible: true,
      locked: false,
      color: [255, 0, 0, 255],
    });
    expect(summaries[0]?.segments[1]).toMatchObject({
      segmentIndex: 2,
      label: 'Tumor',
      visible: false,
      locked: true,
      color: [0, 255, 0, 255],
    });
  });

  it('handles sparse/empty segmentation states without throwing and updates undo state', () => {
    cs.core.utilities.HistoryMemo.DefaultHistoryMemo.canUndo = true;
    cs.core.utilities.HistoryMemo.DefaultHistoryMemo.canRedo = false;
    cs.setSegmentations([
      {
        segmentationId: 'seg-empty',
        label: 'Empty',
        segments: {
          bad: { label: 'Bad' },
        },
      },
    ]);

    segmentationService.initialize();

    expect(() => {
      cs.eventTarget.dispatch(Events.SEGMENTATION_MODIFIED);
    }).not.toThrow();

    expect(useSegmentationStore.getState().canUndo).toBe(true);
    expect(useSegmentationStore.getState().canRedo).toBe(false);
    expect(useSegmentationStore.getState().segmentations[0]?.segments).toEqual([]);

    cs.setSegmentations([]);
    expect(() => segmentationService.sync()).not.toThrow();
    expect(useSegmentationStore.getState().segmentations).toEqual([]);
  });
});
