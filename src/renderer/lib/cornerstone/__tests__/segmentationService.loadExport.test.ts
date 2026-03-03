import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSegmentationManagerStore } from '../../../stores/segmentationManagerStore';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { useViewerStore } from '../../../stores/viewerStore';

const segIoMocks = vi.hoisted(() => {
  const metadataMap = new Map<string, any>();
  const imageCache = new Map<string, any>();
  const segmentationMap = new Map<string, any>();
  const viewportIdsBySeg = new Map<string, Set<string>>();
  const activeSegmentIndexBySeg = new Map<string, number>();
  const colorMap = new Map<string, [number, number, number, number]>();
  const visibilityMap = new Map<string, boolean>();
  const lockMap = new Map<string, boolean>();

  const key = (vp: string, segId: string, idx: number) => `${vp}|${segId}|${idx}`;

  return {
    metadataMap,
    imageCache,
    segmentationMap,
    viewportIdsBySeg,
    activeSegmentIndexBySeg,
    colorMap,
    reset() {
      metadataMap.clear();
      imageCache.clear();
      segmentationMap.clear();
      viewportIdsBySeg.clear();
      activeSegmentIndexBySeg.clear();
      colorMap.clear();
      visibilityMap.clear();
      lockMap.clear();
      vi.clearAllMocks();
    },
    metaDataGet: vi.fn((type: string, imageId: string) => metadataMap.get(`${type}|${imageId}`)),
    metaDataGetNormalized: vi.fn((imageId: string, modules: string[]) => {
      const out: Record<string, unknown> = {};
      for (const moduleName of modules) {
        const mod = metadataMap.get(`${moduleName}|${imageId}`);
        if (mod && typeof mod === 'object') {
          Object.assign(out, mod);
        }
      }
      return out;
    }),
    genericMetadataAdd: vi.fn(),
    getEnabledElementByViewportId: vi.fn(() => ({ viewport: { render: vi.fn() } })),
    getImage: vi.fn((imageId: string) => imageCache.get(imageId)),
    removeImageLoadObject: vi.fn((imageId: string) => {
      imageCache.delete(imageId);
    }),
    createAndCacheLocalImage: vi.fn((imageId: string, image: any) => {
      const cached = {
        imageId,
        rows: image.dimensions?.[1] ?? 2,
        columns: image.dimensions?.[0] ?? 2,
        rowPixelSpacing: image.spacing?.[1] ?? 1,
        columnPixelSpacing: image.spacing?.[0] ?? 1,
        referencedImageId: image.referencedImageId,
        voxelManager: {
          getScalarData: () => image.scalarData,
        },
      };
      imageCache.set(imageId, cached);
      return cached;
    }),
    loadAndCacheImage: vi.fn(async (imageId: string) => imageCache.get(imageId)),
    addSegmentations: vi.fn((defs: any[]) => {
      for (const def of defs) {
        segmentationMap.set(def.segmentationId, {
          segmentationId: def.segmentationId,
          label: def.config?.label ?? '',
          segments: def.config?.segments ?? {},
          representationData: {
            Labelmap: def.representation?.data ?? {},
            Contour: def.representation?.data ?? {},
          },
        });
        if (!viewportIdsBySeg.has(def.segmentationId)) {
          viewportIdsBySeg.set(def.segmentationId, new Set());
        }
      }
    }),
    removeSegmentation: vi.fn((segmentationId: string) => {
      segmentationMap.delete(segmentationId);
      viewportIdsBySeg.delete(segmentationId);
    }),
    updateSegmentations: vi.fn(),
    removeSegment: vi.fn(),
    addLabelmapRepresentationToViewport: vi.fn((viewportId: string, defs: Array<{ segmentationId: string }>) => {
      for (const def of defs) {
        if (!viewportIdsBySeg.has(def.segmentationId)) {
          viewportIdsBySeg.set(def.segmentationId, new Set());
        }
        viewportIdsBySeg.get(def.segmentationId)?.add(viewportId);
      }
    }),
    addContourRepresentationToViewport: vi.fn((viewportId: string, defs: Array<{ segmentationId: string }>) => {
      for (const def of defs) {
        if (!viewportIdsBySeg.has(def.segmentationId)) {
          viewportIdsBySeg.set(def.segmentationId, new Set());
        }
        viewportIdsBySeg.get(def.segmentationId)?.add(viewportId);
      }
    }),
    removeLabelmapRepresentation: vi.fn(),
    removeContourRepresentation: vi.fn(),
    removeSegmentationRepresentations: vi.fn(),
    removeSegmentationRepresentationsFromToolGroup: vi.fn(),
    getSegmentations: vi.fn(() => Array.from(segmentationMap.values())),
    getSegmentation: vi.fn((segmentationId: string) => segmentationMap.get(segmentationId)),
    getViewportIdsWithSegmentation: vi.fn((segmentationId: string) => Array.from(viewportIdsBySeg.get(segmentationId) ?? [])),
    setActiveSegmentation: vi.fn(),
    setActiveSegmentIndex: vi.fn((segmentationId: string, index: number) => {
      activeSegmentIndexBySeg.set(segmentationId, index);
    }),
    getActiveSegmentIndex: vi.fn((segmentationId: string) => activeSegmentIndexBySeg.get(segmentationId) ?? 1),
    getSegmentIndexColor: vi.fn((viewportId: string, segmentationId: string, index: number) => (
      colorMap.get(key(viewportId, segmentationId, index)) ?? [255, 0, 0, 255]
    )),
    setSegmentIndexColor: vi.fn((viewportId: string, segmentationId: string, index: number, color: [number, number, number, number]) => {
      colorMap.set(key(viewportId, segmentationId, index), color);
    }),
    getSegmentIndexVisibility: vi.fn((viewportId: string, spec: { segmentationId: string }, idx: number) => (
      visibilityMap.get(key(viewportId, spec.segmentationId, idx)) ?? true
    )),
    setSegmentIndexVisibility: vi.fn((viewportId: string, spec: { segmentationId: string }, idx: number, visible: boolean) => {
      visibilityMap.set(key(viewportId, spec.segmentationId, idx), visible);
    }),
    isSegmentIndexLocked: vi.fn((segmentationId: string, idx: number) => (
      lockMap.get(`${segmentationId}|${idx}`) ?? false
    )),
    setSegmentIndexLocked: vi.fn((segmentationId: string, idx: number, locked: boolean) => {
      lockMap.set(`${segmentationId}|${idx}`, locked);
    }),
    setStyle: vi.fn(),
    triggerSegmentationRender: vi.fn(),
    triggerSegmentationDataModified: vi.fn(),
    selectionGetAnnotationsSelected: vi.fn(() => []),
    annotationGetAnnotation: vi.fn(),
    annotationRemoveAnnotation: vi.fn(),
    removeContourSegmentationAnnotation: vi.fn(),
    adaptersCreateFromDicomSegBuffer: vi.fn(async (_sourceIds: string[]) => ({
      segMetadata: {
        data: [
          { SeriesDescription: 'Loaded SEG' },
          { SegmentLabel: 'Liver', RecommendedDisplayCIELabValue: [1, 2, 3] },
          { SegmentLabel: 'Tumor', RecommendedDisplayCIELabValue: [4, 5, 6] },
        ],
      },
      labelMapImages: [[
        {
          imageId: 'derived:0',
          referencedImageId: 'src-1?frame=0',
          voxelManager: { getScalarData: () => new Uint8Array([0, 1, 0, 2]) },
        },
        {
          imageId: 'derived:1',
          referencedImageId: 'src-2?frame=0',
          voxelManager: { getScalarData: () => new Uint8Array([2, 0, 0, 0]) },
        },
      ]],
    })),
    adaptersGenerateSegmentation: vi.fn(() => ({
      dataset: {
        SOPClassUID: '1.2.3',
        SOPInstanceUID: '1.2.3.4',
        NumberOfFrames: 2,
        Rows: 2,
        Columns: 2,
        PixelData: new Uint8Array([255]).buffer,
        PerFrameFunctionalGroupsSequence: [{}, {}],
      },
    })),
    dicomlab2RGB: vi.fn(() => [0.8, 0.4, 0.2]),
    rgb2DICOMLAB: vi.fn(() => [10, 20, 30]),
    denaturalizeDataset: vi.fn((dataset: any) => dataset),
    writeDicomDict: vi.fn(() => {
      const bytes = new Uint8Array([65, 66, 67]);
      return bytes.buffer;
    }),
    parseDicom: vi.fn((bytes: Uint8Array) => ({
      uint16: (tag: string) => {
        if (tag === 'x00280010') return 2;
        if (tag === 'x00280011') return 2;
        return 0;
      },
      elements: {
        x7fe00010: { length: bytes.length > 0 ? 4 : 0 },
        x00280010: { dataOffset: 0 },
        x00280011: { dataOffset: 2 },
      },
    })),
  };
});

