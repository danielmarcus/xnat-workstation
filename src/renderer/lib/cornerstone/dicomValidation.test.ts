/**
 * Pre-upload IOD validation tests (MV-Phase 7.1, spec §13.3).
 *
 * `validateDatasetForUpload` is the pure gate; each SOP class has its own
 * required-tag list. The async base64 wrapper is exercised by the upload
 * E2E flow — these unit tests pin the tag rules.
 */
import { describe, expect, it } from 'vitest';
import {
  DicomValidationError,
  RTSTRUCT_SOP_CLASS_UID,
  SEG_SOP_CLASS_UID,
  SR_COMPREHENSIVE_SOP_CLASS_UID,
  validateDatasetForUpload,
} from './dicomValidation';

function validSegDataset(): Record<string, unknown> {
  return {
    SOPClassUID: SEG_SOP_CLASS_UID,
    Rows: 512,
    Columns: 512,
    NumberOfFrames: '30',
    SegmentSequence: [{ SegmentNumber: 1 }],
    PixelData: new ArrayBuffer(8),
    BitsAllocated: 1,
    BitsStored: 1,
    HighBit: 0,
  };
}

function validRtStructDataset(): Record<string, unknown> {
  return {
    SOPClassUID: RTSTRUCT_SOP_CLASS_UID,
    StructureSetROISequence: [{ ROINumber: 1 }],
    ROIContourSequence: [{ ReferencedROINumber: 1 }],
    RTROIObservationsSequence: [{ ReferencedROINumber: 1 }],
  };
}

function validSrDataset(): Record<string, unknown> {
  return {
    SOPClassUID: SR_COMPREHENSIVE_SOP_CLASS_UID,
    ConceptNameCodeSequence: [{ CodeValue: '126000' }],
    ContentSequence: [{ ValueType: 'NUM' }],
  };
}

describe('validateDatasetForUpload', () => {
  describe('DICOM SEG', () => {
    it('passes a fully-populated SEG dataset', () => {
      expect(() => validateDatasetForUpload(validSegDataset())).not.toThrow();
    });

    it.each(['Rows', 'Columns', 'NumberOfFrames', 'SegmentSequence', 'PixelData', 'BitsAllocated', 'BitsStored'])(
      'throws when %s is missing',
      (tag) => {
        const ds = validSegDataset();
        delete ds[tag];
        expect(() => validateDatasetForUpload(ds)).toThrow(DicomValidationError);
        try {
          validateDatasetForUpload(ds);
        } catch (err) {
          expect((err as DicomValidationError).missingTags).toContain(tag);
          expect((err as DicomValidationError).sopClassUid).toBe(SEG_SOP_CLASS_UID);
        }
      },
    );

    it('treats HighBit: 0 as present (zero is a valid value)', () => {
      const ds = validSegDataset();
      ds.HighBit = 0;
      expect(() => validateDatasetForUpload(ds)).not.toThrow();
    });

    it('treats an empty SegmentSequence array as missing', () => {
      const ds = validSegDataset();
      ds.SegmentSequence = [];
      expect(() => validateDatasetForUpload(ds)).toThrow(/SegmentSequence/);
    });

    it('lists every missing tag in one error', () => {
      const ds = validSegDataset();
      delete ds.Rows;
      delete ds.Columns;
      try {
        validateDatasetForUpload(ds);
        expect.unreachable('should have thrown');
      } catch (err) {
        const e = err as DicomValidationError;
        expect(e.missingTags).toEqual(expect.arrayContaining(['Rows', 'Columns']));
        expect(e.message).toContain('Rows');
        expect(e.message).toContain('Columns');
      }
    });
  });

  describe('DICOM RTSTRUCT', () => {
    it('passes a fully-populated RTSTRUCT dataset', () => {
      expect(() => validateDatasetForUpload(validRtStructDataset())).not.toThrow();
    });

    it.each(['StructureSetROISequence', 'ROIContourSequence', 'RTROIObservationsSequence'])(
      'throws when %s is missing',
      (tag) => {
        const ds = validRtStructDataset();
        delete ds[tag];
        expect(() => validateDatasetForUpload(ds)).toThrow(DicomValidationError);
      },
    );
  });

  describe('DICOM SR', () => {
    it('passes a fully-populated SR dataset', () => {
      expect(() => validateDatasetForUpload(validSrDataset())).not.toThrow();
    });

    it.each(['ConceptNameCodeSequence', 'ContentSequence'])('throws when %s is missing', (tag) => {
      const ds = validSrDataset();
      delete ds[tag];
      expect(() => validateDatasetForUpload(ds)).toThrow(DicomValidationError);
    });
  });

  describe('unknown SOP classes', () => {
    it('passes datasets with an unrecognized SOP class through without error', () => {
      expect(() => validateDatasetForUpload({ SOPClassUID: '1.2.3.4.5' })).not.toThrow();
    });

    it('passes datasets with no SOPClassUID through without error', () => {
      expect(() => validateDatasetForUpload({})).not.toThrow();
    });
  });

  describe('error shape', () => {
    it('uses the human-readable IOD name in the message', () => {
      const ds = validSegDataset();
      delete ds.Rows;
      expect(() => validateDatasetForUpload(ds)).toThrow(/DICOM SEG/);
    });

    it('is an instanceof Error and DicomValidationError', () => {
      const ds = validRtStructDataset();
      delete ds.ROIContourSequence;
      try {
        validateDatasetForUpload(ds);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(DicomValidationError);
        expect((err as DicomValidationError).name).toBe('DicomValidationError');
      }
    });
  });
});
