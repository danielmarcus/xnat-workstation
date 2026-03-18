import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSegmentationStore } from '../../../stores/segmentationStore';

const rtStructMocks = vi.hoisted(() => {
  const metadataMap = new Map<string, unknown>();
  const segmentations = new Map<string, any>();
  let uuidCounter = 0;

  const generateRTSSFromContour = vi.fn((_seg: unknown) => ({
    _meta: { FileMetaInformationVersion: { Value: [0, 1], vr: 'OB' } },
    ReferencedFrameOfReferenceSequence: [],
    ROIContourSequence: [
      { ReferencedROINumber: 1, ROIDisplayColor: [1, 2, 3] },
    ],
  }));

  return {
    metadataMap,
    segmentations,
    reset() {
      metadataMap.clear();
      segmentations.clear();
      uuidCounter = 0;
      vi.clearAllMocks();
    },
    parseDicom: vi.fn(),
    addProvider: vi.fn(),
    metaDataGet: vi.fn((type: string, imageId: string) => metadataMap.get(`${type}|${imageId}`)),
    uuidv4: vi.fn(() => {
      uuidCounter += 1;
      return `ann-${uuidCounter}`;
    }),
    getEnabledElementByViewportId: vi.fn(() => ({ viewport: { render: vi.fn() } })),
    addSegmentations: vi.fn((defs: any[]) => {
      for (const def of defs) {
        segmentations.set(def.segmentationId, {
          segmentationId: def.segmentationId,
          representationData: def.representation?.data
            ? { Contour: def.representation.data }
            : {},
          config: def.config,
          segments: def.config?.segments ?? {},
        });
      }
    }),
    getSegmentation: vi.fn((segmentationId: string) => segmentations.get(segmentationId)),
    addContourRepresentationToViewport: vi.fn(),
    setActiveSegmentation: vi.fn(),
    setSegmentIndexColor: vi.fn(),
    triggerSegmentationDataModified: vi.fn(),
    addAnnotation: vi.fn(),
    triggerSegmentationRender: vi.fn(),
    trackSourceImageIds: vi.fn(),
    updateContourStyle: vi.fn(),
    setActiveSegmentIndex: vi.fn(),
    sync: vi.fn(),
    getTrackedSourceImageIds: vi.fn(() => ['img-1']),
    denaturalizeDataset: vi.fn((dataset: unknown) => ({ dataset })),
    writeDicomDict: vi.fn(() => {
      const bytes = new Uint8Array([65, 66]); // "AB"
      return bytes.buffer;
    }),
    generateRTSSFromContour,
  };
});

vi.mock('dicom-parser', () => ({
  parseDicom: rtStructMocks.parseDicom,
}));

vi.mock('@cornerstonejs/core', () => ({
  metaData: {
    addProvider: rtStructMocks.addProvider,
    get: rtStructMocks.metaDataGet,
  },
  utilities: {
    uuidv4: rtStructMocks.uuidv4,
  },
  getEnabledElementByViewportId: rtStructMocks.getEnabledElementByViewportId,
}));

vi.mock('@cornerstonejs/tools', () => ({
  segmentation: {
    addSegmentations: rtStructMocks.addSegmentations,
    state: {
      getSegmentation: rtStructMocks.getSegmentation,
    },
    addContourRepresentationToViewport: rtStructMocks.addContourRepresentationToViewport,
    activeSegmentation: {
      setActiveSegmentation: rtStructMocks.setActiveSegmentation,
    },
    config: {
      color: {
        setSegmentIndexColor: rtStructMocks.setSegmentIndexColor,
      },
    },
    triggerSegmentationEvents: {
      triggerSegmentationDataModified: rtStructMocks.triggerSegmentationDataModified,
    },
    segmentLocking: {
      setSegmentIndexLocked: vi.fn(),
    },
  },
  annotation: {
    state: {
      addAnnotation: rtStructMocks.addAnnotation,
    },
  },
  Enums: {
    SegmentationRepresentations: {
      Contour: 'Contour',
    },
  },
  utilities: {
    segmentation: {
      triggerSegmentationRender: rtStructMocks.triggerSegmentationRender,
    },
  },
}));

