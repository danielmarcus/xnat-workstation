/**
 * Tests for the Phase 4.1 provenance stamping module.
 *
 * The pure handler `handleInterpolationCompleted` is exercised directly
 * with synthetic event-detail shapes and synthetic deps. The lifecycle
 * (initialize / dispose / wireProvenance) is exercised through the
 * `eventTarget` mock — same Cornerstone-mocking pattern as
 * `containerService.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEventTarget } = vi.hoisted(() => ({
  mockEventTarget: new EventTarget(),
}));

vi.mock('@cornerstonejs/core', () => ({
  eventTarget: mockEventTarget,
}));

vi.mock('@cornerstonejs/tools', () => ({
  Enums: {
    Events: {
      ANNOTATION_INTERPOLATION_PROCESS_COMPLETED:
        'CS_TOOLS_ANNOTATION_INTERPOLATION_PROCESS_COMPLETED',
    },
  },
}));

import {
  dispose,
  handleInterpolationCompleted,
  initialize,
  resetProvenanceWiring,
  wireProvenance,
  type ProvenanceDeps,
} from './provenance';

const EVENT_NAME = 'CS_TOOLS_ANNOTATION_INTERPOLATION_PROCESS_COMPLETED';

interface Calls {
  resolveCalls: Array<[string, number]>;
  stampCalls: string[];
}

function makeDeps(opts: {
  resolution?: (csSegId: string, idx: number) => string | null;
} = {}): { deps: ProvenanceDeps; calls: Calls } {
  const calls: Calls = { resolveCalls: [], stampCalls: [] };
  const deps: ProvenanceDeps = {
    memberIdForCsSegment(csSegId, idx) {
      calls.resolveCalls.push([csSegId, idx]);
      return opts.resolution
        ? opts.resolution(csSegId, idx)
        : `member_${csSegId}_${idx}`;
    },
    stampInterpolated(memberId) {
      calls.stampCalls.push(memberId);
    },
  };
  return { deps, calls };
}

function makeDetail(segmentationId: string, segmentIndex: number): unknown {
  return {
    annotation: {
      data: {
        segmentation: { segmentationId, segmentIndex },
      },
    },
    element: {} as unknown,
    viewportId: 'vp1',
    renderingEngineId: 're1',
  };
}

afterEach(() => {
  dispose();
  resetProvenanceWiring();
});

// ─── Pure handler ─────────────────────────────────────────────────────

describe('handleInterpolationCompleted (pure)', () => {
  it('resolves (segmentationId, segmentIndex) → memberId and stamps', () => {
    const { deps, calls } = makeDeps();
    handleInterpolationCompleted(makeDetail('seg_1', 3), deps);
    expect(calls.resolveCalls).toEqual([['seg_1', 3]]);
    expect(calls.stampCalls).toEqual(['member_seg_1_3']);
  });

  it('skips when memberId resolution returns null', () => {
    const { deps, calls } = makeDeps({ resolution: () => null });
    handleInterpolationCompleted(makeDetail('seg_1', 3), deps);
    expect(calls.resolveCalls).toEqual([['seg_1', 3]]);
    expect(calls.stampCalls).toEqual([]);
  });

  it('skips when segmentationId is missing', () => {
    const { deps, calls } = makeDeps();
    handleInterpolationCompleted(
      { annotation: { data: { segmentation: { segmentIndex: 3 } } } },
      deps,
    );
    expect(calls.stampCalls).toEqual([]);
  });

  it('skips when segmentIndex is missing', () => {
    const { deps, calls } = makeDeps();
    handleInterpolationCompleted(
      { annotation: { data: { segmentation: { segmentationId: 'seg_1' } } } },
      deps,
    );
    expect(calls.stampCalls).toEqual([]);
  });

  it('skips when segmentIndex is not a positive integer', () => {
    const { deps, calls } = makeDeps();
    handleInterpolationCompleted(makeDetail('seg_1', 0), deps);
    handleInterpolationCompleted(makeDetail('seg_1', -1), deps);
    handleInterpolationCompleted(makeDetail('seg_1', 1.5), deps);
    expect(calls.stampCalls).toEqual([]);
  });

  it('skips on malformed details (no throw)', () => {
    const { deps, calls } = makeDeps();
    expect(() => handleInterpolationCompleted(undefined, deps)).not.toThrow();
    expect(() => handleInterpolationCompleted({}, deps)).not.toThrow();
    expect(() => handleInterpolationCompleted({ annotation: 'string' }, deps)).not.toThrow();
    expect(() => handleInterpolationCompleted({ annotation: { data: null } }, deps)).not.toThrow();
    expect(calls.stampCalls).toEqual([]);
  });

  it('stamps multiple times across successive event detail shapes (idempotent at stamp level)', () => {
    // Cornerstone fires the event once per pair; multiple pairs in one
    // op produce multiple events. The pure handler doesn't dedupe — the
    // setter at the containerService layer is the idempotency boundary.
    const { deps, calls } = makeDeps();
    handleInterpolationCompleted(makeDetail('seg_1', 3), deps);
    handleInterpolationCompleted(makeDetail('seg_1', 3), deps);
    handleInterpolationCompleted(makeDetail('seg_2', 5), deps);
    expect(calls.stampCalls).toEqual([
      'member_seg_1_3',
      'member_seg_1_3',
      'member_seg_2_5',
    ]);
  });
});

// ─── Lifecycle ────────────────────────────────────────────────────────

describe('initialize / dispose lifecycle', () => {
  it('subscribes to ANNOTATION_INTERPOLATION_PROCESS_COMPLETED on initialize()', () => {
    const { deps, calls } = makeDeps();
    wireProvenance(deps);
    initialize();
    mockEventTarget.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: makeDetail('seg_1', 2) }),
    );
    expect(calls.stampCalls).toEqual(['member_seg_1_2']);
  });

  it('idempotent on a second initialize() — does not double-subscribe', () => {
    const { deps, calls } = makeDeps();
    wireProvenance(deps);
    initialize();
    initialize();
    mockEventTarget.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: makeDetail('seg_1', 2) }),
    );
    expect(calls.stampCalls).toEqual(['member_seg_1_2']);
  });

  it('dispose() detaches the listener', () => {
    const { deps, calls } = makeDeps();
    wireProvenance(deps);
    initialize();
    dispose();
    mockEventTarget.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: makeDetail('seg_1', 2) }),
    );
    expect(calls.stampCalls).toEqual([]);
  });

  it('dispose() before initialize() is safe', () => {
    expect(() => dispose()).not.toThrow();
  });

  it('an unwired listener is a no-op on event dispatch (no throw)', () => {
    initialize();
    expect(() =>
      mockEventTarget.dispatchEvent(
        new CustomEvent(EVENT_NAME, { detail: makeDetail('seg_1', 2) }),
      ),
    ).not.toThrow();
  });

  it('a throw inside the deps surfaces as a console warning, not a dispatcher break', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    wireProvenance({
      memberIdForCsSegment: () => 'member_x',
      stampInterpolated: () => {
        throw new Error('boom');
      },
    });
    initialize();
    expect(() =>
      mockEventTarget.dispatchEvent(
        new CustomEvent(EVENT_NAME, { detail: makeDetail('seg_1', 2) }),
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('wireProvenance / resetProvenanceWiring', () => {
  it('switches the active deps mid-session', () => {
    const a = makeDeps();
    const b = makeDeps();
    wireProvenance(a.deps);
    initialize();
    mockEventTarget.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: makeDetail('seg_1', 1) }),
    );
    expect(a.calls.stampCalls).toEqual(['member_seg_1_1']);
    expect(b.calls.stampCalls).toEqual([]);

    wireProvenance(b.deps);
    mockEventTarget.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: makeDetail('seg_2', 2) }),
    );
    expect(a.calls.stampCalls).toEqual(['member_seg_1_1']);
    expect(b.calls.stampCalls).toEqual(['member_seg_2_2']);
  });

  it('reset returns to no-op deps', () => {
    const { deps, calls } = makeDeps();
    wireProvenance(deps);
    initialize();
    resetProvenanceWiring();
    mockEventTarget.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: makeDetail('seg_3', 4) }),
    );
    expect(calls.stampCalls).toEqual([]);
  });
});

beforeEach(() => {
  // Ensure a clean module state before each test, so dispose() teardown
  // in afterEach can't carry residual state across cases.
  resetProvenanceWiring();
});