vi.mock('@cornerstonejs/core', () => ({
  eventTarget: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  metaData: {
    get: segIoMocks.metaDataGet,
    getNormalized: segIoMocks.metaDataGetNormalized,
  },
  imageLoader: {
    createAndCacheLocalImage: segIoMocks.createAndCacheLocalImage,
    loadAndCacheImage: segIoMocks.loadAndCacheImage,
  },
  cache: {
    getImage: segIoMocks.getImage,
    getVolume: vi.fn(),
    removeImageLoadObject: segIoMocks.removeImageLoadObject,
  },
  utilities: {
    HistoryMemo: {
      DefaultHistoryMemo: { canUndo: false, canRedo: false, size: 50 },
    },
    uuidv4: vi.fn(() => 'uuid-1'),
    genericMetadataProvider: {
      add: segIoMocks.genericMetadataAdd,
    },
  },
  getEnabledElementByViewportId: segIoMocks.getEnabledElementByViewportId,
}));

vi.mock('@cornerstonejs/tools', () => ({
  ToolGroupManager: {
    getToolGroup: vi.fn(() => undefined),
    createToolGroup: vi.fn(() => ({
      addTool: vi.fn(),
      addViewport: vi.fn(),
      setToolActive: vi.fn(),
      setToolDisabled: vi.fn(),
      setToolEnabled: vi.fn(),
      setToolConfiguration: vi.fn(),
      setActiveStrategy: vi.fn(),
      removeViewports: vi.fn(),
      getViewportIds: vi.fn(() => []),
    })),
    destroyToolGroup: vi.fn(),
  },
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
  SplineContourSegmentationTool: { toolName: 'SplineContourSegmentation' },
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
  annotation: {
    state: {
      getAllAnnotations: vi.fn(() => []),
      getAnnotation: segIoMocks.annotationGetAnnotation,
      removeAnnotation: segIoMocks.annotationRemoveAnnotation,
    },
    selection: {
      getAnnotationsSelected: segIoMocks.selectionGetAnnotationsSelected,
    },
  },
  segmentation: {
    state: {
      getSegmentations: segIoMocks.getSegmentations,
      getSegmentation: segIoMocks.getSegmentation,
      getViewportIdsWithSegmentation: segIoMocks.getViewportIdsWithSegmentation,
    },
    addSegmentations: segIoMocks.addSegmentations,
    removeSegmentation: segIoMocks.removeSegmentation,
    updateSegmentations: segIoMocks.updateSegmentations,
    removeSegment: segIoMocks.removeSegment,
    addLabelmapRepresentationToViewport: segIoMocks.addLabelmapRepresentationToViewport,
    addContourRepresentationToViewport: segIoMocks.addContourRepresentationToViewport,
    removeLabelmapRepresentation: segIoMocks.removeLabelmapRepresentation,
    removeContourRepresentation: segIoMocks.removeContourRepresentation,
    removeSegmentationRepresentations: segIoMocks.removeSegmentationRepresentations,
    removeSegmentationRepresentationsFromToolGroup: segIoMocks.removeSegmentationRepresentationsFromToolGroup,
    activeSegmentation: {
      setActiveSegmentation: segIoMocks.setActiveSegmentation,
      getActiveSegmentation: vi.fn(() => ({ segmentationId: 'seg-active' })),
    },
    segmentIndex: {
      setActiveSegmentIndex: segIoMocks.setActiveSegmentIndex,
      getActiveSegmentIndex: segIoMocks.getActiveSegmentIndex,
    },
    segmentLocking: {
      isSegmentIndexLocked: segIoMocks.isSegmentIndexLocked,
      setSegmentIndexLocked: segIoMocks.setSegmentIndexLocked,
      getLockedSegmentIndices: vi.fn(() => []),
    },
    config: {
      color: {
        getSegmentIndexColor: segIoMocks.getSegmentIndexColor,
        setSegmentIndexColor: segIoMocks.setSegmentIndexColor,
      },
      visibility: {
        getSegmentIndexVisibility: segIoMocks.getSegmentIndexVisibility,
        setSegmentIndexVisibility: segIoMocks.setSegmentIndexVisibility,
      },
    },
    segmentationStyle: {
      setStyle: segIoMocks.setStyle,
    },
    helpers: {
      convertStackToVolumeLabelmap: vi.fn(async () => undefined),
    },
    triggerSegmentationEvents: {
      triggerSegmentationDataModified: segIoMocks.triggerSegmentationDataModified,
    },
    defaultSegmentationStateManager: {
      _stackLabelmapImageIdReferenceMap: new Map(),
      _labelmapImageIdReferenceMap: new Map(),
    },
  },
  utilities: {
    segmentation: {
      triggerSegmentationRender: segIoMocks.triggerSegmentationRender,
      setBrushSizeForToolGroup: vi.fn(),
    },
    contourSegmentation: {
      removeContourSegmentationAnnotation: segIoMocks.removeContourSegmentationAnnotation,
    },
    triggerAnnotationRenderForViewportIds: vi.fn(),
  },
  Enums: {
    MouseBindings: {
      Primary: 1,
      Secondary: 2,
      Auxiliary: 4,
    },
    SegmentationRepresentations: {
      Labelmap: 'Labelmap',
      Contour: 'Contour',
    },
    Events: {
      ANNOTATION_COMPLETED: 'ANNOTATION_COMPLETED',
      ANNOTATION_MODIFIED: 'ANNOTATION_MODIFIED',
      ANNOTATION_REMOVED: 'ANNOTATION_REMOVED',
      SEGMENTATION_MODIFIED: 'SEGMENTATION_MODIFIED',
      SEGMENTATION_DATA_MODIFIED: 'SEGMENTATION_DATA_MODIFIED',
      SEGMENTATION_ADDED: 'SEGMENTATION_ADDED',
      SEGMENTATION_REMOVED: 'SEGMENTATION_REMOVED',
      SEGMENTATION_REPRESENTATION_MODIFIED: 'SEGMENTATION_REPRESENTATION_MODIFIED',
      SEGMENTATION_REPRESENTATION_ADDED: 'SEGMENTATION_REPRESENTATION_ADDED',
      SEGMENTATION_REPRESENTATION_REMOVED: 'SEGMENTATION_REPRESENTATION_REMOVED',
    },
  },
}));

