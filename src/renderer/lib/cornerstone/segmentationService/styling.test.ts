import { describe, expect, it, vi } from 'vitest';
import {
  CROSS_SERIES_CONTOUR_STYLE,
  CROSS_SERIES_LABELMAP_STYLE,
  createStylingService,
  resolveAction,
  type StylingDeps,
  type SegmentationRepresentationKind,
} from './styling';
import type { EligibilityClass, CrossSeriesRenderingPolicy } from './visibility';

// ─── resolveAction (pure logic) ─────────────────────────────────────────

describe('resolveAction', () => {
  const ON_OPTED_IN: CrossSeriesRenderingPolicy = { enabled: true, a2cOptedIn: true };
  const ON_NOT_OPTED_IN: CrossSeriesRenderingPolicy = { enabled: true, a2cOptedIn: false };
  const OFF: CrossSeriesRenderingPolicy = { enabled: false, a2cOptedIn: false };

  it('null eligibility → reset (be permissive on missing metadata)', () => {
    expect(resolveAction(null, ON_OPTED_IN)).toEqual({ kind: 'reset' });
  });

  it('native → reset (inherit global style; visible)', () => {
    expect(resolveAction('native', ON_OPTED_IN)).toEqual({ kind: 'reset' });
    expect(resolveAction('native', OFF)).toEqual({ kind: 'reset' });
  });

  it('cross-FoR → hide unconditionally', () => {
    expect(resolveAction('cross-FoR', ON_OPTED_IN)).toEqual({ kind: 'hide' });
    expect(resolveAction('cross-FoR', OFF)).toEqual({ kind: 'hide' });
  });

  it('A2b + global enabled → apply-cross-series visible', () => {
    expect(resolveAction('cross-series-A2b', ON_OPTED_IN)).toEqual({ kind: 'apply-cross-series', visible: true });
    expect(resolveAction('cross-series-A2b', ON_NOT_OPTED_IN)).toEqual({ kind: 'apply-cross-series', visible: true });
  });

  it('A2b + global disabled → hide', () => {
    expect(resolveAction('cross-series-A2b', OFF)).toEqual({ kind: 'hide' });
  });

  it('A2c needs BOTH global on AND opt-in to render', () => {
    expect(resolveAction('cross-series-A2c', ON_OPTED_IN)).toEqual({ kind: 'apply-cross-series', visible: true });
    expect(resolveAction('cross-series-A2c', ON_NOT_OPTED_IN)).toEqual({ kind: 'hide' });
    expect(resolveAction('cross-series-A2c', OFF)).toEqual({ kind: 'hide' });
  });
});

// ─── StylingService factory (with synthetic deps) ──────────────────────

interface MockCalls {
  setStyle: Array<[string, string, SegmentationRepresentationKind, Record<string, unknown>]>;
  resetStyle: Array<[string, string, SegmentationRepresentationKind]>;
  setVisibility: Array<[string, string, SegmentationRepresentationKind, boolean]>;
}

function makeDeps(opts: {
  classify: (segId: string, vpId: string) => EligibilityClass | null;
  policy: CrossSeriesRenderingPolicy;
  representationKinds?: SegmentationRepresentationKind[];
}): { deps: StylingDeps; calls: MockCalls } {
  const calls: MockCalls = { setStyle: [], resetStyle: [], setVisibility: [] };
  const deps: StylingDeps = {
    setStyle: vi.fn((vp, seg, kind, styles) => {
      calls.setStyle.push([vp, seg, kind, styles]);
    }),
    resetStyle: vi.fn((vp, seg, kind) => {
      calls.resetStyle.push([vp, seg, kind]);
    }),
    setVisibility: vi.fn((vp, seg, kind, visible) => {
      calls.setVisibility.push([vp, seg, kind, visible]);
    }),
    getRepresentationKinds: () => opts.representationKinds ?? ['Labelmap'],
    classify: opts.classify,
    readPolicy: () => opts.policy,
  };
  return { deps, calls };
}

