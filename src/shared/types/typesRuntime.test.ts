import { describe, expect, it } from 'vitest';
import {
  presetsForModality,
  CT_WL_PRESETS,
  MR_WL_PRESETS,
  PT_WL_PRESETS,
  thresholdPresetsForModality,
  defaultThresholdRangeForModality,
  CT_THRESHOLD_PRESETS,
  MR_THRESHOLD_PRESETS,
  PT_THRESHOLD_PRESETS,
} from './viewer';

describe('presetsForModality — W/L presets scoped to modality', () => {
  it('returns the modality-specific set for CT / MR / PT (case + whitespace insensitive)', () => {
    expect(presetsForModality('CT')).toBe(CT_WL_PRESETS);
    expect(presetsForModality('MR')).toBe(MR_WL_PRESETS);
    expect(presetsForModality('PT')).toBe(PT_WL_PRESETS);
    expect(presetsForModality(' mr ')).toBe(MR_WL_PRESETS);
  });

  it('an MR scan does NOT get the CT presets (the reported bug)', () => {
    const mr = presetsForModality('MR');
    expect(mr).not.toBe(CT_WL_PRESETS);
    expect(mr.some((p) => p.name === 'Lung')).toBe(false); // no CT-only presets leaking in
  });

  it('falls back to CT for unknown / missing modality', () => {
    expect(presetsForModality(undefined)).toBe(CT_WL_PRESETS);
    expect(presetsForModality('')).toBe(CT_WL_PRESETS);
    expect(presetsForModality('US')).toBe(CT_WL_PRESETS);
  });
});

describe('thresholdPresetsForModality — threshold windows scoped to modality', () => {
  it('returns the modality-specific set for CT / MR / PT (case + whitespace insensitive)', () => {
    expect(thresholdPresetsForModality('CT')).toBe(CT_THRESHOLD_PRESETS);
    expect(thresholdPresetsForModality('MR')).toBe(MR_THRESHOLD_PRESETS);
    expect(thresholdPresetsForModality('PT')).toBe(PT_THRESHOLD_PRESETS);
    expect(thresholdPresetsForModality(' mr ')).toBe(MR_THRESHOLD_PRESETS);
  });

  it('does not leak CT HU windows onto MR (HU is meaningless there)', () => {
    const mr = thresholdPresetsForModality('MR');
    expect(mr).not.toBe(CT_THRESHOLD_PRESETS);
    expect(mr.some((p) => p.name === 'Bone')).toBe(false);
  });

  it('falls back to CT for unknown / missing modality', () => {
    expect(thresholdPresetsForModality(undefined)).toBe(CT_THRESHOLD_PRESETS);
    expect(thresholdPresetsForModality('US')).toBe(CT_THRESHOLD_PRESETS);
  });

  it('defaults to the first preset of the modality set, as a fresh array', () => {
    expect(defaultThresholdRangeForModality('CT')).toEqual(CT_THRESHOLD_PRESETS[0].range);
    expect(defaultThresholdRangeForModality('MR')).toEqual(MR_THRESHOLD_PRESETS[0].range);
    // A copy, not the preset's own array — callers must not be able to mutate the preset.
    expect(defaultThresholdRangeForModality('CT')).not.toBe(CT_THRESHOLD_PRESETS[0].range);
  });

  it('every preset window is a non-inverted [min, max]', () => {
    for (const set of [CT_THRESHOLD_PRESETS, MR_THRESHOLD_PRESETS, PT_THRESHOLD_PRESETS]) {
      for (const p of set) expect(p.range[0]).toBeLessThan(p.range[1]);
    }
  });
});

describe('shared type modules runtime loading', () => {
  it('loads shared type modules without runtime side effects', async () => {
    const hotkeys = await import('./hotkeys');
    const xnat = await import('./xnat');
    const index = await import('./index');

    expect(hotkeys).toBeTypeOf('object');
    expect(xnat).toBeTypeOf('object');
    expect(index).toBeTypeOf('object');
  });
});
