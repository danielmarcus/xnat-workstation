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
  const ON_OPTED_IN = { enabled: true, a2cOptedIn: true };
  const ON_NOT_OPTED_IN = { enabled: true, a2cOptedIn: false };
  const OFF = { enabled: false, a2cOptedIn: false };
  const OFF_BUT_OPTED_IN = { enabled: false, a2cOptedIn: true };

  it('native always renders, regardless of policy', () => {
    expect(shouldRenderByDefault('native', ON_OPTED_IN)).toBe(true);
    expect(shouldRenderByDefault('native', ON_NOT_OPTED_IN)).toBe(true);
    expect(shouldRenderByDefault('native', OFF)).toBe(true);
  });

  it('cross-FoR never renders, regardless of policy (would need SRO; v1 out of scope)', () => {
    expect(shouldRenderByDefault('cross-FoR', ON_OPTED_IN)).toBe(false);
    expect(shouldRenderByDefault('cross-FoR', ON_NOT_OPTED_IN)).toBe(false);
    expect(shouldRenderByDefault('cross-FoR', OFF)).toBe(false);
  });

  it('A2b renders when global toggle on, regardless of A2c opt-in', () => {
    expect(shouldRenderByDefault('cross-series-A2b', ON_OPTED_IN)).toBe(true);
    expect(shouldRenderByDefault('cross-series-A2b', ON_NOT_OPTED_IN)).toBe(true);
  });

  it('A2b is hidden when global toggle off, even with A2c opt-in', () => {
    expect(shouldRenderByDefault('cross-series-A2b', OFF)).toBe(false);
    expect(shouldRenderByDefault('cross-series-A2b', OFF_BUT_OPTED_IN)).toBe(false);
  });

  it('A2c renders only when BOTH global on AND opted in (Phase 3 surface)', () => {
    expect(shouldRenderByDefault('cross-series-A2c', ON_OPTED_IN)).toBe(true);
    expect(shouldRenderByDefault('cross-series-A2c', ON_NOT_OPTED_IN)).toBe(false);
    expect(shouldRenderByDefault('cross-series-A2c', OFF)).toBe(false);
    expect(shouldRenderByDefault('cross-series-A2c', OFF_BUT_OPTED_IN)).toBe(false);
  });

  it('Phase 2 default policy (a2cOptedIn=false) keeps A2c hidden even on T1+T2-style sites', () => {
    // A breath-hold pair classified A2c with the global toggle on but no
    // per-container opt-in — Phase 2 expectation is hidden.
    expect(shouldRenderByDefault('cross-series-A2c', ON_NOT_OPTED_IN)).toBe(false);
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
