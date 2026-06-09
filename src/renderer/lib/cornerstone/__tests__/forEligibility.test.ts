import { describe, expect, it } from 'vitest';
import { classifyEligibility } from '../forEligibility';
import type { ContainerSpatialId, ViewportSpatialId } from '../forEligibility';

const container = (over: Partial<ContainerSpatialId> = {}): ContainerSpatialId => ({
  frameOfReferenceUID: 'FoR-1',
  nativeSeriesInstanceUID: 'series-A',
  referencedSeriesInstanceUIDs: ['series-A'],
  ...over,
});

const viewport = (over: Partial<ViewportSpatialId> = {}): ViewportSpatialId => ({
  viewportId: 'panel_0',
  frameOfReferenceUID: 'FoR-1',
  seriesInstanceUID: 'series-A',
  acquisitionNumber: 1,
  ...over,
});

describe('classifyEligibility — A2a–d', () => {
  it('A2d: different Frame of Reference ⇒ different-for (never render)', () => {
    expect(
      classifyEligibility({ container: container(), viewport: viewport({ frameOfReferenceUID: 'FoR-2' }) }),
    ).toBe('different-for');
  });

  it('A2d: a missing FoR on either side ⇒ different-for (cannot prove a match)', () => {
    expect(classifyEligibility({ container: container({ frameOfReferenceUID: null }), viewport: viewport() })).toBe('different-for');
    expect(classifyEligibility({ container: container(), viewport: viewport({ frameOfReferenceUID: null }) })).toBe('different-for');
  });

  it('A2a: viewport series is the native series ⇒ native', () => {
    expect(classifyEligibility({ container: container(), viewport: viewport({ seriesInstanceUID: 'series-A' }) })).toBe('native');
  });

  it('A2a: viewport series is in the referenced lineage ⇒ native', () => {
    expect(
      classifyEligibility({
        container: container({ nativeSeriesInstanceUID: 'series-A', referencedSeriesInstanceUIDs: ['series-A', 'series-B'] }),
        viewport: viewport({ seriesInstanceUID: 'series-B' }),
      }),
    ).toBe('native');
  });

  it('A2b: same FoR, different series, no displacement (T1/T2 same exam) ⇒ cross-series-show', () => {
    expect(
      classifyEligibility({
        container: container(),
        viewport: viewport({ seriesInstanceUID: 'series-B', acquisitionNumber: 7 }), // different acq
        bulkDisplacementMm: 0.4,
      }),
    ).toBe('cross-series-show');
  });

  it('A2c: same FoR, large bulk displacement (breath-hold) ⇒ cross-series-hide', () => {
    expect(
      classifyEligibility({
        container: container(),
        viewport: viewport({ seriesInstanceUID: 'series-B' }),
        bulkDisplacementMm: 20,
      }),
    ).toBe('cross-series-hide');
  });

  it('A2c invariant: AcquisitionNumber difference ALONE never hides (no displacement ⇒ show)', () => {
    expect(
      classifyEligibility({
        container: container(),
        viewport: viewport({ seriesInstanceUID: 'series-B', acquisitionNumber: 99 }),
        // bulkDisplacementMm omitted/unknown
      }),
    ).toBe('cross-series-show');
  });

  it('A2c "when uncertain, show": displacement unknown ⇒ cross-series-show', () => {
    expect(
      classifyEligibility({
        container: container(),
        viewport: viewport({ seriesInstanceUID: 'series-B' }),
        bulkDisplacementMm: null,
      }),
    ).toBe('cross-series-show');
  });

  it('user "show related" override forces show even with large displacement', () => {
    expect(
      classifyEligibility({
        container: container(),
        viewport: viewport({ seriesInstanceUID: 'series-B' }),
        bulkDisplacementMm: 50,
        userShowRelatedOverride: true,
      }),
    ).toBe('cross-series-show');
  });

  it('respects a custom displacement threshold', () => {
    const inputs = { container: container(), viewport: viewport({ seriesInstanceUID: 'series-B' }), bulkDisplacementMm: 6 };
    expect(classifyEligibility({ ...inputs, displacementThresholdMm: 5 })).toBe('cross-series-hide');
    expect(classifyEligibility({ ...inputs, displacementThresholdMm: 10 })).toBe('cross-series-show');
  });
});