vi.mock('@cornerstonejs/adapters', () => ({
  adaptersSEG: {
    Cornerstone3D: {
      Segmentation: {
        createFromDICOMSegBuffer: segIoMocks.adaptersCreateFromDicomSegBuffer,
        generateSegmentation: segIoMocks.adaptersGenerateSegmentation,
      },
    },
  },
  utilities: {},
}));

vi.mock('dcmjs', () => ({
  data: {
    Colors: {
      dicomlab2RGB: segIoMocks.dicomlab2RGB,
      rgb2DICOMLAB: segIoMocks.rgb2DICOMLAB,
    },
    DicomMetaDictionary: {
      denaturalizeDataset: segIoMocks.denaturalizeDataset,
    },
    DicomDict: class DicomDict {},
  },
}));

vi.mock('dicom-parser', () => ({
  parseDicom: segIoMocks.parseDicom,
}));

vi.mock('../tools/SafePaintFillTool', () => ({
  default: { toolName: 'SafePaintFill' },
}));

vi.mock('../rtStructService', () => ({
  rtStructService: {
    parseRtStruct: vi.fn(() => ({ referencedSeriesUID: null })),
  },
}));

vi.mock('../writeDicomDict', () => ({
  writeDicomDict: segIoMocks.writeDicomDict,
}));

