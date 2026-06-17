import { describe, expect, it } from 'vitest';
import {
  presetsForModality,
  CT_WL_PRESETS,
  MR_WL_PRESETS,
  PT_WL_PRESETS,
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
