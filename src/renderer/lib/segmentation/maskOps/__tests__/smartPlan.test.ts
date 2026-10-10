/**
 * Smart Cleanup planning (branch 1 S8): eroding operations are withheld from small and
 * thin segments; everything else gets the chosen operation; empty segments are skipped.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_OPTIONS, planSmartCleanup, sampleSlices, smallThresholdFor, thinScore } from '../smartPlan';

const plane = (rows: string[]) => ({
  width: rows[0].length,
  height: rows.length,
  data: Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0))),
});

describe('thinScore', () => {
  it('a one-pixel line is all boundary; a solid block mostly interior', () => {
    expect(thinScore([plane(['.......', '.#####.', '.......'])])).toBe(1);
    const block = plane(['.......', '.#####.', '.#####.', '.#####.', '.#####.', '.#####.', '.......']);
    expect(thinScore([block])).toBeCloseTo(16 / 25);
    const big = plane(Array.from({ length: 12 }, (_, y) => (y === 0 || y === 11 ? '.'.repeat(12) : '.' + '#'.repeat(10) + '.')));
    expect(thinScore([big])).toBeLessThan(0.62);
  });
});

describe('sampleSlices', () => {
  it('first, middle, last', () => {
    expect(sampleSlices([3, 4, 5, 6, 7, 8])).toEqual([3, 6, 8]);
    expect(sampleSlices([1, 2])).toEqual([1, 2]);
  });
});

describe('planSmartCleanup', () => {
  const stats = [
    { segmentIndex: 1, name: 'Liver', voxels: 90000, thin: 0.1 },
    { segmentIndex: 2, name: 'Nodule', voxels: 300, thin: 0.5 },
    { segmentIndex: 3, name: 'Vessel', voxels: 8000, thin: 0.8 },
    { segmentIndex: 4, name: 'Empty', voxels: 0, thin: 0 },
  ];

  it('withholds an eroding op from small and thin segments, largest first', () => {
    const plan = planSmartCleanup(stats, 'gaussian', DEFAULT_PLAN_OPTIONS);
    expect(plan.map((e) => [e.name, e.action, e.small, e.thin])).toEqual([
      ['Liver', 'gaussian', false, false],
      ['Vessel', 'skip', false, true],
      ['Nodule', 'skip', true, false],
      ['Empty', 'skip', false, false],
    ]);
  });

  it('a non-eroding op (fill holes) is given to every non-empty segment', () => {
    const plan = planSmartCleanup(stats, 'fillHoles', DEFAULT_PLAN_OPTIONS);
    expect(plan.filter((e) => e.voxels > 0).every((e) => e.action === 'fillHoles')).toBe(true);
  });

  it('the safe action is configurable (e.g. Median instead of skipping)', () => {
    const plan = planSmartCleanup(stats, 'gaussian', { ...DEFAULT_PLAN_OPTIONS, safeAction: 'median' });
    expect(plan.find((e) => e.name === 'Vessel')?.action).toBe('median');
  });

  it('one slice uses a tenth of the volume small-threshold (min 150)', () => {
    expect(smallThresholdFor(1)).toBe(150);
    expect(smallThresholdFor(1, 3000)).toBe(300);
    expect(smallThresholdFor(40)).toBe(1500);
  });
});