import { segmentationService } from '../segmentationService';

function resetStores(): void {
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
  useSegmentationManagerStore.setState(useSegmentationManagerStore.getInitialState(), true);
  useViewerStore.setState(useViewerStore.getInitialState(), true);
}

describe('segmentationService load/export integration (mocked cornerstone)', () => {
  beforeEach(() => {
    segIoMocks.reset();
    resetStores();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));

    segIoMocks.imageCache.set('src-1', {
      imageId: 'src-1',
      rows: 2,
      columns: 2,
      rowPixelSpacing: 1,
      columnPixelSpacing: 1,
    });
    segIoMocks.imageCache.set('src-2', {
      imageId: 'src-2',
      rows: 2,
      columns: 2,
      rowPixelSpacing: 1,
      columnPixelSpacing: 1,
    });

    segIoMocks.metadataMap.set('generalImageModule|src-1', { sopInstanceUID: 'sop-1' });
    segIoMocks.metadataMap.set('generalImageModule|src-2', { sopInstanceUID: 'sop-2' });
    segIoMocks.metadataMap.set('instance|src-1', { SOPInstanceUID: 'sop-1', Rows: 2, Columns: 2 });
    segIoMocks.metadataMap.set('instance|src-2', { SOPInstanceUID: 'sop-2', Rows: 2, Columns: 2 });
    segIoMocks.metadataMap.set('imagePixelModule|src-1', { rows: 2, columns: 2 });
    segIoMocks.metadataMap.set('imagePlaneModule|src-1', {
      imagePositionPatient: [0, 0, 0],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0],
      rowPixelSpacing: 1,
      columnPixelSpacing: 1,
      frameOfReferenceUID: 'FOR-1',
    });
    segIoMocks.metadataMap.set('imagePlaneModule|src-2', {
      imagePositionPatient: [0, 0, 1],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0],
      rowPixelSpacing: 1,
      columnPixelSpacing: 1,
      frameOfReferenceUID: 'FOR-1',
    });
    segIoMocks.metadataMap.set('generalSeriesModule|src-1', { seriesInstanceUID: 'SER-1' });
    segIoMocks.metadataMap.set('generalSeriesModule|src-2', { seriesInstanceUID: 'SER-1' });
    segIoMocks.metadataMap.set('patientModule|src-1', { patientName: 'Doe^Jane', patientId: 'P-1' });
    segIoMocks.metadataMap.set('generalStudyModule|src-1', { studyInstanceUID: 'STUDY-1' });
  });

  it('loads DICOM SEG as multi-layer group with remapped colors and tracked source IDs', async () => {
    const loaded = await segmentationService.loadDicomSeg(new ArrayBuffer(8), ['src-1', 'src-2']);

    expect(loaded.segmentationId).toContain('seg_dicom_');
    expect(loaded.firstNonZeroReferencedImageId).toBeTruthy();
    expect(segIoMocks.adaptersCreateFromDicomSegBuffer).toHaveBeenCalled();
    expect(segIoMocks.createAndCacheLocalImage).toHaveBeenCalled();
    expect(segIoMocks.addSegmentations).toHaveBeenCalled();
    expect(useSegmentationStore.getState().activeSegmentationId).toBe(loaded.segmentationId);
    expect(useSegmentationStore.getState().segmentations.length).toBeGreaterThan(0);
  });

  it('exports loaded group segmentation through temporary legacy path and returns base64 payload', async () => {
    const loaded = await segmentationService.loadDicomSeg(new ArrayBuffer(8), ['src-1', 'src-2']);
    const base64 = await segmentationService.exportToDicomSeg(loaded.segmentationId);

    expect(base64).toBe('QUJD');
    expect(segIoMocks.adaptersGenerateSegmentation).toHaveBeenCalled();
    expect(segIoMocks.denaturalizeDataset).toHaveBeenCalled();
    expect(segIoMocks.writeDicomDict).toHaveBeenCalled();
  });

  it('rejects load when source image IDs are empty', async () => {
    await expect(segmentationService.loadDicomSeg(new ArrayBuffer(4), [])).rejects.toThrow(
      'No source imageIds were provided',
    );
  });

  it('creates stack/contour segmentations and exercises visibility/color/lock lifecycle helpers', async () => {
    const stackSegId = await segmentationService.createStackSegmentation(['src-1', 'src-2'], 'Draft SEG', true);
    await segmentationService.addToViewport('panel_0', stackSegId);
    segmentationService.setActiveSegmentIndex(stackSegId, 1);
    segmentationService.setSegmentColor(stackSegId, 1, [12, 34, 56, 255]);
    segmentationService.toggleSegmentVisibility('panel_0', stackSegId, 1);
    segmentationService.setSegmentVisibility('panel_0', stackSegId, 1, true);
    segmentationService.toggleSegmentLocked(stackSegId, 1);
    expect(segmentationService.getSegmentLocked(stackSegId, 1)).toBe(true);
    expect(segmentationService.getSegmentVisibility('panel_0', stackSegId, 1)).toBe(true);

    segmentationService.renameSegmentation(stackSegId, 'Renamed SEG');
    segmentationService.renameSegment(stackSegId, 1, 'Segment A');
    segmentationService.updateStyle(0.4, true);
    segmentationService.setBrushSize(11);
    segmentationService.setDefaultColorSequence([[9, 8, 7, 255]]);
    segmentationService.trackSourceImageIds(stackSegId, ['src-1', 'src-2']);
    expect(segmentationService.getTrackedSourceImageIds(stackSegId)).toEqual(['src-1', 'src-2']);
    expect(segmentationService.getPreferredDicomType(stackSegId)).toBe('SEG');
    expect(typeof segmentationService.hasExportableContent(stackSegId, 'SEG')).toBe('boolean');
    expect(typeof segmentationService.hasExportableContent(stackSegId, 'RTSTRUCT')).toBe('boolean');

    segmentationService.removeSegment(stackSegId, 1);
    segmentationService.removeSegmentation(stackSegId);

    const contourSegId = await segmentationService.createContourSegmentation(['src-1', 'src-2'], 'Draft RT', false);
    await segmentationService.addSegment(contourSegId, 'Contour 1', [120, 110, 100, 255]);
    await segmentationService.ensureContourRepresentation('panel_0', contourSegId);
    segmentationService.activateOnViewport('panel_0', contourSegId);
    segmentationService.updateContourStyle(3);
    expect(segmentationService.getPreferredDicomType(contourSegId)).toBe('RTSTRUCT');
    segmentationService.removeSegmentation(contourSegId);
  });

  it('handles undo/redo/manual-save/load counters and viewport detach flow without throwing', async () => {
    const segId = await segmentationService.createStackSegmentation(['src-1', 'src-2'], 'Detach Test', true);
    await segmentationService.addToViewport('panel_0', segId);

    segmentationService.beginSegLoad();
    segmentationService.beginManualSave();
    segmentationService.endManualSave();
    segmentationService.endSegLoad();

    segmentationService.undo();
    segmentationService.redo();
    expect(segmentationService.getUndoState()).toEqual({ canUndo: false, canRedo: false });

    segmentationService.suppressDirtyTrackingFor(250);
    segmentationService.runWithDirtyTrackingSuppressed(() => {
      segmentationService.removeSegmentationsFromViewport('panel_0');
    });

    expect(() => segmentationService.cancelAutoSave()).not.toThrow();
    segmentationService.removeSegmentation(segId);
  });

  it('ensures empty segmentations for legacy and group paths', async () => {
    segIoMocks.segmentationMap.set('legacy-seg', {
      segmentationId: 'legacy-seg',
      label: 'Legacy',
      segments: {
        1: { segmentIndex: 1, label: 'A' },
      },
      representationData: {
        Labelmap: { imageIds: ['src-1'] },
        Contour: { annotationUIDsMap: new Map<number, Set<string>>([[1, new Set(['ann-1'])]]) },
      },
    });

    segmentationService.ensureEmptySegmentation('legacy-seg');
    expect(segIoMocks.updateSegmentations).toHaveBeenCalled();

    const groupId = await segmentationService.createStackSegmentation(['src-1', 'src-2'], 'Group', false);
    segmentationService.ensureEmptySegmentation(groupId);
    expect(useSegmentationStore.getState().activeSegmentIndex).toBe(0);
  });

  it('deletes selected contour components with filtering and render triggers', async () => {
    const contourId = await segmentationService.createContourSegmentation(['src-1', 'src-2'], 'Contours', true);
    await segmentationService.ensureContourRepresentation('panel_0', contourId);
    segIoMocks.viewportIdsBySeg.set(contourId, new Set(['panel_0']));

    segIoMocks.selectionGetAnnotationsSelected.mockReturnValue(['ann-1', 'ann-2', 'ann-3']);
    segIoMocks.annotationGetAnnotation.mockImplementation((uid: string) => {
      if (uid === 'ann-1') {
        return {
          annotationUID: uid,
          data: { segmentation: { segmentationId: contourId, segmentIndex: 1 } },
        };
      }
      if (uid === 'ann-2') {
        return {
          annotationUID: uid,
          data: { segmentation: { segmentationId: contourId, segmentIndex: 2 } },
        };
      }
      return null;
    });

    const removed = segmentationService.deleteSelectedContourComponents(contourId, 1);
    expect(removed).toBe(true);
    expect(segIoMocks.removeContourSegmentationAnnotation).toHaveBeenCalledTimes(1);
    expect(segIoMocks.annotationRemoveAnnotation).toHaveBeenCalledWith('ann-1');
    expect(segIoMocks.annotationRemoveAnnotation).not.toHaveBeenCalledWith('ann-2');
  });

  it('removes segmentations and viewport representations for legacy and group IDs', async () => {
    segIoMocks.segmentationMap.set('legacy-seg', {
      segmentationId: 'legacy-seg',
      label: 'Legacy',
      segments: { 1: { segmentIndex: 1, label: 'A' } },
      representationData: { Labelmap: { imageIds: ['src-1'] } },
    });
    segIoMocks.viewportIdsBySeg.set('legacy-seg', new Set(['panel_0']));
    segmentationService.removeSegmentation('legacy-seg');
    expect(segIoMocks.removeLabelmapRepresentation).toHaveBeenCalledWith('panel_0', 'legacy-seg');
    expect(segIoMocks.removeSegmentation).toHaveBeenCalledWith('legacy-seg');

    const groupId = await segmentationService.createStackSegmentation(['src-1', 'src-2'], 'Group', true);
    await segmentationService.addToViewport('panel_0', groupId);
    segmentationService.removeSegmentation(groupId);
    expect(useSegmentationStore.getState().segmentations.some((s) => s.segmentationId === groupId)).toBe(false);
  });

  it('activates segmentations on viewports across group and legacy paths', async () => {
    const groupId = await segmentationService.createStackSegmentation(['src-1', 'src-2'], 'Group', true);
    await segmentationService.addToViewport('panel_0', groupId);
    segmentationService.setActiveSegmentIndex(groupId, 1);
    segmentationService.activateOnViewport('panel_0', groupId);
    expect(segIoMocks.setActiveSegmentation).toHaveBeenCalled();

    segIoMocks.segmentationMap.set('legacy-seg', {
      segmentationId: 'legacy-seg',
      label: 'Legacy',
      segments: { 1: { segmentIndex: 1, label: 'A' } },
      representationData: { Labelmap: { imageIds: ['src-1'] } },
    });
    segIoMocks.viewportIdsBySeg.set('legacy-seg', new Set(['panel_1']));
    segmentationService.activateOnViewport('panel_1', 'legacy-seg');
    expect(segIoMocks.setActiveSegmentation).toHaveBeenCalledWith('panel_1', 'legacy-seg');
  });

  it('ensures contour representation scaffolding and fallback color assignment', async () => {
    segIoMocks.segmentationMap.set('contour-manual', {
      segmentationId: 'contour-manual',
      label: 'Contour Manual',
      segments: {},
      representationData: {},
    });
    segIoMocks.viewportIdsBySeg.set('contour-manual', new Set(['panel_0']));
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegmentIndex: 2,
      contourLineWidth: 5,
      contourOpacity: 0.8,
    });
    segIoMocks.getSegmentIndexColor.mockImplementation(() => {
      throw new Error('no color');
    });

    await segmentationService.ensureContourRepresentation('panel_0', 'contour-manual');

    expect(segIoMocks.addContourRepresentationToViewport).toHaveBeenCalledWith('panel_0', [
      { segmentationId: 'contour-manual' },
    ]);
    expect(segIoMocks.setSegmentIndexColor).toHaveBeenCalledWith(
      'panel_0',
      'contour-manual',
      2,
      expect.any(Array),
    );
    expect(segIoMocks.setStyle).toHaveBeenCalled();
  });

  it('reports exportable content for labelmap and contour segmentations', async () => {
    const groupId = await segmentationService.createStackSegmentation(['src-1', 'src-2'], 'Group', true);
    const groupSeg = useSegmentationStore
      .getState()
      .segmentations
      .find((s) => s.segmentationId === groupId);
    expect(groupSeg).toBeTruthy();

    const subSeg = Array.from(segIoMocks.segmentationMap.values()).find((seg) =>
      typeof seg.segmentationId === 'string' && seg.segmentationId.startsWith(`${groupId}_layer_`),
    );
    const firstLmId = subSeg?.representationData?.Labelmap?.imageIds?.[0];
    if (firstLmId) {
      segIoMocks.imageCache.set(firstLmId, {
        imageId: firstLmId,
        voxelManager: { getScalarData: () => new Uint8Array([0, 1, 0, 0]) },
      });
    }
    expect(segmentationService.hasExportableContent(groupId, 'SEG')).toBe(true);
    expect(segmentationService.hasExportableContent(groupId, 'RTSTRUCT')).toBe(false);

    const contourId = await segmentationService.createContourSegmentation(['src-1', 'src-2'], 'Contours', true);
    const contour = segIoMocks.segmentationMap.get(contourId);
    contour.representationData.Contour.annotationUIDsMap.get(1).add('ann-1');
    expect(segmentationService.hasExportableContent(contourId, 'RTSTRUCT')).toBe(true);
  });

  it('rejects SEG load when geometry is broken and pixel data is empty', async () => {
    segIoMocks.parseDicom.mockReturnValueOnce({
      uint16: (tag: string) => (tag === 'x00280010' || tag === 'x00280011' ? 0 : 0),
      elements: {
        x7fe00010: { length: 0 },
        x00280010: { dataOffset: 0 },
        x00280011: { dataOffset: 2 },
      },
    });

    await expect(
      segmentationService.loadDicomSeg(new ArrayBuffer(8), ['src-1', 'src-2']),
    ).rejects.toThrow('cannot be recovered');
  });

  it('fails export validation when serialized DICOM has invalid dimensions', async () => {
    const groupId = await segmentationService.createStackSegmentation(['src-1', 'src-2'], 'Group', true);
    const subSeg = Array.from(segIoMocks.segmentationMap.values()).find((seg) =>
      typeof seg.segmentationId === 'string' && seg.segmentationId.startsWith(`${groupId}_layer_`),
    );
    const firstLmId = subSeg?.representationData?.Labelmap?.imageIds?.[0];
    if (firstLmId) {
      segIoMocks.imageCache.set(firstLmId, {
        imageId: firstLmId,
        voxelManager: { getScalarData: () => new Uint8Array([1, 0, 0, 0]) },
        referencedImageId: 'src-1',
      });
    }
    segIoMocks.parseDicom.mockReturnValue({
      uint16: (tag: string) => (tag === 'x00280010' || tag === 'x00280011' ? 0 : 0),
      elements: {
        x7fe00010: { length: 4 },
        x00280010: { dataOffset: 0 },
        x00280011: { dataOffset: 2 },
      },
    });

    await expect(segmentationService.exportToDicomSeg(groupId)).rejects.toThrow(
      'DICOM SEG binary validation failed',
    );
  });

  it('updates labels and reports segmentation existence/viewport bindings', async () => {
    segIoMocks.segmentationMap.set('legacy-lbl', {
      segmentationId: 'legacy-lbl',
      label: 'Legacy Label',
      segments: { 1: { segmentIndex: 1, label: 'A' } },
      representationData: { Labelmap: { imageIds: ['src-1'] } },
    });
    segIoMocks.viewportIdsBySeg.set('legacy-lbl', new Set(['panel_1']));

    segmentationService.setLabel('legacy-lbl', 'Renamed Legacy');
    expect(segIoMocks.segmentationMap.get('legacy-lbl')?.label).toBe('Renamed Legacy');
    expect(segmentationService.segmentationExists('legacy-lbl')).toBe(true);
    expect(segmentationService.getViewportIdsForSegmentation('legacy-lbl')).toEqual(['panel_1']);

    const groupId = await segmentationService.createStackSegmentation(['src-1', 'src-2'], 'Group Label', false);
    await segmentationService.addToViewport('panel_0', groupId);
    segmentationService.setLabel(groupId, 'Renamed Group');
    const summary = useSegmentationStore.getState().segmentations.find((s) => s.segmentationId === groupId);
    expect(summary?.label).toBe('Renamed Group');
    expect(segmentationService.segmentationExists(groupId)).toBe(true);
    expect(segmentationService.getViewportIdsForSegmentation(groupId)).toContain('panel_0');
  });

  it('flushAutoSaveNow writes temp autosaves and clears dirty state on success', async () => {
    segIoMocks.segmentationMap.set('legacy-auto', {
      segmentationId: 'legacy-auto',
      label: 'Auto',
      segments: { 1: { segmentIndex: 1, label: 'A' } },
      representationData: { Labelmap: { imageIds: ['lm-1'] } },
    });
    segIoMocks.imageCache.set('lm-1', {
      imageId: 'lm-1',
      voxelManager: { getScalarData: () => new Uint8Array([0, 1, 0, 0]) },
      referencedImageId: 'src-1',
    });
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegmentationId: 'legacy-auto',
      hasUnsavedChanges: true,
      autoSaveEnabled: false,
      xnatOriginMap: {
        'legacy-auto': {
          scanId: '3001',
          sourceScanId: '11',
          projectId: 'P1',
          sessionId: 'S1',
        },
      },
    });
    useViewerStore.setState({
      ...useViewerStore.getState(),
      xnatContext: {
        projectId: 'P1',
        subjectId: 'SUB1',
        sessionId: 'S1',
        sessionLabel: 'Session 1',
        scanId: '11',
      } as any,
    });

    const deleteTempFile = vi.fn(async () => ({ ok: true }));
    const autoSaveTemp = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('window', {
      electronAPI: {
        xnat: {
          listTempFiles: vi.fn(async () => ({
            ok: true,
            files: [
              { name: 'autosave_seg_11_20260301120000.dcm' },
              { name: 'other_file.dcm' },
            ],
          })),
          deleteTempFile,
          autoSaveTemp,
        },
      },
    });

    const exportSpy = vi.spyOn(segmentationService, 'exportToDicomSeg').mockResolvedValue('QUJD');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER);
    const ok = await segmentationService.flushAutoSaveNow();
    nowSpy.mockRestore();

    expect(ok).toBe(true);
    expect(deleteTempFile).toHaveBeenCalledWith('S1', 'autosave_seg_11_20260301120000.dcm');
    expect(autoSaveTemp).toHaveBeenCalledWith(
      'S1',
      '11',
      'QUJD',
      expect.stringMatching(/^autosave_seg_11_\d{14}\.dcm$/),
    );
    expect(useSegmentationStore.getState().hasUnsavedChanges).toBe(false);
    exportSpy.mockRestore();
  });

  it('flushAutoSaveNow handles empty-seg export errors as idle (non-fatal)', async () => {
    segIoMocks.segmentationMap.set('legacy-auto', {
      segmentationId: 'legacy-auto',
      label: 'Auto',
      segments: { 1: { segmentIndex: 1, label: 'A' } },
      representationData: { Labelmap: { imageIds: ['lm-1'] } },
    });
    segIoMocks.imageCache.set('lm-1', {
      imageId: 'lm-1',
      voxelManager: { getScalarData: () => new Uint8Array([0, 1, 0, 0]) },
      referencedImageId: 'src-1',
    });
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegmentationId: 'legacy-auto',
      hasUnsavedChanges: true,
      autoSaveEnabled: true,
    });
    useViewerStore.setState({
      ...useViewerStore.getState(),
      xnatContext: {
        projectId: 'P1',
        subjectId: 'SUB1',
        sessionId: 'S1',
        sessionLabel: 'Session 1',
        scanId: '11',
      } as any,
    });
    vi.stubGlobal('window', {
      electronAPI: {
        xnat: {
          listTempFiles: vi.fn(async () => ({ ok: true, files: [] })),
          deleteTempFile: vi.fn(async () => ({ ok: true })),
          autoSaveTemp: vi.fn(async () => ({ ok: true })),
        },
      },
    });

    const exportSpy = vi
      .spyOn(segmentationService, 'exportToDicomSeg')
      .mockRejectedValue(new Error('No painted segment data found in any slice'));

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER);
    const ok = await segmentationService.flushAutoSaveNow();
    nowSpy.mockRestore();
    expect(ok).toBe(false);
    expect(useSegmentationStore.getState().autoSaveStatus).toBe('idle');
    exportSpy.mockRestore();
  });
});
