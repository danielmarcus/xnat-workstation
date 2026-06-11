import { describe, expect, it } from 'vitest';
import { actionForEligibility, nonNativeStyleFor } from '../eligibilityStyle';

describe('actionForEligibility', () => {
  it('native ⇒ attach, solid, editable', () => {
    expect(actionForEligibility('native')).toEqual({ attach: true, nonNative: false, readOnly: false });
  });
  it('cross-series-show ⇒ attach, non-native, read-only', () => {
    expect(actionForEligibility('cross-series-show')).toEqual({ attach: true, nonNative: true, readOnly: true });
  });
  it('cross-series-hide ⇒ do NOT attach (not-attaching is the only reliable per-viewport hide for a shared volume labelmap)', () => {
    expect(actionForEligibility('cross-series-hide')).toEqual({ attach: false, nonNative: false, readOnly: true });
  });
  it('different-for ⇒ do NOT attach', () => {
    expect(actionForEligibility('different-for')).toEqual({ attach: false, nonNative: false, readOnly: true });
  });
});

describe('nonNativeStyleFor', () => {
  it('contour: dashed outline + reduced fill (active + inactive both set)', () => {
    const s = nonNativeStyleFor('Contour');
    expect(s.outlineDash).toBeTruthy();
    expect(s.outlineDashInactive).toBe(s.outlineDash);
    expect(s.fillAlpha).toBeLessThan(0.5);
    expect(s.fillAlphaInactive).toBe(s.fillAlpha);
  });
  it('labelmap (SEG): reduced fill opacity + outline (no dash — renderer has none)', () => {
    const s = nonNativeStyleFor('Labelmap');
    expect(s.fillAlpha).toBeLessThanOrEqual(0.3);
    expect(s.renderOutline).toBe(true);
    expect('outlineDash' in s).toBe(false); // dashed/hatch unavailable for labelmap
  });
});
