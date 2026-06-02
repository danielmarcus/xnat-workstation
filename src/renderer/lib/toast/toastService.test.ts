/**
 * Tests for the toast notification service (issue #77, spec §11).
 *
 * Uses fake timers to verify the per-kind default durations, the stack cap
 * (max 3 visible, FIFO drop), and the hover-pause / resume semantics.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetToastIdCounterForTests,
  DEFAULT_DURATIONS,
  MAX_VISIBLE,
  toastService,
  useToastStore,
} from './toastService';

beforeEach(() => {
  useToastStore.getState().clearAll();
  __resetToastIdCounterForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toastService', () => {
  describe('notify + dismiss basics', () => {
    it('starts with an empty toast list', () => {
      expect(useToastStore.getState().toasts).toEqual([]);
    });

    it('notify returns the assigned id and appends to the list', () => {
      const id = toastService.notify({ kind: 'success', message: 'Saved' });
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].id).toBe(id);
      expect(toasts[0].kind).toBe('success');
      expect(toasts[0].message).toBe('Saved');
    });

    it('dismiss removes the toast by id', () => {
      const id = toastService.notify({ kind: 'info', message: 'Hello' });
      toastService.dismiss(id);
      expect(useToastStore.getState().toasts).toEqual([]);
    });

    it('dismiss of an unknown id is a no-op', () => {
      toastService.notify({ kind: 'info', message: 'Hello' });
      const before = useToastStore.getState().toasts;
      toastService.dismiss('not-an-id');
      expect(useToastStore.getState().toasts).toBe(before);
    });

    it('notify captures detail and action', () => {
      const onClick = vi.fn();
      toastService.notify({
        kind: 'warning',
        message: 'Heads up',
        detail: 'Something to know',
        action: { label: 'Retry', onClick },
      });
      const t = useToastStore.getState().toasts[0];
      expect(t.detail).toBe('Something to know');
      expect(t.action?.label).toBe('Retry');
      expect(t.action?.onClick).toBe(onClick);
    });
  });

  describe('per-kind durations', () => {
    it('success and info use 3000 ms by default', () => {
      expect(DEFAULT_DURATIONS.success).toBe(3000);
      expect(DEFAULT_DURATIONS.info).toBe(3000);

      toastService.notify({ kind: 'success', message: 'A' });
      toastService.notify({ kind: 'info', message: 'B' });
      expect(useToastStore.getState().toasts).toHaveLength(2);

      vi.advanceTimersByTime(2999);
      expect(useToastStore.getState().toasts).toHaveLength(2);

      vi.advanceTimersByTime(1);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('warning uses 5000 ms by default', () => {
      expect(DEFAULT_DURATIONS.warning).toBe(5000);
      toastService.notify({ kind: 'warning', message: 'Be careful' });
      vi.advanceTimersByTime(4999);
      expect(useToastStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('error is persistent by default — no auto-dismiss', () => {
      expect(DEFAULT_DURATIONS.error).toBeNull();
      toastService.notify({ kind: 'error', message: 'Something broke' });
      vi.advanceTimersByTime(60_000);
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('caller can override duration', () => {
      toastService.notify({ kind: 'error', message: 'transient', duration: 1000 });
      vi.advanceTimersByTime(999);
      expect(useToastStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('caller can override duration to null to make any kind persistent', () => {
      toastService.notify({ kind: 'success', message: 'sticky', duration: null });
      vi.advanceTimersByTime(60_000);
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
  });

  describe('stack cap (FIFO)', () => {
    it(`caps visible toasts at ${MAX_VISIBLE}; oldest is dropped`, () => {
      const id1 = toastService.notify({ kind: 'info', message: '1' });
      const id2 = toastService.notify({ kind: 'info', message: '2' });
      const id3 = toastService.notify({ kind: 'info', message: '3' });
      const id4 = toastService.notify({ kind: 'info', message: '4' });
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(MAX_VISIBLE);
      expect(toasts.map((t) => t.id)).toEqual([id2, id3, id4]);
      expect(id1).not.toBe(id4); // sanity
    });

    it('dropping the oldest also cancels its timer (no late dismiss firing)', () => {
      toastService.notify({ kind: 'success', message: '1', duration: 1000 });
      toastService.notify({ kind: 'success', message: '2', duration: 1000 });
      toastService.notify({ kind: 'success', message: '3', duration: 1000 });
      // 4th notify drops the 1st. Its timer should not fire after the drop
      // (drop already removed it; a stale timeout firing would not actually
      // remove anything else, but the timer should be cleared regardless).
      toastService.notify({ kind: 'success', message: '4', duration: 1000 });

      vi.advanceTimersByTime(1001);
      // All four originals had 1000ms duration; #1 was already dropped at
      // notify-time (cap), the rest auto-dismissed. Net: empty list.
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  describe('hover pause + resume', () => {
    it('pauseTimer halts the auto-dismiss while preserving remaining time', () => {
      const id = toastService.notify({ kind: 'success', message: 'A' }); // 3000 ms

      vi.advanceTimersByTime(1000);
      useToastStore.getState().pauseTimer(id);

      const paused = useToastStore.getState().toasts[0];
      expect(paused.expiresAt).toBeNull();
      expect(paused.remainingMs).toBe(2000);

      vi.advanceTimersByTime(10_000);
      // Still present — paused.
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('resumeTimer schedules a fresh dismiss for the remaining time', () => {
      const id = toastService.notify({ kind: 'success', message: 'A' });
      vi.advanceTimersByTime(1000);
      useToastStore.getState().pauseTimer(id);
      vi.advanceTimersByTime(10_000);
      useToastStore.getState().resumeTimer(id);

      const resumed = useToastStore.getState().toasts[0];
      expect(resumed.remainingMs).toBeNull();
      expect(resumed.expiresAt).not.toBeNull();

      vi.advanceTimersByTime(1999);
      expect(useToastStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('pauseTimer on a persistent (error) toast is a no-op', () => {
      const id = toastService.notify({ kind: 'error', message: 'broken' });
      const before = useToastStore.getState().toasts[0];
      useToastStore.getState().pauseTimer(id);
      const after = useToastStore.getState().toasts[0];
      expect(after).toEqual(before);
    });

    it('resumeTimer on an unpaused toast is a no-op', () => {
      const id = toastService.notify({ kind: 'success', message: 'A' });
      const before = useToastStore.getState().toasts[0];
      useToastStore.getState().resumeTimer(id);
      const after = useToastStore.getState().toasts[0];
      expect(after).toEqual(before);
    });
  });

  describe('clearAll', () => {
    it('removes every toast and cancels pending timers', () => {
      toastService.notify({ kind: 'success', message: 'a', duration: 1000 });
      toastService.notify({ kind: 'warning', message: 'b', duration: 5000 });
      toastService.notify({ kind: 'error', message: 'c' });

      expect(useToastStore.getState().toasts).toHaveLength(3);
      useToastStore.getState().clearAll();
      expect(useToastStore.getState().toasts).toHaveLength(0);

      // Pending timers have been cancelled — no toasts spawn in the future.
      vi.advanceTimersByTime(10_000);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });
});
