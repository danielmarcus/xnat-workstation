import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      isLoaded: () => false,
      get: () => null,
    },
  },
}));

import { useSegmentationManagerStore } from '../../../stores/segmentationManagerStore';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { useViewerStore } from '../../../stores/viewerStore';
import {
  createAdaptersModuleMock,
  createCoreModuleMock,
  createCornerstoneMockState,
  createToolsModuleMock,
} from '../../../test/cornerstone/cornerstoneMocks';
import { expectListenersRegistered, expectNoListenersLeft } from '../../../test/cornerstone/listenerAssertions';
import { resetCornerstoneMocks } from '../../../test/cornerstone/resetCornerstoneMocks';

const cs = createCornerstoneMockState();
const showAlertDialogMock = vi.fn(() => Promise.resolve());

let segmentationService: (typeof import('../segmentationService'))['segmentationService'];
const Events = cs.tools.Enums.Events;

async function importSegmentationService(): Promise<void> {
  vi.resetModules();
  vi.doMock('../../../stores/segmentationStore', () => ({
    useSegmentationStore,
  }));
  vi.doMock('../../../stores/segmentationManagerStore', () => ({
    useSegmentationManagerStore,
  }));
  vi.doMock('../../../stores/viewerStore', () => ({
    useViewerStore,
  }));
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
  vi.doMock('../../../stores/dialogStore', () => ({
    showAlertDialog: showAlertDialogMock,
  }));

  ({ segmentationService } = await import('../segmentationService'));
}

function resetStores(): void {
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
  useSegmentationManagerStore.setState(useSegmentationManagerStore.getInitialState(), true);
  useViewerStore.setState(useViewerStore.getInitialState(), true);
}

function setupContourCopyPasteScenario() {
  const render = vi.fn();
  const completedSpy = vi.fn();
  useViewerStore.setState({
    activeViewportId: 'panel_0',
    viewports: {
      panel_0: {
        imageIndex: 1,
        requestedImageIndex: null,
        totalImages: 2,
        camera: null,
        voi: null,
        invert: false,
        flipH: false,
        flipV: false,
        rotation: 0,
        zoom: 1,
        pan: null,
      },
    },
    panelImageIdsMap: {
      panel_0: ['img-1', 'img-2'],
    },
  });
  cs.setEnabledElement('panel_0', {
    viewport: {
      render,
      getCurrentImageId: vi.fn(() => 'img-2'),
      getCurrentImageIdIndex: vi.fn(() => 1),
      getViewReference: vi.fn(() => ({
        viewPlaneNormal: [0, 0, 1],
        viewUp: [0, -1, 0],
      })),
      getCamera: vi.fn(() => ({
        viewPlaneNormal: [0, 0, 1],
        viewUp: [0, -1, 0],
      })),
    },
  } as any);
  cs.core.metaData.get.mockImplementation((type: string, imageId: string) => {
    if (type === 'imagePlaneModule') {
      if (imageId === 'img-1') {
        return {
          imagePositionPatient: [0, 0, 1],
          rowCosines: [1, 0, 0],
          columnCosines: [0, 1, 0],
          frameOfReferenceUID: 'frame-1',
        };
      }
      if (imageId === 'img-2') {
        return {
          imagePositionPatient: [0, 0, 6],
          rowCosines: [1, 0, 0],
          columnCosines: [0, 1, 0],
          frameOfReferenceUID: 'frame-1',
        };
      }
    }
    return undefined;
  });

  const contourSegmentation = {
    segmentationId: 'rt-1',
    label: 'Structure Set',
    segments: {
      1: { label: 'Tumor', locked: false },
    },
    representationData: {
      Contour: { annotationUIDsMap: new Map([[1, new Set(['ann-1'])]]) },
    },
  };
  cs.setSegmentations([contourSegmentation]);
  cs.setViewportIdsForSegmentation('rt-1', ['panel_0']);
  cs.setAnnotations([
    {
      annotationUID: 'ann-1',
      metadata: {
        toolName: 'PlanarFreehandContourSegmentationTool',
        referencedImageId: 'img-1',
        FrameOfReferenceUID: 'frame-1',
      },
      data: {
        contour: {
          polyline: [
            [1, 1, 1],
            [3, 1, 1],
            [2, 4, 1],
          ],
          closed: true,
        },
        segmentation: {
          segmentationId: 'rt-1',
          segmentIndex: 1,
        },
        handles: {
          points: [],
          activeHandleIndex: null,
          textBox: {
            worldPosition: [2, 2, 1],
            worldBoundingBox: {
              topLeft: [1, 1, 1],
              topRight: [3, 1, 1],
              bottomLeft: [1, 3, 1],
              bottomRight: [3, 3, 1],
            },
          },
        },
      },
    },
  ]);
  cs.eventTarget.addEventListener(Events.ANNOTATION_COMPLETED, completedSpy);
  segmentationService.initialize();
  cs.tools.annotation.selection.setAnnotationSelected('ann-1', true, false);

  return { contourSegmentation, completedSpy };
}

