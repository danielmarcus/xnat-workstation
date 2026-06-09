import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaveQueue, type SaveOutcome } from '../segmentationService/saveQueue';

/**
 * Slice 5 — queue-next-save + silent debounced autosave (A9 / E2 / signal 14).
 *
 * Verified at the service layer behind an IN-MEMORY save double (the real per-
 * container XNAT transport is the deferred transport workstream). Drives the real
 * state machine — debounce, gesture-guard, single-flight, queue-next-save, transient
 * retry — with fake timers + controllable save promises. No setter shortcuts.
 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const OK: SaveOutcome = { ok: true };

describe('saveQueue (Slice 5: queue-next-save + debounced autosave, A9/E2/signal 14)', () => {
  let phases: Array<{ id: string; phase: string; error?: string }>;
  let saveCalls: string[];
  let gesture: boolean;
  let autoSaveEnabled: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    phases = [];
    saveCalls = [];
    gesture = false;
    autoSaveEnabled = true;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeQueue(saveImpl: (id: string) => Promise<SaveOutcome>) {
    return createSaveQueue({
      saveContainer: (id) => {
        saveCalls.push(id);
        return saveImpl(id);
      },
      isGestureActive: () => gesture,
      debounceMs: () => 3000,
      isAutoSaveEnabled: () => autoSaveEnabled,
      onPhase: (id, phase, error) => phases.push({ id, phase, error }),
    });
  }

  it('debounces rapid edits into a single save after the debounce period', async () => {
    const q = makeQueue(async () => OK);
    q.notifyDirty('A');
    vi.advanceTimersByTime(1000);
    q.notifyDirty('A');
    vi.advanceTimersByTime(1000);
    q.notifyDirty('A');
    expect(saveCalls).toEqual([]); // not yet — debounce keeps resetting
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveCalls).toEqual(['A']); // exactly one save
  });

  it('never fires mid-gesture; saves once the gesture ends', async () => {
    const q = makeQueue(async () => OK);
    gesture = true;
    q.notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveCalls).toEqual([]); // gesture held — no save
    gesture = false;
    await vi.advanceTimersByTimeAsync(3000); // it rescheduled itself
    expect(saveCalls).toEqual(['A']);
  });

  it('queue-next-save: edits during an in-flight save trigger one follow-up save, one continuous "saving" state (signal 14)', async () => {
    const d1 = deferred<SaveOutcome>();
    const d2 = deferred<SaveOutcome>();
    const saves = [d1, d2];
    let i = 0;
    const q = makeQueue(() => saves[i++].promise);

    q.notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveCalls).toEqual(['A']); // first save in flight
    expect(phases[phases.length - 1]).toMatchObject({ id: 'A', phase: 'saving' });

    // edits arrive WHILE the first save is in flight
    q.notifyDirty('A');
    expect(saveCalls).toEqual(['A']); // NO second concurrent save

    d1.resolve(OK); // first save completes
    await Promise.resolve();
    await Promise.resolve();
    expect(saveCalls).toEqual(['A', 'A']); // follow-up save fired automatically

    // the user saw a continuous "saving" state — no 'idle' between the two saves
    const idleBeforeEnd = phases.slice(0, -1).some((p) => p.phase === 'idle');
    expect(idleBeforeEnd).toBe(false);

    d2.resolve(OK);
    await Promise.resolve();
    await Promise.resolve();
    expect(phases[phases.length - 1]).toMatchObject({ id: 'A', phase: 'idle' }); // finally settles
  });

  it('does not start a second concurrent save for the same container', async () => {
    const d1 = deferred<SaveOutcome>();
    const q = makeQueue(() => d1.promise);
    q.notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000);
    q.flush('A'); // manual save during in-flight
    q.notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveCalls).toEqual(['A']); // still only one save running
    d1.resolve(OK);
    await Promise.resolve();
    await Promise.resolve();
    expect(saveCalls.length).toBeGreaterThanOrEqual(2); // queued work flushed after
  });

  it('transient failure keeps the container dirty, surfaces error, and resumes the debounce', async () => {
    let attempt = 0;
    const q = makeQueue(async () => {
      attempt++;
      return attempt === 1 ? ({ ok: false, kind: 'transient', error: 'network' } as SaveOutcome) : OK;
    });
    q.notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000);
    expect(phases.some((p) => p.phase === 'error')).toBe(true); // surfaced
    await vi.advanceTimersByTimeAsync(3000); // debounce resumed → retry
    expect(saveCalls).toEqual(['A', 'A']);
    expect(phases[phases.length - 1]).toMatchObject({ phase: 'idle' }); // recovered
  });

  it('manual flush serializes immediately, bypassing the debounce wait', async () => {
    const q = makeQueue(async () => OK);
    q.notifyDirty('A');
    await q.flush('A'); // no timer advance
    expect(saveCalls).toEqual(['A']);
  });

  it('manual flush still saves even when autosave is disabled', async () => {
    autoSaveEnabled = false;
    const q = makeQueue(async () => OK);
    q.notifyDirty('A');
    await vi.advanceTimersByTimeAsync(10000);
    expect(saveCalls).toEqual([]); // autosave off — no debounced save
    await q.flush('A');
    expect(saveCalls).toEqual(['A']); // manual still works
  });

  it('is per-container: a dirty A does not save B, and A in-flight does not block B', async () => {
    const dA = deferred<SaveOutcome>();
    const q = makeQueue((id) => (id === 'A' ? dA.promise : Promise.resolve(OK)));
    q.notifyDirty('A');
    await vi.advanceTimersByTimeAsync(3000); // A saving (in flight)
    q.notifyDirty('B');
    await vi.advanceTimersByTimeAsync(3000); // B saves while A is still in flight
    expect(saveCalls).toEqual(['A', 'B']);
    dA.resolve(OK);
  });
});