describe('createStylingService.applyForSegmentationViewport', () => {
  it('native segmentation → resetStyle + setVisibility(true) for each represented kind', () => {
    const { deps, calls } = makeDeps({
      classify: () => 'native',
      policy: { enabled: true, a2cOptedIn: false },
      representationKinds: ['Labelmap', 'Contour'],
    });
    const svc = createStylingService(deps);
    svc.applyForSegmentationViewport('seg', 'vp');

    expect(calls.resetStyle).toEqual([
      ['vp', 'seg', 'Labelmap'],
      ['vp', 'seg', 'Contour'],
    ]);
    expect(calls.setVisibility).toEqual([
      ['vp', 'seg', 'Labelmap', true],
      ['vp', 'seg', 'Contour', true],
    ]);
    expect(calls.setStyle).toEqual([]);
  });

  it('A2b cross-series with global enabled → apply CROSS_SERIES_*_STYLE per kind, visible=true', () => {
    const { deps, calls } = makeDeps({
      classify: () => 'cross-series-A2b',
      policy: { enabled: true, a2cOptedIn: false },
      representationKinds: ['Contour', 'Labelmap'],
    });
    const svc = createStylingService(deps);
    svc.applyForSegmentationViewport('seg', 'vp');

    expect(calls.setStyle).toEqual([
      ['vp', 'seg', 'Contour', { ...CROSS_SERIES_CONTOUR_STYLE }],
      ['vp', 'seg', 'Labelmap', { ...CROSS_SERIES_LABELMAP_STYLE }],
    ]);
    expect(calls.setVisibility).toEqual([
      ['vp', 'seg', 'Contour', true],
      ['vp', 'seg', 'Labelmap', true],
    ]);
    expect(calls.resetStyle).toEqual([]);
  });

  it('A2c cross-series without opt-in (Phase 2 default) → hide', () => {
    const { deps, calls } = makeDeps({
      classify: () => 'cross-series-A2c',
      policy: { enabled: true, a2cOptedIn: false },
      representationKinds: ['Labelmap'],
    });
    const svc = createStylingService(deps);
    svc.applyForSegmentationViewport('seg', 'vp');

    expect(calls.setVisibility).toEqual([['vp', 'seg', 'Labelmap', false]]);
    expect(calls.setStyle).toEqual([]);
    expect(calls.resetStyle).toEqual([]);
  });

  it('A2c with opt-in (Phase 3 path) → apply cross-series style', () => {
    const { deps, calls } = makeDeps({
      classify: () => 'cross-series-A2c',
      policy: { enabled: true, a2cOptedIn: true },
      representationKinds: ['Contour'],
    });
    const svc = createStylingService(deps);
    svc.applyForSegmentationViewport('seg', 'vp');

    expect(calls.setStyle).toEqual([
      ['vp', 'seg', 'Contour', { ...CROSS_SERIES_CONTOUR_STYLE }],
    ]);
    expect(calls.setVisibility).toEqual([['vp', 'seg', 'Contour', true]]);
  });

  it('cross-FoR → hide regardless of policy', () => {
    const { deps, calls } = makeDeps({
      classify: () => 'cross-FoR',
      policy: { enabled: true, a2cOptedIn: true },
      representationKinds: ['Labelmap'],
    });
    const svc = createStylingService(deps);
    svc.applyForSegmentationViewport('seg', 'vp');
    expect(calls.setVisibility).toEqual([['vp', 'seg', 'Labelmap', false]]);
  });

  it('global toggle off → A2b/A2c hidden, native still resets (visible)', () => {
    const { deps: depsB, calls: callsB } = makeDeps({
      classify: () => 'cross-series-A2b',
      policy: { enabled: false, a2cOptedIn: false },
      representationKinds: ['Contour'],
    });
    createStylingService(depsB).applyForSegmentationViewport('seg', 'vp');
    expect(callsB.setVisibility).toEqual([['vp', 'seg', 'Contour', false]]);

    const { deps: depsN, calls: callsN } = makeDeps({
      classify: () => 'native',
      policy: { enabled: false, a2cOptedIn: false },
      representationKinds: ['Contour'],
    });
    createStylingService(depsN).applyForSegmentationViewport('seg', 'vp');
    expect(callsN.setVisibility).toEqual([['vp', 'seg', 'Contour', true]]);
    expect(callsN.resetStyle).toEqual([['vp', 'seg', 'Contour']]);
  });

  it('null classification (unknown identity) → reset (permissive default)', () => {
    const { deps, calls } = makeDeps({
      classify: () => null,
      policy: { enabled: true, a2cOptedIn: false },
      representationKinds: ['Labelmap'],
    });
    createStylingService(deps).applyForSegmentationViewport('seg', 'vp');
    expect(calls.resetStyle).toEqual([['vp', 'seg', 'Labelmap']]);
    expect(calls.setVisibility).toEqual([['vp', 'seg', 'Labelmap', true]]);
  });

  it('segmentation with no representation kinds → no calls (idempotent no-op)', () => {
    const { deps, calls } = makeDeps({
      classify: () => 'cross-series-A2b',
      policy: { enabled: true, a2cOptedIn: false },
      representationKinds: [],
    });
    createStylingService(deps).applyForSegmentationViewport('seg', 'vp');
    expect(calls.setStyle).toEqual([]);
    expect(calls.resetStyle).toEqual([]);
    expect(calls.setVisibility).toEqual([]);
  });
});

describe('createStylingService.applyForAllPairs', () => {
  it('iterates pairs and applies each one independently', () => {
    const classifyMap = new Map<string, EligibilityClass>([
      ['vp1::seg1', 'native'],
      ['vp2::seg1', 'cross-series-A2b'],
      ['vp1::seg2', 'cross-FoR'],
    ]);
    const { deps, calls } = makeDeps({
      classify: (segId, vpId) => classifyMap.get(`${vpId}::${segId}`) ?? null,
      policy: { enabled: true, a2cOptedIn: false },
      representationKinds: ['Labelmap'],
    });

    createStylingService(deps).applyForAllPairs([
      { segmentationId: 'seg1', viewportId: 'vp1' },
      { segmentationId: 'seg1', viewportId: 'vp2' },
      { segmentationId: 'seg2', viewportId: 'vp1' },
    ]);

    // seg1@vp1 native → resetStyle + visible=true
    expect(calls.resetStyle).toContainEqual(['vp1', 'seg1', 'Labelmap']);
    expect(calls.setVisibility).toContainEqual(['vp1', 'seg1', 'Labelmap', true]);

    // seg1@vp2 A2b → setStyle + visible=true
    expect(calls.setStyle).toContainEqual([
      'vp2', 'seg1', 'Labelmap', { ...CROSS_SERIES_LABELMAP_STYLE },
    ]);
    expect(calls.setVisibility).toContainEqual(['vp2', 'seg1', 'Labelmap', true]);

    // seg2@vp1 cross-FoR → visibility=false
    expect(calls.setVisibility).toContainEqual(['vp1', 'seg2', 'Labelmap', false]);
  });
});