vi.mock('@cornerstonejs/adapters', () => ({
  adaptersRT: {
    Cornerstone3D: {
      RTSS: {
        generateRTSSFromContour: rtStructMocks.generateRTSSFromContour,
      },
    },
  },
}));

vi.mock('dcmjs', () => ({
  data: {
    DicomMetaDictionary: {
      denaturalizeDataset: rtStructMocks.denaturalizeDataset,
    },
  },
}));

vi.mock('../segmentationService', () => ({
  segmentationService: {
    trackSourceImageIds: rtStructMocks.trackSourceImageIds,
    updateContourStyle: rtStructMocks.updateContourStyle,
    setActiveSegmentIndex: rtStructMocks.setActiveSegmentIndex,
    sync: rtStructMocks.sync,
    getTrackedSourceImageIds: rtStructMocks.getTrackedSourceImageIds,
  },
}));

vi.mock('../writeDicomDict', () => ({
  writeDicomDict: rtStructMocks.writeDicomDict,
}));

import { rtStructService } from '../rtStructService';

type MockDataSet = {
  elements: Record<string, any>;
  string: (tag: string) => string | undefined;
  intString: (tag: string) => number | undefined;
};

function ds({
  strings = {},
  ints = {},
  elements = {},
}: {
  strings?: Record<string, string>;
  ints?: Record<string, number>;
  elements?: Record<string, any>;
} = {}): MockDataSet {
  return {
    elements,
    string: (tag: string) => strings[tag],
    intString: (tag: string) => ints[tag],
  };
}

