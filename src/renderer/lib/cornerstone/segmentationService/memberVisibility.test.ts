/**
 * Tests for the Phase 3.4 per-member visibility-mode application.
 *
 * Pure-logic helpers (resolveMemberStyle, nextVisibilityMode) are
 * verified independently of the apply step, which uses synthetic deps
 * to assert the right Cornerstone call sequence.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applyMemberVisibilityMode,
  nextVisibilityMode,
  resolveMemberStyle,
  type MemberVisibilityDeps,
} from './memberVisibility';

// ─── resolveMemberStyle ────────────────────────────────────────────────

describe('resolveMemberStyle', () => {
  it('hidden → no fill, no outline, not visible', () => {
    expect(resolveMemberStyle('hidden')).toEqual({
      renderFill: false,
      renderOutline: false,
      visible: false,
    });
  });

  it('outlined → outline only, visible', () => {
    expect(resolveMemberStyle('outlined')).toEqual({
      renderFill: false,
      renderOutline: true,
      visible: true,
    });
  });

  it('filled → fill + outline, visible', () => {
    expect(resolveMemberStyle('filled')).toEqual({
      renderFill: true,
      renderOutline: true,
      visible: true,
    });
  });
});

// ─── nextVisibilityMode ────────────────────────────────────────────────

describe('nextVisibilityMode', () => {
  it('cycles filled → outlined → hidden → filled', () => {
    expect(nextVisibilityMode('filled')).toBe('outlined');
    expect(nextVisibilityMode('outlined')).toBe('hidden');
    expect(nextVisibilityMode('hidden')).toBe('filled');
  });
});

// ─── applyMemberVisibilityMode ────────────────────────────────────────

interface MockCalls {
  setSegmentStyle: Array<[string, number, string, Record<string, unknown>]>;
  setSegmentVisibility: Array<[string, string, number, string, boolean]>;
}

function makeDeps(opts: {
  representationKinds?: Array<'Labelmap' | 'Contour'>;
  viewportIds?: string[];
}): { deps: MemberVisibilityDeps; calls: MockCalls } {
  const calls: MockCalls = {
    setSegmentStyle: [],
    setSegmentVisibility: [],
  };
  const deps: MemberVisibilityDeps = {
    setSegmentStyle: vi.fn((segId, idx, kind, styles) => {
      calls.setSegmentStyle.push([segId, idx, kind, styles]);
    }),
    setSegmentVisibility: vi.fn((vp, segId, idx, kind, visible) => {
      calls.setSegmentVisibility.push([vp, segId, idx, kind, visible]);
    }),
    getViewportIdsWithSegmentation: () => opts.viewportIds ?? ['vp_0'],
    getRepresentationKinds: () => opts.representationKinds ?? ['Labelmap'],
  };
  return { deps, calls };
}

describe('applyMemberVisibilityMode', () => {
  it('filled → setStyle with renderFill:true + setVisibility:true on each viewport', () => {
    const { deps, calls } = makeDeps({
      representationKinds: ['Labelmap'],
      viewportIds: ['vp_0', 'vp_1'],
    });
    applyMemberVisibilityMode(deps, 'seg_1', 1, 'filled');

    expect(calls.setSegmentStyle).toEqual([
      ['seg_1', 1, 'Labelmap', {
        renderFill: true,
        renderOutline: true,
        renderFillInactive: true,
        renderOutlineInactive: true,
      }],
    ]);
    expect(calls.setSegmentVisibility).toEqual([
      ['vp_0', 'seg_1', 1, 'Labelmap', true],
      ['vp_1', 'seg_1', 1, 'Labelmap', true],
    ]);
  });

  it('outlined → renderFill:false but renderOutline:true; visible:true', () => {
    const { deps, calls } = makeDeps({
      representationKinds: ['Labelmap'],
      viewportIds: ['vp_0'],
    });
    applyMemberVisibilityMode(deps, 'seg_1', 1, 'outlined');

    expect(calls.setSegmentStyle[0][3]).toMatchObject({
      renderFill: false,
      renderOutline: true,
    });
    expect(calls.setSegmentVisibility).toEqual([
      ['vp_0', 'seg_1', 1, 'Labelmap', true],
    ]);
  });

  it('hidden → renderFill:false + renderOutline:false; visible:false', () => {
    const { deps, calls } = makeDeps({
      representationKinds: ['Labelmap'],
      viewportIds: ['vp_0'],
    });
    applyMemberVisibilityMode(deps, 'seg_1', 1, 'hidden');

    expect(calls.setSegmentStyle[0][3]).toMatchObject({
      renderFill: false,
      renderOutline: false,
    });
    expect(calls.setSegmentVisibility).toEqual([
      ['vp_0', 'seg_1', 1, 'Labelmap', false],
    ]);
  });

  it('applies to ALL representation kinds when the segmentation has both', () => {
    const { deps, calls } = makeDeps({
      representationKinds: ['Labelmap', 'Contour'],
      viewportIds: ['vp_0'],
    });
    applyMemberVisibilityMode(deps, 'seg_1', 1, 'filled');

    expect(calls.setSegmentStyle.map((c) => c[2])).toEqual(['Labelmap', 'Contour']);
    expect(calls.setSegmentVisibility.map((c) => c[3])).toEqual(['Labelmap', 'Contour']);
  });

  it('with no viewports attached, still applies the style override (future viewports inherit it)', () => {
    const { deps, calls } = makeDeps({
      representationKinds: ['Labelmap'],
      viewportIds: [],
    });
    applyMemberVisibilityMode(deps, 'seg_1', 1, 'outlined');

    expect(calls.setSegmentStyle).toHaveLength(1);
    expect(calls.setSegmentVisibility).toHaveLength(0);
  });

  it('skips empty segmentationId', () => {
    const { deps, calls } = makeDeps({});
    applyMemberVisibilityMode(deps, '', 1, 'filled');
    expect(calls.setSegmentStyle).toEqual([]);
    expect(calls.setSegmentVisibility).toEqual([]);
  });

  it('skips invalid segmentIndex (0, negative, non-integer)', () => {
    const { deps, calls } = makeDeps({});
    applyMemberVisibilityMode(deps, 'seg_1', 0, 'filled');
    applyMemberVisibilityMode(deps, 'seg_1', -1, 'filled');
    applyMemberVisibilityMode(deps, 'seg_1', 1.5, 'filled');
    expect(calls.setSegmentStyle).toEqual([]);
    expect(calls.setSegmentVisibility).toEqual([]);
  });
});
