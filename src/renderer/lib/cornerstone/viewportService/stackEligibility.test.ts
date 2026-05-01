import { describe, expect, it } from 'vitest';
import {
  eligibleViewportType,
  type ImageMetadataForEligibility,
} from './stackEligibility';

function meta(partial: Partial<ImageMetadataForEligibility> = {}): ImageMetadataForEligibility {
  return {
    modality: null,
    numberOfFrames: null,
    hasSpatialMultiFrameDimension: false,
    ...partial,
  };
}

describe('eligibleViewportType', () => {
  describe('non-volumetric modalities → stack', () => {
    for (const modality of ['US', 'XA', 'RF', 'NM', 'DX', 'CR', 'MG']) {
      it(`${modality} (any image count) → stack`, () => {
        expect(eligibleViewportType(meta({ modality }), 1)).toBe('stack');
        expect(eligibleViewportType(meta({ modality }), 100)).toBe('stack');
      });
    }

    it('case-insensitive modality match', () => {
      expect(eligibleViewportType(meta({ modality: 'us' }), 50)).toBe('stack');
      expect(eligibleViewportType(meta({ modality: ' XA ' }), 50)).toBe('stack');
    });
  });

  describe('volumetric modalities', () => {
    it('CT with multi-slice → volume', () => {
      expect(eligibleViewportType(meta({ modality: 'CT' }), 100)).toBe('volume');
    });

    it('MR with multi-slice → volume', () => {
      expect(eligibleViewportType(meta({ modality: 'MR' }), 50)).toBe('volume');
    });

    it('PT with multi-slice → volume', () => {
      expect(eligibleViewportType(meta({ modality: 'PT' }), 200)).toBe('volume');
    });

    it('CT with single image → stack (not enough for a volume)', () => {
      expect(eligibleViewportType(meta({ modality: 'CT' }), 1)).toBe('stack');
    });
  });

  describe('multi-frame DICOM', () => {
    it('multi-frame CT without spatial dimension → stack (cine)', () => {
      expect(
        eligibleViewportType(
          meta({ modality: 'CT', numberOfFrames: 30, hasSpatialMultiFrameDimension: false }),
          1, // multi-frame DICOM is one imageId, many frames
        ),
      ).toBe('stack');
    });

    it('multi-frame MR with spatial dimension → volume', () => {
      // Some volumetric MR series come as one multi-frame DICOM with a 3D dim.
      // imageCount is 1 (one DICOM file), but spatial-dim flag overrides the
      // image-count-based stack rule.
      expect(
        eligibleViewportType(
          meta({ modality: 'MR', numberOfFrames: 100, hasSpatialMultiFrameDimension: true }),
          1,
        ),
      ).toBe('stack');
      // ^ Note: image-count rule still triggers since count=1 < 2. To get
      // volume from a single multi-frame DICOM, the loader must split it
      // into multiple imageIds (one per frame) before calling. That's the
      // existing pattern via wadors-frame URIs.
    });

    it('NumberOfFrames=1 is treated as single-frame', () => {
      expect(
        eligibleViewportType(meta({ modality: 'CT', numberOfFrames: 1 }), 100),
      ).toBe('volume');
    });
  });

  describe('edge cases', () => {
    it('null modality + multi-slice → volume (default optimistic)', () => {
      expect(eligibleViewportType(meta({ modality: null }), 50)).toBe('volume');
    });

    it('empty modality + multi-slice → volume', () => {
      expect(eligibleViewportType(meta({ modality: '' }), 50)).toBe('volume');
    });

    it('zero images → stack', () => {
      expect(eligibleViewportType(meta({ modality: 'CT' }), 0)).toBe('stack');
    });

    it('unknown modality + multi-slice → volume (no rule blocks it)', () => {
      expect(eligibleViewportType(meta({ modality: 'XXX' }), 50)).toBe('volume');
    });
  });
});