describe('rtStructService', () => {
  beforeEach(() => {
    rtStructMocks.reset();
    useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
  });

  it('parses ROIs/contours and resolves referenced series UID from nested RTSTRUCT sequences', () => {
    const contourDataSet = ds({
      strings: {
        x30060042: 'CLOSED_PLANAR',
        x30060050: '1\\2\\3\\4\\5\\6\\7\\8\\9',
      },
      ints: { x30060046: 3 },
      elements: {
        x30060016: {
          items: [{ dataSet: ds({ strings: { x00081155: 'sop-2' } }) }],
        },
      },
    });

    rtStructMocks.parseDicom.mockReturnValue(
      ds({
        strings: { x30060002: 'RT Label', x30060004: 'RT Name' },
        elements: {
          x30060020: {
            items: [{ dataSet: ds({ ints: { x30060022: 1 }, strings: { x30060026: 'Liver' } }) }],
          },
          x30060080: {
            items: [{ dataSet: ds({ ints: { x30060084: 1 }, strings: { x300600a4: 'ORGAN' } }) }],
          },
          x30060039: {
            items: [
              {
                dataSet: ds({
                  ints: { x30060084: 1 },
                  strings: { x3006002a: '255\\10\\20' },
                  elements: { x30060040: { items: [{ dataSet: contourDataSet }] } },
                }),
              },
            ],
          },
          x30060010: {
            items: [
              {
                dataSet: ds({
                  elements: {
                    x30060012: {
                      items: [
                        {
                          dataSet: ds({
                            elements: {
                              x30060014: {
                                items: [{ dataSet: ds({ strings: { x0020000e: 'SER-1' } }) }],
                              },
                            },
                          }),
                        },
                      ],
                    },
                  },
                }),
              },
            ],
          },
        },
      }),
    );

    const parsed = rtStructService.parseRtStruct(new ArrayBuffer(8));
    expect(parsed.structureSetLabel).toBe('RT Label');
    expect(parsed.referencedSeriesUID).toBe('SER-1');
    expect(parsed.rois).toHaveLength(1);
    expect(parsed.rois[0]).toMatchObject({
      roiNumber: 1,
      name: 'Liver',
      interpretedType: 'ORGAN',
      color: [255, 10, 20],
    });
    expect(parsed.rois[0]?.contours[0]).toMatchObject({
      referencedSOPInstanceUID: 'sop-2',
      geometricType: 'CLOSED_PLANAR',
    });
  });

  it('loads parsed RTSTRUCT into contour segmentation state and syncs stores/services', async () => {
    rtStructMocks.metadataMap.set('sopCommonModule|img-1', { sopInstanceUID: 'sop-1' });
    rtStructMocks.metadataMap.set('sopCommonModule|img-2', { sopInstanceUID: 'sop-2' });
    rtStructMocks.metadataMap.set('imagePlaneModule|img-1', { frameOfReferenceUID: 'FOR-1', imagePositionPatient: [0, 0, 0] });
    rtStructMocks.metadataMap.set('imagePlaneModule|img-2', { frameOfReferenceUID: 'FOR-1', imagePositionPatient: [0, 0, 5] });

    const parsed = {
      structureSetLabel: 'RTSTRUCT A',
      structureSetName: 'Name A',
      referencedSeriesUID: 'SER-1',
      rois: [
        {
          roiNumber: 1,
          name: 'Lesion',
          color: [250, 20, 30] as [number, number, number],
          interpretedType: 'ORGAN',
          contours: [
            {
              points: [1, 1, 5, 2, 1, 5, 2, 2, 5],
              referencedSOPInstanceUID: 'sop-2',
              geometricType: 'CLOSED_PLANAR',
            },
          ],
        },
      ],
    };

    const result = await rtStructService.loadRtStructAsContours(parsed, ['img-1', 'img-2'], 'panel_0');

    expect(result.segmentationId).toContain('rtstruct_');
    expect(result.firstReferencedImageId).toBe('img-2');
    expect(rtStructMocks.addSegmentations).toHaveBeenCalled();
    expect(rtStructMocks.addAnnotation).toHaveBeenCalledTimes(1);
    expect(rtStructMocks.trackSourceImageIds).toHaveBeenCalledWith(result.segmentationId, ['img-1', 'img-2']);
    expect(rtStructMocks.updateContourStyle).toHaveBeenCalled();
    expect(rtStructMocks.setActiveSegmentIndex).toHaveBeenCalledWith(result.segmentationId, 1);
    expect(rtStructMocks.sync).toHaveBeenCalled();
    expect(useSegmentationStore.getState().activeSegmentationId).toBe(result.segmentationId);
  });

  it('exports contour segmentation to base64 RTSTRUCT and applies source metadata + segment colors', async () => {
    const segmentationId = 'seg-rt-1';
    rtStructMocks.segmentations.set(segmentationId, {
      segmentationId,
      representationData: {
        Contour: {
          annotationUIDsMap: new Map([[1, new Set(['ann-1'])]]),
        },
      },
      segments: { 1: { segmentIndex: 1, label: 'A' } },
    });
    rtStructMocks.metadataMap.set('patientModule|img-1', { patientName: 'Doe^Jane', patientId: 'PID-1' });
    rtStructMocks.metadataMap.set('generalStudyModule|img-1', { studyInstanceUID: 'STUDY-1' });
    rtStructMocks.metadataMap.set('generalSeriesModule|img-1', { seriesInstanceUID: 'SER-1' });
    rtStructMocks.metadataMap.set('imagePlaneModule|img-1', { frameOfReferenceUID: 'FOR-1' });

    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      segmentations: [
        {
          segmentationId,
          label: 'RT',
          isActive: true,
          segments: [
            { segmentIndex: 1, label: 'A', visible: true, locked: false, color: [99, 88, 77, 255] },
          ],
        },
      ],
    });

    const output = await rtStructService.exportToRtStruct(segmentationId);
    expect(output).toBe('QUI=');
    expect(rtStructMocks.generateRTSSFromContour).toHaveBeenCalledWith(
      expect.objectContaining({ segmentationId }),
      expect.objectContaining({ metadataProvider: expect.any(Object) }),
    );
    expect(rtStructMocks.denaturalizeDataset).toHaveBeenCalled();
    expect(rtStructMocks.writeDicomDict).toHaveBeenCalled();
  });

  it('throws clear export errors for missing segmentation or missing contour representation', async () => {
    await expect(rtStructService.exportToRtStruct('missing')).rejects.toThrow('Segmentation not found');

    rtStructMocks.segmentations.set('seg-no-contour', { segmentationId: 'seg-no-contour', representationData: {} });
    await expect(rtStructService.exportToRtStruct('seg-no-contour')).rejects.toThrow(
      'Segmentation has no contour representation',
    );
  });
});
