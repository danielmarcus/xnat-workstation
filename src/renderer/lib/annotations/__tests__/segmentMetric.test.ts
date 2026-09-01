import { describe, it, expect } from 'vitest';
import { formatSegmentMetric } from '../segmentMetric';

describe('formatSegmentMetric', () => {
  it('renders whole cm³ for the mockup case (86 cm³)', () => {
    expect(formatSegmentMetric({ volumeMm3: 86_000, voxelCount: 100 })).toBe('86 cm³');
  });

  it('keeps one decimal below 10 cm³ so small segments are not all "0 cm³"', () => {
    expect(formatSegmentMetric({ volumeMm3: 4_200, voxelCount: 10 })).toBe('4.2 cm³');
    expect(formatSegmentMetric({ volumeMm3: 120, voxelCount: 2 })).toBe('0.1 cm³');
  });

  it('falls back to mm³ when the volume is under 0.05 cm³ (rounds to nothing in cm³)', () => {
    expect(formatSegmentMetric({ volumeMm3: 12, voxelCount: 1 })).toBe('12 mm³');
  });

  it('is undefined when nothing has been painted (the row shows its empty marker instead)', () => {
    expect(formatSegmentMetric({ volumeMm3: 0, voxelCount: 0 })).toBeUndefined();
    expect(formatSegmentMetric({ voxelCount: 0 })).toBeUndefined();
    expect(formatSegmentMetric(undefined)).toBeUndefined();
  });

  it('falls back to a voxel count when the volume could not be computed', () => {
    expect(formatSegmentMetric({ voxelCount: 1234 })).toBe('1234 voxels');
  });

  it('ignores a negative or non-finite volume rather than printing it', () => {
    expect(formatSegmentMetric({ volumeMm3: Number.NaN, voxelCount: 5 })).toBe('5 voxels');
    expect(formatSegmentMetric({ volumeMm3: -10, voxelCount: 5 })).toBe('5 voxels');
  });
});