describe('segmentationService', () => {
  beforeEach(async () => {
    resetCornerstoneMocks(cs);
    resetStores();
    showAlertDialogMock.mockClear();
    await importSegmentationService();
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
      Events.ANNOTATION_SELECTION_CHANGE,
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

  it('syncs contour selection from viewport clicks into the active segmentation state', () => {
    useViewerStore.setState({ activeViewportId: 'panel_0' });
    cs.setSegmentations([
      {
        segmentationId: 'rt-1',
        label: 'Structure Set',
        segments: {
          2: { label: 'Tumor', locked: false },
        },
        representationData: {
          Contour: { annotationUIDsMap: new Map([[2, new Set(['ann-2'])]]) },
        },
      },
    ]);
    cs.setViewportIdsForSegmentation('rt-1', ['panel_0']);
    cs.setAnnotations([
      {
        annotationUID: 'ann-2',
        metadata: {
          toolName: 'PlanarFreehandContourSegmentationTool',
          referencedImageId: 'img-2',
          FrameOfReferenceUID: 'frame-1',
        },
        data: {
          contour: {
            polyline: [
              [1, 1, 2],
              [2, 1, 2],
              [1, 2, 2],
            ],
            closed: true,
          },
          segmentation: {
            segmentationId: 'rt-1',
            segmentIndex: 2,
          },
          handles: { points: [], activeHandleIndex: null },
        },
      },
    ]);

    segmentationService.initialize();
    cs.eventTarget.dispatch(Events.ANNOTATION_SELECTION_CHANGE, { selection: ['ann-2'] });

    expect(useSegmentationStore.getState().activeSegmentationId).toBe('rt-1');
    expect(useSegmentationStore.getState().activeSegmentIndex).toBe(2);
    expect(cs.tools.segmentation.segmentIndex.setActiveSegmentIndex).toHaveBeenCalledWith('rt-1', 2);
    expect(cs.tools.segmentation.activeSegmentation.setActiveSegmentation).toHaveBeenCalledWith('panel_0', 'rt-1');
  });

  it('copies the selected contour annotation, pastes it with interpolation metadata, and supports undo/redo', () => {
    const { contourSegmentation, completedSpy } = setupContourCopyPasteScenario();

    expect(segmentationService.copySelectedContourAnnotation()).toBe(true);
    expect(segmentationService.pasteCopiedContourAnnotationToActiveSlice()).toBe(true);

    expect(cs.tools.annotation.state.addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotationUID: 'mock-uuid',
        metadata: expect.objectContaining({
          referencedImageId: 'img-2',
          sliceIndex: 1,
          viewPlaneNormal: [0, 0, 1],
          viewUp: [0, -1, 0],
        }),
        data: expect.objectContaining({
          contour: expect.objectContaining({
            polyline: [
              [1, 1, 6],
              [3, 1, 6],
              [2, 4, 6],
            ],
          }),
        }),
      }),
      'panel_0',
    );
    expect(cs.core.utilities.HistoryMemo.DefaultHistoryMemo.canUndo).toBe(true);
    expect(
      contourSegmentation.representationData.Contour.annotationUIDsMap.get(1)?.has('mock-uuid'),
    ).toBe(true);
    expect(useSegmentationStore.getState().activeSegmentationId).toBe('rt-1');
    expect(useSegmentationStore.getState().activeSegmentIndex).toBe(1);
    expect(cs.tools.annotation.selection.getAnnotationsSelected()).toEqual(['mock-uuid']);
    expect(useSegmentationStore.getState().hasUnsavedChanges).toBe(true);
    expect(completedSpy).toHaveBeenCalledTimes(1);

    segmentationService.undo();

    expect(cs.tools.annotation.state.getAnnotation('mock-uuid')).toBeNull();
    expect(
      contourSegmentation.representationData.Contour.annotationUIDsMap.get(1)?.has('mock-uuid'),
    ).toBe(false);
    expect(cs.tools.annotation.selection.getAnnotationsSelected()).toEqual([]);

    segmentationService.redo();

    expect(cs.tools.annotation.state.getAnnotation('mock-uuid')).toMatchObject({
      annotationUID: 'mock-uuid',
      metadata: expect.objectContaining({
        referencedImageId: 'img-2',
        sliceIndex: 1,
      }),
    });
    expect(
      contourSegmentation.representationData.Contour.annotationUIDsMap.get(1)?.has('mock-uuid'),
    ).toBe(true);
    expect(cs.tools.annotation.selection.getAnnotationsSelected()).toEqual(['mock-uuid']);
    expect(completedSpy).toHaveBeenCalledTimes(2);
    cs.eventTarget.removeEventListener(Events.ANNOTATION_COMPLETED, completedSpy);
  });

  it('blocks undo when the newest annotation history entry belongs to a locked annotation', () => {
    const { contourSegmentation, completedSpy } = setupContourCopyPasteScenario();

    expect(segmentationService.copySelectedContourAnnotation()).toBe(true);
    expect(segmentationService.pasteCopiedContourAnnotationToActiveSlice()).toBe(true);
    cs.setSegmentLocked('rt-1', 1, true);

    segmentationService.undo();

    expect(cs.tools.annotation.state.getAnnotation('mock-uuid')).toMatchObject({
      annotationUID: 'mock-uuid',
    });
    expect(
      contourSegmentation.representationData.Contour.annotationUIDsMap.get(1)?.has('mock-uuid'),
    ).toBe(true);
    expect(showAlertDialogMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Undo blocked',
      message: 'Unlock Tumor before applying undo.',
    }));
    cs.eventTarget.removeEventListener(Events.ANNOTATION_COMPLETED, completedSpy);
  });

  it('blocks redo when the next redo history entry references a locked annotation', () => {
    const { contourSegmentation, completedSpy } = setupContourCopyPasteScenario();

    expect(segmentationService.copySelectedContourAnnotation()).toBe(true);
    expect(segmentationService.pasteCopiedContourAnnotationToActiveSlice()).toBe(true);

    segmentationService.undo();
    expect(cs.tools.annotation.state.getAnnotation('mock-uuid')).toBeNull();

    cs.setSegmentLocked('rt-1', 1, true);
    segmentationService.redo();

    expect(cs.tools.annotation.state.getAnnotation('mock-uuid')).toBeNull();
    expect(
      contourSegmentation.representationData.Contour.annotationUIDsMap.get(1)?.has('mock-uuid'),
    ).toBe(false);
    expect(showAlertDialogMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Redo blocked',
      message: expect.stringContaining('Unlock the locked annotations before applying redo:'),
    }));
    expect(showAlertDialogMock).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('- Tumor'),
    }));
    cs.eventTarget.removeEventListener(Events.ANNOTATION_COMPLETED, completedSpy);
  });
});
