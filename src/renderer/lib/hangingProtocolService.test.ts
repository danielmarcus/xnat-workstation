import type { HangingProtocol } from '@shared/types/hangingProtocol';
import type { XnatScan } from '@shared/types/xnat';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PROTOCOLS } from '@shared/types/hangingProtocol';
import { applyProtocol, matchProtocol } from './hangingProtocolService';

function scan(
  id: string,
  partial: Partial<XnatScan> = {},
): XnatScan {
  return {
    id,
    modality: 'CT',
    type: 'AXIAL',
    seriesDescription: `Series ${id}`,
    frames: 1,
    ...partial,
  };
}

describe('hangingProtocolService', () => {
  it('applyProtocol assigns matches and leaves unmatched scans', () => {
    const protocol: HangingProtocol = {
      id: 'test',
      name: 'Test',
      layout: '1x2',
      priority: 1,
      rules: [
        { panelIndex: 0, label: 'Pre', matcher: { descriptionContains: ['pre'] } },
        { panelIndex: 1, label: 'Post', matcher: { descriptionContains: ['post'] } },
      ],
    };
    const scans = [
      scan('1', { seriesDescription: 'CT Pre Contrast' }),
      scan('2', { seriesDescription: 'CT Post Contrast' }),
      scan('3', { seriesDescription: 'Scout' }),
    ];

    const result = applyProtocol(scans, protocol);
    expect(result.protocol.id).toBe('test');
    expect(result.assignments.get(0)?.id).toBe('1');
    expect(result.assignments.get(1)?.id).toBe('2');
    expect(result.unmatched.map((s) => s.id)).toEqual(['3']);
  });

  it('matchProtocol selects high-priority full-match protocol for dominant modality', () => {
    const scans = [
      scan('pre', { modality: 'CT', seriesDescription: 'PRE contrast axial', frames: 150 }),
      scan('post', { modality: 'CT', seriesDescription: 'POST contrast axial', frames: 220 }),
      scan('other', { modality: 'CT', seriesDescription: 'localizer', frames: 2 }),
    ];

    const result = matchProtocol(scans);
    expect(result.protocol.id).toBe('ct-contrast');
    expect(result.assignments.size).toBe(2);
    expect(result.assignments.get(0)?.id).toBe('pre');
    expect(result.assignments.get(1)?.id).toBe('post');
  });

  it('respects required rules and falls back to auto layout when no protocol matches', () => {
    const strictProtocol: HangingProtocol = {
      id: 'strict',
      name: 'Strict',
      layout: '1x2',
      priority: 50,
      rules: [
        { panelIndex: 0, label: 'A', matcher: { descriptionContains: ['alpha'] }, required: true },
        { panelIndex: 1, label: 'B', matcher: { descriptionContains: ['beta'] }, required: true },
      ],
    };
    const scans = [
      scan('1', { modality: 'US', seriesDescription: 'single unmatched', frames: 5 }),
      scan('2', { modality: 'US', seriesDescription: 'another unmatched', frames: 10 }),
      scan('3', { modality: 'US', seriesDescription: 'third unmatched', frames: 1 }),
    ];

    const result = matchProtocol(scans, [strictProtocol]);
    expect(result.protocol.id).toBe('auto');
    expect(result.protocol.layout).toBe('2x2');
    expect(result.assignments.size).toBe(3);
    // Auto fallback assigns by frame count descending.
    expect(result.assignments.get(0)?.id).toBe('2');
    expect(result.assignments.get(1)?.id).toBe('1');
  });

  it('handles empty scans with built-in single fallback protocol', () => {
    const result = matchProtocol([], BUILT_IN_PROTOCOLS);
    expect(result.protocol.id).toBe('single');
    expect(result.assignments.size).toBe(0);
    expect(result.unmatched).toEqual([]);
  });

  it('supports preferMostFrames matcher semantics when choosing a candidate', () => {
    const protocol: HangingProtocol = {
      id: 'frames',
      name: 'Frames',
      layout: '1x1',
      priority: 1,
      rules: [{ panelIndex: 0, label: 'Primary', matcher: { modality: 'CT', preferMostFrames: true } }],
    };
    const scans = [
      scan('small', { modality: 'CT', frames: 20 }),
      scan('large', { modality: 'CT', frames: 200 }),
      scan('nonct', { modality: 'MR', frames: 999 }),
    ];

    const result = applyProtocol(scans, protocol);
    expect(result.assignments.get(0)?.id).toBe('large');
  });
});
