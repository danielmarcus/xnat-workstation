/**
 * Tests for the Phase 2.8a queue-next-save coordinator.
 *
 * Uses fake timers + a synthetic SaveAdapter to drive each branch of the
 * state machine. Assertions verify:
 *   - bridge bookkeeping (dirty, saveInFlight, versionToken),
 *   - transport store outcomes (success, conflict, transient-failure,
 *     permanent-failure),
 *   - queue-next-save semantics (edits during save → exactly one follow-up
 *     save fires on success; never two concurrent saves).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as containerBridge from '../containerBridge';
import { useTransportStore, type TransportError } from '../../../stores/transportStore';
import type { SaveOutcome } from '../transportContractService';
import {
  _getStatus,
  cancelPending,
  clearAll,
  flushNow,
  getDebounceMs,
  notifyDirty,
  setAdapter,
  setDebounceMs,
  type SaveAdapter,
} from './transport';

const TRANSIENT_ERROR: TransportError = {
  kind: 'transient',
  message: 'network down',
  at: 0,
};
const PERMANENT_ERROR: TransportError = {
  kind: 'permanent',
  message: 'unauthorized',
  at: 0,
};

function makeAdapter(): {
  adapter: SaveAdapter;
  resolveNext: (outcome: SaveOutcome) => void;
  rejectNext: (err: unknown) => void;
  callCount: () => number;
  lastContainerId: () => string | undefined;
} {
  const queue: Array<{
    resolve: (o: SaveOutcome) => void;
    reject: (e: unknown) => void;
    containerId: string;
  }> = [];
  let calls = 0;
  let lastId: string | undefined;
  const adapter: SaveAdapter = {
    save(containerId: string) {
      calls++;
      lastId = containerId;
      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject, containerId });
      });
    },
  };
  return {
    adapter,
    resolveNext: (outcome) => {
      const next = queue.shift();
      if (!next) throw new Error('No pending save to resolve');
      next.resolve(outcome);
    },
    rejectNext: (err) => {
      const next = queue.shift();
      if (!next) throw new Error('No pending save to reject');
      next.reject(err);
    },
    callCount: () => calls,
    lastContainerId: () => lastId,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  clearAll();
  useTransportStore.getState().clear();
  containerBridge.clearAll();
  setDebounceMs(3000);
  setAdapter(null);
});

afterEach(() => {
  setAdapter(null);
  clearAll();
  vi.useRealTimers();
});

// ─── Debounce mechanics ────────────────────────────────────────────────

describe('notifyDirty + debounce', () => {
  it('marks bridge dirty immediately', () => {
    containerBridge.register('seg_1');
    const containerId = containerBridge.getContainerId('seg_1')!;
    notifyDirty(containerId);
    expect(containerBridge.getContainer(containerId)?.dirty).toBe(true);
  });

  it('schedules a save that fires after the debounce window', async () => {
    const { adapter, callCount, lastContainerId, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty('container_A');
    expect(_getStatus('container_A')).toBe('debouncing');
    expect(callCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(2999);
    expect(callCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(callCount()).toBe(1);
    expect(lastContainerId()).toBe('container_A');

    resolveNext({ kind: 'success', versionToken: 'v1' });
  });

  it('multiple notifyDirty calls within the debounce window reset the timer', async () => {
    const { adapter, callCount, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty('container_A');
    await vi.advanceTimersByTimeAsync(2000);
    notifyDirty('container_A'); // resets the timer
    await vi.advanceTimersByTimeAsync(2000);
    expect(callCount()).toBe(0); // would have fired at 3000 if not reset
    await vi.advanceTimersByTimeAsync(1000);
    expect(callCount()).toBe(1);
    resolveNext({ kind: 'success', versionToken: 'v1' });
  });

  it('respects setDebounceMs', () => {
    setDebounceMs(500);
    expect(getDebounceMs()).toBe(500);
  });

  it('cancelPending stops the debounced save without firing', async () => {
    const { adapter, callCount } = makeAdapter();
    setAdapter(adapter);

    notifyDirty('container_A');
    cancelPending('container_A');
    expect(_getStatus('container_A')).toBe('idle');

    await vi.advanceTimersByTimeAsync(5000);
    expect(callCount()).toBe(0);
  });
});

// ─── Outcomes ──────────────────────────────────────────────────────────

describe('save outcomes', () => {
  it('success → transportStore records success, bridge dirty cleared, versionToken set', async () => {
    containerBridge.register('seg_1');
    const containerId = containerBridge.getContainerId('seg_1')!;
    const { adapter, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty(containerId);
    await vi.advanceTimersByTimeAsync(3000);
    resolveNext({ kind: 'success', versionToken: 'v-abc' });
    await vi.runAllTimersAsync();

    const record = useTransportStore.getState().get(containerId)!;
    expect(record.lastOutcome).toBe('success');
    expect(record.versionToken).toBe('v-abc');
    expect(record.saveInFlight).toBe(false);

    const c = containerBridge.getContainer(containerId);
    expect(c?.dirty).toBe(false);
    expect(c?.versionToken).toBe('v-abc');
    expect(c?.saveInFlight).toBe(false);

    expect(_getStatus(containerId)).toBe('idle');
  });

  it('conflict → preserves dirty, sets externalChangePending, status idle', async () => {
    containerBridge.register('seg_1');
    const containerId = containerBridge.getContainerId('seg_1')!;
    const { adapter, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty(containerId);
    await vi.advanceTimersByTimeAsync(3000);
    resolveNext({ kind: 'conflict' });
    await vi.runAllTimersAsync();

    const record = useTransportStore.getState().get(containerId)!;
    expect(record.lastOutcome).toBe('conflict');
    expect(record.externalChangePending).toBe(true);
    // Local edits preserved per §E2 conflict handling.
    expect(containerBridge.getContainer(containerId)?.dirty).toBe(true);
  });

  it('transient-failure → preserves dirty, records error', async () => {
    containerBridge.register('seg_1');
    const containerId = containerBridge.getContainerId('seg_1')!;
    const { adapter, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty(containerId);
    await vi.advanceTimersByTimeAsync(3000);
    resolveNext({ kind: 'transient-failure', error: TRANSIENT_ERROR });
    await vi.runAllTimersAsync();

    const record = useTransportStore.getState().get(containerId)!;
    expect(record.lastOutcome).toBe('transient-failure');
    expect(record.lastError?.kind).toBe('transient');
    expect(containerBridge.getContainer(containerId)?.dirty).toBe(true);
  });

  it('permanent-failure → records error, container stays dirty', async () => {
    containerBridge.register('seg_1');
    const containerId = containerBridge.getContainerId('seg_1')!;
    const { adapter, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty(containerId);
    await vi.advanceTimersByTimeAsync(3000);
    resolveNext({ kind: 'permanent-failure', error: PERMANENT_ERROR });
    await vi.runAllTimersAsync();

    const record = useTransportStore.getState().get(containerId)!;
    expect(record.lastOutcome).toBe('permanent-failure');
    expect(record.lastError?.kind).toBe('permanent');
    expect(containerBridge.getContainer(containerId)?.dirty).toBe(true);
  });

  it('thrown error from adapter is treated as transient-failure', async () => {
    containerBridge.register('seg_1');
    const containerId = containerBridge.getContainerId('seg_1')!;
    const { adapter, rejectNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty(containerId);
    await vi.advanceTimersByTimeAsync(3000);
    rejectNext(new Error('something exploded'));
    await vi.runAllTimersAsync();

    const record = useTransportStore.getState().get(containerId)!;
    expect(record.lastOutcome).toBe('transient-failure');
    expect(record.lastError?.message).toBe('something exploded');
  });
});

// ─── Queue-next-save (the §E2 invariant) ───────────────────────────────

describe('queue-next-save (§E2)', () => {
  it('an edit during a save sets pending; a follow-up save fires after success', async () => {
    containerBridge.register('seg_1');
    const containerId = containerBridge.getContainerId('seg_1')!;
    const { adapter, callCount, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty(containerId);
    await vi.advanceTimersByTimeAsync(3000);
    expect(_getStatus(containerId)).toBe('saving');
    expect(callCount()).toBe(1);

    // Edit lands while save is in flight.
    notifyDirty(containerId);
    expect(_getStatus(containerId)).toBe('saving-pending');
    expect(callCount()).toBe(1); // still one — never two concurrent saves

    // First save completes successfully.
    resolveNext({ kind: 'success', versionToken: 'v1' });
    await vi.runAllTimersAsync();

    // §E2: a follow-up save fired immediately (skip debounce).
    expect(callCount()).toBe(2);
    expect(_getStatus(containerId)).toBe('saving');
    expect(containerBridge.getContainer(containerId)?.dirty).toBe(true);

    resolveNext({ kind: 'success', versionToken: 'v2' });
    await vi.runAllTimersAsync();

    // Now everything is clean.
    expect(callCount()).toBe(2);
    expect(containerBridge.getContainer(containerId)?.dirty).toBe(false);
    expect(containerBridge.getContainer(containerId)?.versionToken).toBe('v2');
    expect(_getStatus(containerId)).toBe('idle');
  });

  it('multiple edits during a save coalesce into a single follow-up save', async () => {
    const { adapter, callCount, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000); // first save fires

    notifyDirty('A');
    notifyDirty('A');
    notifyDirty('A'); // all coalesced into a single pending bit

    resolveNext({ kind: 'success', versionToken: 'v1' });
    await vi.runAllTimersAsync();

    expect(callCount()).toBe(2); // not 4
    resolveNext({ kind: 'success', versionToken: 'v2' });
    await vi.runAllTimersAsync();
  });

  it('conflict during save does NOT fire a follow-up save', async () => {
    const { adapter, callCount, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000);
    notifyDirty('A'); // pending set
    resolveNext({ kind: 'conflict' });
    await vi.runAllTimersAsync();

    // Conflict handling defers to user; no follow-up save fires automatically.
    expect(callCount()).toBe(1);
    expect(_getStatus('A')).toBe('idle');
  });

  it('transient failure during save does NOT fire a follow-up save', async () => {
    const { adapter, callCount, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000);
    notifyDirty('A');
    resolveNext({ kind: 'transient-failure', error: TRANSIENT_ERROR });
    await vi.runAllTimersAsync();

    // User retries via next edit or manual flush.
    expect(callCount()).toBe(1);
  });
});

// ─── Per-container isolation ───────────────────────────────────────────

describe('per-container isolation', () => {
  it('saves on different containers run independently', async () => {
    const { adapter, callCount, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty('A');
    notifyDirty('B');
    await vi.advanceTimersByTimeAsync(3000);
    expect(callCount()).toBe(2);
    expect(_getStatus('A')).toBe('saving');
    expect(_getStatus('B')).toBe('saving');

    resolveNext({ kind: 'success', versionToken: 'va' });
    await vi.runAllTimersAsync();
    expect(_getStatus('A')).toBe('idle');
    expect(_getStatus('B')).toBe('saving'); // still in flight

    resolveNext({ kind: 'success', versionToken: 'vb' });
    await vi.runAllTimersAsync();
    expect(_getStatus('B')).toBe('idle');
  });

  it('A’s pending bit doesn’t affect B’s state', async () => {
    const { adapter, callCount, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty('A');
    notifyDirty('B');
    await vi.advanceTimersByTimeAsync(3000);
    notifyDirty('A'); // pending on A only
    expect(_getStatus('A')).toBe('saving-pending');
    expect(_getStatus('B')).toBe('saving');

    resolveNext({ kind: 'success', versionToken: 'va' }); // A
    await vi.runAllTimersAsync();
    // A re-fired (queue-next-save); B still on its first save.
    expect(callCount()).toBe(3);
    resolveNext({ kind: 'success', versionToken: 'vb' }); // B
    await vi.runAllTimersAsync();
    resolveNext({ kind: 'success', versionToken: 'va2' }); // A's queued save
    await vi.runAllTimersAsync();
  });
});

// ─── flushNow ──────────────────────────────────────────────────────────

describe('flushNow', () => {
  it('cancels the debounce and saves immediately', async () => {
    const { adapter, callCount, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty('A');
    expect(callCount()).toBe(0);
    const promise = flushNow('A');
    // microtask kicks adapter.save synchronously
    await Promise.resolve();
    expect(callCount()).toBe(1);
    resolveNext({ kind: 'success', versionToken: 'v1' });
    await promise;
  });

  it('returns the SaveOutcome on completion', async () => {
    const { adapter, resolveNext } = makeAdapter();
    setAdapter(adapter);

    const promise = flushNow('A');
    await Promise.resolve();
    resolveNext({ kind: 'success', versionToken: 'v1' });
    const outcome = await promise;
    expect(outcome).toEqual({ kind: 'success', versionToken: 'v1' });
  });

  it('flushNow during an in-flight save sets pending and returns null', async () => {
    const { adapter, callCount, resolveNext } = makeAdapter();
    setAdapter(adapter);

    notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000);
    expect(_getStatus('A')).toBe('saving');

    const result = await flushNow('A');
    expect(result).toBeNull();
    expect(_getStatus('A')).toBe('saving-pending');
    expect(callCount()).toBe(1); // still one

    resolveNext({ kind: 'success', versionToken: 'v1' });
    await vi.runAllTimersAsync();
    expect(callCount()).toBe(2); // queued save fired
    resolveNext({ kind: 'success', versionToken: 'v2' });
    await vi.runAllTimersAsync();
  });
});

// ─── Adapter wiring ────────────────────────────────────────────────────

describe('adapter wiring', () => {
  it('with no adapter installed, debounced save is a no-op (status returns to idle)', async () => {
    notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000);
    expect(_getStatus('A')).toBe('idle');
  });

  it('flushNow with no adapter is a no-op returning null', async () => {
    const result = await flushNow('A');
    expect(result).toBeNull();
  });
});
