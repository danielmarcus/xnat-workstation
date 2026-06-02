import { describe, expect, it } from 'vitest';
import {
  sessionModalities,
  hasMixedModality,
  countDerivedAssessors,
  derivedPillLabel,
  selectRange,
  toggleSelection,
  bulkLoadOptions,
} from './sidebarHelpers';
import type { XnatScan } from '@shared/types/xnat';

function scan(partial: Partial<XnatScan>): XnatScan {
  return {
    id: 'x',
    label: 'x',
    modality: 'CT',
    type: 'CT',
    seriesDescription: '',
    quality: 'usable',
    note: '',
    series_description: '',
    fileCount: 1,
    ...partial,
  } as XnatScan;
}

describe('sessionModalities + hasMixedModality (spec §7.2)', () => {
  it('empty list → []', () => {
    expect(sessionModalities([])).toEqual([]);
    expect(hasMixedModality([])).toBe(false);
  });

  it('single modality session', () => {
    const scans = [scan({ modality: 'CT' }), scan({ modality: 'CT' })];
    expect(sessionModalities(scans)).toEqual(['CT']);
    expect(hasMixedModality(scans)).toBe(false);
  });

  it('PET/CT session → both modalities surface', () => {
    const scans = [
      scan({ modality: 'CT' }),
      scan({ modality: 'PT' }),
      scan({ modality: 'CT' }),
    ];
    expect(sessionModalities(scans)).toEqual(['CT', 'PT']);
    expect(hasMixedModality(scans)).toBe(true);
  });

  it('uppercases + dedupes; empty modalities dropped', () => {
    const scans = [
      scan({ modality: 'mr' }),
      scan({ modality: 'MR' }),
      scan({ modality: '' }),
    ];
    expect(sessionModalities(scans)).toEqual(['MR']);
  });
});

describe('countDerivedAssessors + derivedPillLabel (spec §7.4)', () => {
  it('empty → all zero, label null', () => {
    const c = countDerivedAssessors([]);
    expect(c).toEqual({ seg: 0, rtstruct: 0, sr: 0, total: 0 });
    expect(derivedPillLabel(c)).toBeNull();
  });

  it('counts SEG / RTSTRUCT / SR by type', () => {
    const c = countDerivedAssessors([
      scan({ type: 'SEG' }),
      scan({ type: 'SEG' }),
      scan({ type: 'rtstruct' }),
      scan({ modality: 'SR', type: 'SR' }),
    ]);
    expect(c).toEqual({ seg: 2, rtstruct: 1, sr: 1, total: 4 });
  });

  it('pill label lists every non-zero kind', () => {
    const label = derivedPillLabel({ seg: 2, rtstruct: 1, sr: 1, total: 4 });
    expect(label).toMatch(/4 annotations auto-load/);
    expect(label).toMatch(/2 SEG/);
    expect(label).toMatch(/1 RTSTRUCT/);
    expect(label).toMatch(/1 SR/);
  });

  it('singular noun when exactly 1 total', () => {
    const label = derivedPillLabel({ seg: 1, rtstruct: 0, sr: 0, total: 1 });
    expect(label).toMatch(/^1 annotation auto-load/);
  });
});

describe('selectRange (spec §7.5 Shift+click)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('anchor → target inclusive', () => {
    expect(selectRange(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
  });

  it('target before anchor still returns display-order range', () => {
    expect(selectRange(ids, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('same id → singleton', () => {
    expect(selectRange(ids, 'c', 'c')).toEqual(['c']);
  });

  it('missing anchor or target → just [target]', () => {
    expect(selectRange(ids, 'missing', 'c')).toEqual(['c']);
    expect(selectRange(ids, 'c', 'missing')).toEqual(['missing']);
  });
});

describe('toggleSelection (Cmd/Ctrl+click)', () => {
  it('adds an absent id; removes a present one', () => {
    expect(toggleSelection(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('does not mutate input', () => {
    const input = ['a', 'b'];
    toggleSelection(input, 'c');
    expect(input).toEqual(['a', 'b']);
  });
});

describe('bulkLoadOptions (spec §7.5)', () => {
  it('N < 2 → no options (the bar is hidden)', () => {
    expect(bulkLoadOptions(0)).toEqual([]);
    expect(bulkLoadOptions(1)).toEqual([]);
  });

  it('N = 2 → 1×2 + 2×2', () => {
    const opts = bulkLoadOptions(2);
    expect(opts).toEqual([
      { label: '1×2', rows: 1, cols: 2, capacity: 2 },
      { label: '2×2', rows: 2, cols: 2, capacity: 4 },
    ]);
  });

  it('N = 3 → 1×3 + 2×2', () => {
    const opts = bulkLoadOptions(3);
    expect(opts.map((o) => o.label)).toEqual(['1×3', '2×2']);
  });

  it('N = 4 → 1×4 + 2×2', () => {
    expect(bulkLoadOptions(4).map((o) => o.label)).toEqual(['1×4', '2×2']);
  });

  it('N > 4 → 1×4 only (2×2 hidden per spec)', () => {
    expect(bulkLoadOptions(5).map((o) => o.label)).toEqual(['1×4']);
    expect(bulkLoadOptions(99).map((o) => o.label)).toEqual(['1×4']);
  });
});
