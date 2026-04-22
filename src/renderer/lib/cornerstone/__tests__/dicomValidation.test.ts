/**
 * Unit tests for the extracted DICOM validation helpers. Exercises the
 * RTSTRUCT structural validator and supporting helpers directly, without
 * going through rtStructService — gives fast failure signal when callers
 * pass in malformed datasets.
 */
import { describe, expect, it } from 'vitest';
import {
  parsePositiveInt,
  normalizeContourImageSequenceItems,
  collectContourImageReferencesFromRtStruct,
  contourImageReferenceKey,
  validateRtStructDataset,
} from '../dicomValidation';

/** A minimally-valid RTSTRUCT naturalized dataset used as a base in tests. */
function buildValidRtStructDataset() {
  return {
    StructureSetROISequence: [
      { ROINumber: 1, ROIName: 'A' },
      { ROINumber: 2, ROIName: 'B' },
    ],
    ROIContourSequence: [
      {
        ReferencedROINumber: 1,
        ContourSequence: [
          {
            ContourImageSequence: [{ ReferencedSOPInstanceUID: 'SOP-A' }],
          },
        ],
      },
      {
        ReferencedROINumber: 2,
        ContourSequence: [
          {
            ContourImageSequence: { ReferencedSOPInstanceUID: 'SOP-B' }, // single-object form
          },
        ],
      },
    ],
    RTROIObservationsSequence: [
      { ObservationNumber: 1, ReferencedROINumber: 1 },
      { ObservationNumber: 2, ReferencedROINumber: 2 },
    ],
    ReferencedFrameOfReferenceSequence: [
      {
        FrameOfReferenceUID: 'FoR-1',
        RTReferencedStudySequence: [
          {
            RTReferencedSeriesSequence: [
              {
                SeriesInstanceUID: 'SER-1',
                ContourImageSequence: [
                  { ReferencedSOPInstanceUID: 'SOP-A' },
                  { ReferencedSOPInstanceUID: 'SOP-B' },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('parsePositiveInt', () => {
  it('accepts positive numbers and truncates', () => {
    expect(parsePositiveInt(3)).toBe(3);
    expect(parsePositiveInt(3.9)).toBe(3);
  });
  it('parses DICOM numeric strings', () => {
    expect(parsePositiveInt('42')).toBe(42);
    expect(parsePositiveInt(' 42 ')).toBe(42);
  });
  it('rejects zero, negatives, NaN, infinity, empty', () => {
    expect(parsePositiveInt(0)).toBeNull();
    expect(parsePositiveInt(-5)).toBeNull();
    expect(parsePositiveInt(Number.NaN)).toBeNull();
    expect(parsePositiveInt(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parsePositiveInt('')).toBeNull();
    expect(parsePositiveInt('abc')).toBeNull();
  });
  it('rejects non-primitive values', () => {
    expect(parsePositiveInt(undefined)).toBeNull();
    expect(parsePositiveInt(null)).toBeNull();
    expect(parsePositiveInt({} as unknown)).toBeNull();
  });
});

describe('normalizeContourImageSequenceItems', () => {
  it('passes arrays through, filtering non-objects', () => {
    expect(normalizeContourImageSequenceItems([{ a: 1 }, null, { b: 2 }, 'x']))
      .toEqual([{ a: 1 }, { b: 2 }]);
  });
  it('wraps a single object in an array (dcmjs single-item quirk)', () => {
    expect(normalizeContourImageSequenceItems({ a: 1 })).toEqual([{ a: 1 }]);
  });
  it('returns [] for missing/primitive input', () => {
    expect(normalizeContourImageSequenceItems(undefined)).toEqual([]);
    expect(normalizeContourImageSequenceItems(null)).toEqual([]);
    expect(normalizeContourImageSequenceItems('x')).toEqual([]);
  });
});

describe('contourImageReferenceKey', () => {
  it('keys by SOP UID plus frame number when present', () => {
    expect(contourImageReferenceKey({ ReferencedSOPInstanceUID: 'SOP-1', ReferencedFrameNumber: 3 }))
      .toBe('SOP-1|3');
  });
  it('uses empty frame slot when frame number absent or invalid', () => {
    expect(contourImageReferenceKey({ ReferencedSOPInstanceUID: 'SOP-1' })).toBe('SOP-1|');
    expect(contourImageReferenceKey({ ReferencedSOPInstanceUID: 'SOP-1', ReferencedFrameNumber: 0 })).toBe('SOP-1|');
  });
  it('yields the same key for duplicate references (dedup invariant)', () => {
    const a = contourImageReferenceKey({ ReferencedSOPInstanceUID: 'S', ReferencedFrameNumber: '2' });
    const b = contourImageReferenceKey({ ReferencedSOPInstanceUID: 'S', ReferencedFrameNumber: 2 });
    expect(a).toBe(b);
  });
});

describe('collectContourImageReferencesFromRtStruct', () => {
  it('deduplicates references by SOP UID + frame number', () => {
    const dataset = {
      ROIContourSequence: [
        {
          ContourSequence: [
            { ContourImageSequence: [{ ReferencedSOPInstanceUID: 'SOP-1', ReferencedSOPClassUID: 'CT' }] },
            { ContourImageSequence: [{ ReferencedSOPInstanceUID: 'SOP-1', ReferencedSOPClassUID: 'CT' }] }, // dup
            { ContourImageSequence: [{ ReferencedSOPInstanceUID: 'SOP-2', ReferencedSOPClassUID: 'CT' }] },
          ],
        },
      ],
    };

    const refs = collectContourImageReferencesFromRtStruct(dataset);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.ReferencedSOPInstanceUID)).toEqual(['SOP-1', 'SOP-2']);
  });

  it('throws on a contour missing ContourImageSequence', () => {
    const dataset = {
      ROIContourSequence: [
        { ContourSequence: [{ /* no ContourImageSequence */ }] },
      ],
    };
    expect(() => collectContourImageReferencesFromRtStruct(dataset))
      .toThrow(/ContourImageSequence/);
  });

  it('throws on a ContourImage entry missing ReferencedSOPInstanceUID', () => {
    const dataset = {
      ROIContourSequence: [
        { ContourSequence: [{ ContourImageSequence: [{ ReferencedSOPClassUID: 'CT' }] }] },
      ],
    };
    expect(() => collectContourImageReferencesFromRtStruct(dataset))
      .toThrow(/ReferencedSOPInstanceUID/);
  });

  it('passes through an empty sequence without throwing (no contours, no references)', () => {
    expect(collectContourImageReferencesFromRtStruct({ ROIContourSequence: [] })).toEqual([]);
    expect(collectContourImageReferencesFromRtStruct({})).toEqual([]);
  });
});

describe('validateRtStructDataset', () => {
  it('accepts a minimally-valid dataset', () => {
    expect(() => validateRtStructDataset(buildValidRtStructDataset())).not.toThrow();
  });

  it('throws if StructureSetROISequence is missing or empty', () => {
    const ds = buildValidRtStructDataset();
    ds.StructureSetROISequence = [];
    expect(() => validateRtStructDataset(ds)).toThrow(/StructureSetROISequence/);
  });

  it('throws if ROIContourSequence is missing', () => {
    const ds = buildValidRtStructDataset();
    ds.ROIContourSequence = [];
    expect(() => validateRtStructDataset(ds)).toThrow(/ROIContourSequence/);
  });

  it('throws if RTROIObservationsSequence is missing', () => {
    const ds = buildValidRtStructDataset();
    ds.RTROIObservationsSequence = [];
    expect(() => validateRtStructDataset(ds)).toThrow(/RTROIObservationsSequence/);
  });

  it('throws if ROI numbers are not aligned across the three sequences', () => {
    const ds = buildValidRtStructDataset();
    // Reference an ROI that exists in the structure set but not in the contours
    ds.RTROIObservationsSequence = [
      { ObservationNumber: 1, ReferencedROINumber: 1 },
      { ObservationNumber: 2, ReferencedROINumber: 999 },
    ];
    expect(() => validateRtStructDataset(ds))
      .toThrow(/ROI 2 is missing|not aligned/);
  });

  it('throws if ReferencedFrameOfReferenceSequence is missing', () => {
    const ds = buildValidRtStructDataset();
    ds.ReferencedFrameOfReferenceSequence = [];
    expect(() => validateRtStructDataset(ds)).toThrow(/ReferencedFrameOfReferenceSequence/);
  });

  it('throws if RTReferencedStudySequence is missing inside a frame-of-reference item', () => {
    const ds = buildValidRtStructDataset();
    (ds.ReferencedFrameOfReferenceSequence[0] as any).RTReferencedStudySequence = [];
    expect(() => validateRtStructDataset(ds)).toThrow(/RTReferencedStudySequence/);
  });

  it('throws if RTReferencedSeriesSequence is missing inside a study', () => {
    const ds = buildValidRtStructDataset();
    (ds.ReferencedFrameOfReferenceSequence[0] as any)
      .RTReferencedStudySequence[0].RTReferencedSeriesSequence = [];
    expect(() => validateRtStructDataset(ds)).toThrow(/RTReferencedSeriesSequence/);
  });

  it('throws if ContourImageSequence is missing inside a referenced series', () => {
    const ds = buildValidRtStructDataset();
    (ds.ReferencedFrameOfReferenceSequence[0] as any)
      .RTReferencedStudySequence[0].RTReferencedSeriesSequence[0].ContourImageSequence = [];
    expect(() => validateRtStructDataset(ds)).toThrow(/referenced series is missing ContourImageSequence/);
  });

  it('throws if a contour-level ContourImageSequence is missing ReferencedSOPInstanceUID', () => {
    const ds = buildValidRtStructDataset();
    (ds.ROIContourSequence[0] as any).ContourSequence[0].ContourImageSequence = [{ /* no UID */ }];
    expect(() => validateRtStructDataset(ds)).toThrow(/ReferencedSOPInstanceUID/);
  });
});
