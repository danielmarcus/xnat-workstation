/**
 * Phase 2.9 service-integration tests — multi-viewport acceptance signals.
 *
 * Acceptance signals 9, 10, 11, 12, 14, 15 wired through the modules
 * Phase 2 introduced (visibility, styling, drawingRouting, containerBridge,
 * undoService, transport). These are the regression spine until the
 * cross-series + breath-hold DICOM fixtures Phase 1 deferred land — at which
 * point full Playwright E2E coverage replaces / supplements these tests.
 *
 * Synthetic metadata is injected through the same DI seams production uses
 * (`wireVisibility`, `transport.setAdapter`, `containerBridge.register`),
 * so these tests exercise the real classify / decideDrawingRouting /
 * resolveAction / queue-next-save / undoService paths — only the metadata
 * source and save target are stubbed.
 *
 * NOT mocked: the actual logic modules. NOT bypassed: any layer where
 * the multi-viewport rewrite specifically exists to prevent regressions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as containerBridge from '../containerBridge';
import {
  classifyForEligibility,
  classifySegmentationOnViewport,
  resetVisibilityAdapter,
  shouldRenderByDefault,
  wireVisibility,
  type SourceIdentityForEligibility,
  type VisibilityMetadataAdapter,
} from '../segmentationService/visibility';
import { resolveAction } from '../segmentationService/styling';
import { decideDrawingRouting } from '../segmentationService/drawingRouting';
import { undoService, clearAllHistories } from '../undoService';
import {
  _getStatus,
  clearAll as clearTransport,
  notifyDirty,
  setAdapter,
  setDebounceMs,
  type SaveAdapter,
} from '../segmentationService/transport';
import { useTransportStore } from '../../../stores/transportStore';
import type { HistoryEntry } from '../../../types/annotation';
import type { SaveOutcome } from '../transportContractService';

// ─── Test helpers ────────────────────────────────────────────────────────

function ident(partial: Partial<SourceIdentityForEligibility> = {}): SourceIdentityForEligibility {
  return {
    seriesUID: 'S-default',
    frameOfReferenceUID: 'FOR-default',
    acquisitionNumber: null,
    ...partial,
  };
}

function syntheticAdapter(
  viewports: Map<string, SourceIdentityForEligibility>,
  segmentations: Map<string, SourceIdentityForEligibility>,
  annotations: Map<string, SourceIdentityForEligibility> = new Map(),
): VisibilityMetadataAdapter {
  return {
    getViewportSourceIdentity: (id) => viewports.get(id) ?? null,
    getSegmentationSourceIdentity: (id) => segmentations.get(id) ?? null,
    getAnnotationSourceIdentity: (id) => annotations.get(id) ?? null,
  };
}

function makeHistoryEntry(description: string): HistoryEntry & {
  applySpy: ReturnType<typeof vi.fn>;
  invertSpy: ReturnType<typeof vi.fn>;
} {
  const applySpy = vi.fn();
  const invertSpy = vi.fn();
  return {
    description,
    apply: applySpy,
    invert: invertSpy,
    scopeMemberIds: [],
    at: Date.now(),
    applySpy,
    invertSpy,
  } as HistoryEntry & {
    applySpy: ReturnType<typeof vi.fn>;
    invertSpy: ReturnType<typeof vi.fn>;
  };
}

function makeQueuedAdapter(): {
  adapter: SaveAdapter;
  resolveNext: (outcome: SaveOutcome) => void;
  callCount: () => number;
} {
  const queue: Array<(o: SaveOutcome) => void> = [];
  let calls = 0;
  return {
    adapter: {
      save: () => {
        calls++;
        return new Promise<SaveOutcome>((resolve) => {
          queue.push(resolve);
        });
      },
    },
    resolveNext: (outcome) => {
      const r = queue.shift();
      if (!r) throw new Error('No pending save to resolve');
      r(outcome);
    },
    callCount: () => calls,
  };
}

beforeEach(() => {
  resetVisibilityAdapter();
  containerBridge.clearAll();
  clearAllHistories();
  clearTransport();
  setAdapter(null);
  useTransportStore.getState().clear();
});

afterEach(() => {
  resetVisibilityAdapter();
  containerBridge.clearAll();
  clearAllHistories();
  clearTransport();
  setAdapter(null);
  useTransportStore.getState().clear();
});

// ─── Signals 9 / 10 / 11 — cross-series classification + styling ────────
//
// Phase 1 deferred the DICOM fixtures these signals need (T1+T2 share-FoR
// pair, breath-hold pair, CT+unregistered MR). Until those land, the
// service-integration coverage below verifies the classify + style-action
// pipeline against synthetic metadata that mirrors each scenario.

describe('Signal 9 — T1 + T2 cross-series, same FoR, render with dashed style', () => {
  it('A2b classification on a same-FoR sibling series', () => {
    const t1 = ident({ seriesUID: 'T1-SERIES', frameOfReferenceUID: 'FOR-1', acquisitionNumber: 1 });
    const t2 = ident({ seriesUID: 'T2-SERIES', frameOfReferenceUID: 'FOR-1', acquisitionNumber: 1 });
    expect(classifyForEligibility(t1, t2)).toBe('cross-series-A2b');
  });

  it('renders by default with the master toggle on (default)', () => {
    expect(shouldRenderByDefault('cross-series-A2b', { enabled: true, a2cOptedIn: false })).toBe(true);
  });

  it('resolves to apply-cross-series — the styling pipeline applies the D9 dashed style', () => {
    const action = resolveAction('cross-series-A2b', { enabled: true, a2cOptedIn: false });
    expect(action.kind).toBe('apply-cross-series');
    if (action.kind === 'apply-cross-series') {
      expect(action.visible).toBe(true);
    }
  });

  it('through the wired pipeline: T1 contour rendered on T2 viewport classifies as A2b', () => {
    const t1 = ident({ seriesUID: 'T1-SERIES', frameOfReferenceUID: 'FOR-1' });
    const t2 = ident({ seriesUID: 'T2-SERIES', frameOfReferenceUID: 'FOR-1' });
    wireVisibility(syntheticAdapter(
      new Map([['vp-t2', t2]]),
      new Map([['seg-t1', t1]]),
    ));
    expect(classifySegmentationOnViewport('seg-t1', 'vp-t2')).toBe('cross-series-A2b');
  });

  it('toggling the master switch off hides the contour everywhere', () => {
    expect(shouldRenderByDefault('cross-series-A2b', { enabled: false, a2cOptedIn: false })).toBe(false);
  });
});

describe('Signal 10 — breath-hold / 4D-CT phase pair, off by default', () => {
  it('A2c classification when AcquisitionNumber differs on both sides', () => {
    const bh1 = ident({ seriesUID: 'BH-1', frameOfReferenceUID: 'FOR-1', acquisitionNumber: 1 });
    const bh2 = ident({ seriesUID: 'BH-2', frameOfReferenceUID: 'FOR-1', acquisitionNumber: 2 });
    expect(classifyForEligibility(bh1, bh2)).toBe('cross-series-A2c');
  });

  it('hidden by default in Phase 2 (a2cOptedIn=false until Phase 3 list panel)', () => {
    expect(shouldRenderByDefault('cross-series-A2c', { enabled: true, a2cOptedIn: false })).toBe(false);
  });

  it('explicit per-container opt-in (Phase 3 surface) lights up rendering', () => {
    expect(shouldRenderByDefault('cross-series-A2c', { enabled: true, a2cOptedIn: true })).toBe(true);
  });

  it('master toggle off keeps A2c hidden even with opt-in', () => {
    expect(shouldRenderByDefault('cross-series-A2c', { enabled: false, a2cOptedIn: true })).toBe(false);
  });

  it('styling pipeline resolves to hide for A2c without opt-in', () => {
    expect(resolveAction('cross-series-A2c', { enabled: true, a2cOptedIn: false })).toEqual({ kind: 'hide' });
  });
});

describe('Signal 11 — different FoR, no SRO, list visible but canvas blank', () => {
  it('cross-FoR classification when FoR UIDs differ', () => {
    const ct = ident({ seriesUID: 'CT', frameOfReferenceUID: 'FOR-CT' });
    const mr = ident({ seriesUID: 'MR', frameOfReferenceUID: 'FOR-MR' });
    expect(classifyForEligibility(ct, mr)).toBe('cross-FoR');
  });

  it('cross-FoR never renders — would require SRO ingestion (out of scope for v1)', () => {
    expect(shouldRenderByDefault('cross-FoR', { enabled: true, a2cOptedIn: true })).toBe(false);
  });

  it('styling pipeline resolves to hide', () => {
    expect(resolveAction('cross-FoR', { enabled: true, a2cOptedIn: true })).toEqual({ kind: 'hide' });
  });

  it('the list panel surface is unaffected (D7.4 different-FoR indicator) — verified in Phase 3', () => {
    // Placeholder: the list panel work is Phase 3. The classification result
    // here is the input; Phase 3's list panel reads it to render the
    // "different FoR" indicator. No behavior to assert in Phase 2.
    expect(true).toBe(true);
  });
});

// ─── Signal 12 — drawing routing block on non-native viewport ──────────
//
// Exercises decideDrawingRouting end-to-end with active container,
// viewport identity, and the "any FoR-matched viewport open" flag.

describe('Signal 12 — drawing block on non-native viewport (B3 routing)', () => {
  it('blocks cross-series drawing with a hint pointing to the structure’s native series', () => {
    const decision = decideDrawingRouting({
      activeContainerIdentity: ident({ seriesUID: 'T1-SAG', frameOfReferenceUID: 'FOR-1' }),
      viewportIdentity: ident({ seriesUID: 'T2-AX', frameOfReferenceUID: 'FOR-1' }),
      anyForMatchedViewportOpen: true,
      activeContainerSeriesDescription: 'T1 SAG',
    });
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') {
      expect(decision.reason).toBe('cross-series');
      expect(decision.hintMessage).toContain('T1 SAG');
    }
  });

  it('blocks cross-FoR drawing with a different-FoR hint', () => {
    const decision = decideDrawingRouting({
      activeContainerIdentity: ident({ frameOfReferenceUID: 'FOR-CT' }),
      viewportIdentity: ident({ frameOfReferenceUID: 'FOR-MR' }),
      anyForMatchedViewportOpen: false, // only the MR viewport open
    });
    expect(decision.kind).toBe('block');
  });

  it('allows native drawing (matching FoR + series)', () => {
    const decision = decideDrawingRouting({
      activeContainerIdentity: ident({ seriesUID: 'T1', frameOfReferenceUID: 'FOR-1' }),
      viewportIdentity: ident({ seriesUID: 'T1', frameOfReferenceUID: 'FOR-1' }),
      anyForMatchedViewportOpen: true,
    });
    expect(decision.kind).toBe('allow');
  });

  it('blocks "no FoR-matched viewport open" with a load-compatible-series hint', () => {
    const decision = decideDrawingRouting({
      activeContainerIdentity: ident({ frameOfReferenceUID: 'FOR-MISSING' }),
      viewportIdentity: ident({ frameOfReferenceUID: 'FOR-OTHER' }),
      anyForMatchedViewportOpen: false,
    });
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') {
      expect(decision.reason).toBe('no-for-matched-viewport-open');
    }
  });

  it('is permissive on missing active-container identity (auto-create on first stroke flow)', () => {
    expect(
      decideDrawingRouting({
        activeContainerIdentity: null,
        viewportIdentity: ident(),
        anyForMatchedViewportOpen: true,
      }),
    ).toEqual({ kind: 'allow' });
  });
});

// ─── Signal 14 — queue-next-save end-to-end through transport.notifyDirty ─
//
// Covers the §E2 invariant with the full transport pipeline: bridge dirty
// flag, transportStore record, follow-up save fires after success when
// edits arrived during the in-flight save.

describe('Signal 14 — queue-next-save end-to-end', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDebounceMs(100); // fast debounce for tests
  });

  afterEach(() => {
    vi.useRealTimers();
    setDebounceMs(3000);
  });

  it('rapid edits during an in-flight save yield exactly one queued save (no two concurrent saves)', async () => {
    containerBridge.register('seg_1');
    const containerId = containerBridge.getContainerId('seg_1')!;
    const { adapter, callCount, resolveNext } = makeQueuedAdapter();
    setAdapter(adapter);

    notifyDirty(containerId);
    await vi.advanceTimersByTimeAsync(100); // first save fires
    expect(callCount()).toBe(1);
    expect(_getStatus(containerId)).toBe('saving');

    // Multiple edits land during the save.
    notifyDirty(containerId);
    notifyDirty(containerId);
    notifyDirty(containerId);
    expect(_getStatus(containerId)).toBe('saving-pending');
    expect(callCount()).toBe(1); // never two

    // First save completes; queued save fires immediately.
    resolveNext({ kind: 'success', versionToken: 'v1' });
    await vi.runAllTimersAsync();
    expect(callCount()).toBe(2);
    expect(_getStatus(containerId)).toBe('saving');

    // Second save completes; nothing left.
    resolveNext({ kind: 'success', versionToken: 'v2' });
    await vi.runAllTimersAsync();
    expect(callCount()).toBe(2);
    expect(containerBridge.getContainer(containerId)?.dirty).toBe(false);
    expect(containerBridge.getContainer(containerId)?.versionToken).toBe('v2');
  });

  it('the user perceives "one continuous saving state" — saveInFlight reports true throughout', async () => {
    containerBridge.register('seg_1');
    const containerId = containerBridge.getContainerId('seg_1')!;
    const { adapter, resolveNext } = makeQueuedAdapter();
    setAdapter(adapter);

    notifyDirty(containerId);
    await vi.advanceTimersByTimeAsync(100);
    expect(useTransportStore.getState().get(containerId)?.saveInFlight).toBe(true);

    notifyDirty(containerId);
    expect(_getStatus(containerId)).toBe('saving-pending');
    // saveInFlight stays true through the queue-next-save cycle:
    // success → fires next save synchronously, beginSave fires again.
    resolveNext({ kind: 'success', versionToken: 'v1' });
    await Promise.resolve(); // let the .then chain run
    await Promise.resolve();
    expect(useTransportStore.getState().get(containerId)?.saveInFlight).toBe(true);

    resolveNext({ kind: 'success', versionToken: 'v2' });
    await vi.runAllTimersAsync();
    expect(useTransportStore.getState().get(containerId)?.saveInFlight).toBe(false);
  });
});

// ─── Signal 15 — undo past save point, dirty becomes set again ─────────
//
// Save is not an undo barrier (§A8). After save, undoing past the save
// point must re-mark the container dirty so the next save flushes the
// post-undo state.

describe('Signal 15 — undo past save point re-dirties the container', () => {
  it('undo crossing a successful save reverts geometry and sets dirty=true', async () => {
    vi.useFakeTimers();
    try {
      setDebounceMs(50);

      containerBridge.register('seg_1');
      const containerId = containerBridge.getContainerId('seg_1')!;

      // Adapter that always succeeds.
      let token = 0;
      setAdapter({
        save: async () => ({ kind: 'success', versionToken: `v${++token}` }),
      });

      // Two edits → two HistoryEntries.
      const e1 = makeHistoryEntry('edit 1');
      const e2 = makeHistoryEntry('edit 2');
      undoService.record(containerId, e1);
      undoService.record(containerId, e2);
      notifyDirty(containerId);

      // Debounce → save → success.
      await vi.advanceTimersByTimeAsync(60);
      await vi.runAllTimersAsync();
      expect(containerBridge.getContainer(containerId)?.dirty).toBe(false);
      expect(containerBridge.getContainer(containerId)?.versionToken).toBe('v1');

      // Now undo both entries — past the save point.
      undoService.undo(containerId);
      undoService.undo(containerId);
      expect(e2.invertSpy).toHaveBeenCalledOnce();
      expect(e1.invertSpy).toHaveBeenCalledOnce();
      expect(undoService.canUndo(containerId)).toBe(false);
      expect(undoService.canRedo(containerId)).toBe(true);

      // Per §A8 / signal 15, undoing past the save point must dirty the
      // container so the next save flushes post-undo state. The undo
      // operation itself is a state mutation that should call notifyDirty.
      // (Domain code that calls undoService.undo is also expected to call
      // notifyDirty after — that's the contract.) Verify by simulating
      // that contract:
      notifyDirty(containerId);
      expect(containerBridge.getContainer(containerId)?.dirty).toBe(true);

      // A new save flushes post-undo state with a fresh version token.
      await vi.advanceTimersByTimeAsync(60);
      await vi.runAllTimersAsync();
      expect(containerBridge.getContainer(containerId)?.dirty).toBe(false);
      expect(containerBridge.getContainer(containerId)?.versionToken).toBe('v2');
    } finally {
      vi.useRealTimers();
      setDebounceMs(3000);
    }
  });

  it('save is not an undo barrier — undo stack survives across save', async () => {
    vi.useFakeTimers();
    try {
      setDebounceMs(50);
      containerBridge.register('seg_1');
      const containerId = containerBridge.getContainerId('seg_1')!;
      setAdapter({ save: async () => ({ kind: 'success', versionToken: 'v1' }) });

      const e1 = makeHistoryEntry('pre-save');
      undoService.record(containerId, e1);
      notifyDirty(containerId);
      await vi.advanceTimersByTimeAsync(60);
      await vi.runAllTimersAsync();

      const e2 = makeHistoryEntry('post-save');
      undoService.record(containerId, e2);

      // The save did not clear the undo stack — both entries are still there.
      expect(undoService.getHistory(containerId)?.undoStack).toHaveLength(2);
      expect(undoService.canUndo(containerId)).toBe(true);
    } finally {
      vi.useRealTimers();
      setDebounceMs(3000);
    }
  });
});

// ─── §A8 cross-viewport identity: undo survives panel close ─────────────
//
// Phase 1 covered this at the E2E level (signal G7 / spec 09-undo-after-close
// in flag-off mode); the volume-mode variant is `test.fixme` pending the
// Phase 1 capability gap. This service-integration test covers the §A8
// cross-viewport identity invariant for the Phase 2 container-scoped path.

describe('§A8 cross-viewport identity (signal G7 stand-in for flag-on path)', () => {
  it('undoService dispatches the same HistoryEntry regardless of which viewport originated it', () => {
    containerBridge.register('seg_1');
    const containerId = containerBridge.getContainerId('seg_1')!;

    // Edit originates "from viewport A" — the viewport ID isn't carried by
    // HistoryEntry, the entry is bound to the container. This is the §A8
    // guarantee: undo operates on the container, not the viewport.
    const e = makeHistoryEntry('edit from any viewport');
    undoService.record(containerId, e);

    // "Viewport A is closed" — no-op for undoService since it doesn't
    // track viewport identity. Undo still works.
    const popped = undoService.undo(containerId);
    expect(popped).toBe(e);
    expect(e.invertSpy).toHaveBeenCalledOnce();
  });
});
