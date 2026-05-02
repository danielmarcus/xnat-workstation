import { describe, expect, it } from 'vitest';
import {
  classifyForEligibility,
  isCrossSeries,
  shouldRenderByDefault,
  type SourceIdentityForEligibility,
} from './visibility';

function ident(partial: Partial<SourceIdentityForEligibility> = {}): SourceIdentityForEligibility {
  return {
    seriesUID: '1.2.3.4.5.SERIES_DEFAULT',
    frameOfReferenceUID: '1.2.3.4.5.FOR_DEFAULT',
    acquisitionNumber: null,
    ...partial,
  };
}

describe('classifyForEligibility', () => {
  describe('A2a — native', () => {
    it('same FoR + same series → native', () => {
      const m = ident({ seriesUID: 'S1', frameOfReferenceUID: 'F1' });
      const v = ident({ seriesUID: 'S1', frameOfReferenceUID: 'F1' });
      expect(classifyForEligibility(m, v)).toBe('native');
    });

    it('native classification ignores AcquisitionNumber', () => {
      const m = ident({ seriesUID: 'S1', frameOfReferenceUID: 'F1', acquisitionNumber: 1 });
      const v = ident({ seriesUID: 'S1', frameOfReferenceUID: 'F1', acquisitionNumber: 7 });
      // Same series, same FoR — AcquisitionNumber differences are noise here.
      expect(classifyForEligibility(m, v)).toBe('native');
    });
  });

  describe('A2d — cross-FoR', () => {
    it('different FoR → cross-FoR regardless of series match', () => {
      const m = ident({ seriesUID: 'S1', frameOfReferenceUID: 'F1' });
      const v = ident({ seriesUID: 'S1', frameOfReferenceUID: 'F2' });
      expect(classifyForEligibility(m, v)).toBe('cross-FoR');
    });

    it('different FoR + different series → cross-FoR', () => {
      const m = ident({ seriesUID: 'S1', frameOfReferenceUID: 'F1' });
      const v = ident({ seriesUID: 'S2', frameOfReferenceUID: 'F2' });
      expect(classifyForEligibility(m, v)).toBe('cross-FoR');
    });
  });

  describe('A2b — cross-series, same FoR, anatomy presumed consistent', () => {
    it('same FoR + different series + same AcquisitionNumber → A2b', () => {
      const m = ident({ seriesUID: 'T1', frameOfReferenceUID: 'F1', acquisitionNumber: 1 });
      const v = ident({ seriesUID: 'T2', frameOfReferenceUID: 'F1', acquisitionNumber: 1 });
      expect(classifyForEligibility(m, v)).toBe('cross-series-A2b');
    });

    it('same FoR + different series + AcquisitionNumber missing on member → A2b (uncertain)', () => {
      const m = ident({ seriesUID: 'T1', frameOfReferenceUID: 'F1', acquisitionNumber: null });
      const v = ident({ seriesUID: 'T2', frameOfReferenceUID: 'F1', acquisitionNumber: 5 });
      expect(classifyForEligibility(m, v)).toBe('cross-series-A2b');
    });

    it('same FoR + different series + AcquisitionNumber missing on viewport → A2b (uncertain)', () => {
      const m = ident({ seriesUID: 'T1', frameOfReferenceUID: 'F1', acquisitionNumber: 5 });
      const v = ident({ seriesUID: 'T2', frameOfReferenceUID: 'F1', acquisitionNumber: null });
      expect(classifyForEligibility(m, v)).toBe('cross-series-A2b');
    });

    it('same FoR + different series + both AcquisitionNumbers missing → A2b (uncertain)', () => {
      const m = ident({ seriesUID: 'T1', frameOfReferenceUID: 'F1', acquisitionNumber: null });
      const v = ident({ seriesUID: 'T2', frameOfReferenceUID: 'F1', acquisitionNumber: null });
      expect(classifyForEligibility(m, v)).toBe('cross-series-A2b');
    });
  });

  describe('A2c — cross-series, same FoR, anatomy demonstrably moved', () => {
    it('same FoR + different series + different AcquisitionNumber on both → A2c', () => {
      // Classic breath-hold pair / 4D-CT phase scenario.
      const m = ident({ seriesUID: 'BH1', frameOfReferenceUID: 'F1', acquisitionNumber: 1 });
      const v = ident({ seriesUID: 'BH2', frameOfReferenceUID: 'F1', acquisitionNumber: 2 });
      expect(classifyForEligibility(m, v)).toBe('cross-series-A2c');
    });

    it('AcquisitionNumber 0 vs 1 still triggers A2c (0 is a valid value, not "missing")', () => {
      const m = ident({ seriesUID: 'A', frameOfReferenceUID: 'F1', acquisitionNumber: 0 });
      const v = ident({ seriesUID: 'B', frameOfReferenceUID: 'F1', acquisitionNumber: 1 });
      expect(classifyForEligibility(m, v)).toBe('cross-series-A2c');
    });
  });

  describe('UID equality strictness', () => {
    it('whitespace differences in seriesUID are not normalized — case is significant per PS3.3', () => {
      const m = ident({ seriesUID: 'S1', frameOfReferenceUID: 'F1' });
      const v = ident({ seriesUID: 'S1 ', frameOfReferenceUID: 'F1' });
      // Strict equality: trailing space → different UIDs → cross-series.
      // Caller is responsible for trimming if metadata is dirty.
      expect(classifyForEligibility(m, v)).toBe('cross-series-A2b');
    });

    it('FoR UID comparison is also strict', () => {
      const m = ident({ frameOfReferenceUID: '1.2.3' });
      const v = ident({ frameOfReferenceUID: '1.2.3.0' });
      expect(classifyForEligibility(m, v)).toBe('cross-FoR');
    });
  });
});

describe('shouldRenderByDefault', () => {
  it('native always renders, regardless of toggle', () => {
    expect(shouldRenderByDefault('native', true)).toBe(true);
    expect(shouldRenderByDefault('native', false)).toBe(true);
  });

  it('cross-FoR never renders, regardless of toggle (would need SRO; v1 out of scope)', () => {
    expect(shouldRenderByDefault('cross-FoR', true)).toBe(false);
    expect(shouldRenderByDefault('cross-FoR', false)).toBe(false);
  });

  it('A2b renders when crossSeriesEnabled, hidden when toggled off', () => {
    expect(shouldRenderByDefault('cross-series-A2b', true)).toBe(true);
    expect(shouldRenderByDefault('cross-series-A2b', false)).toBe(false);
  });

  it('A2c renders only when crossSeriesEnabled (the user opt-in)', () => {
    expect(shouldRenderByDefault('cross-series-A2c', true)).toBe(true);
    expect(shouldRenderByDefault('cross-series-A2c', false)).toBe(false);
  });
});

describe('isCrossSeries', () => {
  it('true for A2b and A2c', () => {
    expect(isCrossSeries('cross-series-A2b')).toBe(true);
    expect(isCrossSeries('cross-series-A2c')).toBe(true);
  });

  it('false for native and cross-FoR', () => {
    expect(isCrossSeries('native')).toBe(false);
    expect(isCrossSeries('cross-FoR')).toBe(false);
  });
});
