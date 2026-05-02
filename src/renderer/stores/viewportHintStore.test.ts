/**
 * Tests for the per-viewport hint store (Phase 2.5b).
 *
 * Uses fake timers to verify the auto-clear TTL semantics. The
 * revision counter prevents the auto-clear of a stale hint from
 * clobbering a newer one set in the same viewport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HINT_TTL_MS,
  useViewportHintStore,
} from './viewportHintStore';

beforeEach(() => {
  useViewportHintStore.getState().clearAll();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('viewportHintStore', () => {
  it('starts with an empty hints map', () => {
    expect(useViewportHintStore.getState().hints.size).toBe(0);
  });

  it('setHint records a hint keyed by viewportId', () => {
    useViewportHintStore.getState().setHint('vp1', 'Drawing blocked');
    const hint = useViewportHintStore.getState().hints.get('vp1');
    expect(hint?.message).toBe('Drawing blocked');
    expect(hint?.revision).toBe(1);
  });

  it('expiresAt is now() + ttl', () => {
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));
    const before = Date.now();
    useViewportHintStore.getState().setHint('vp1', 'Hint');
    const hint = useViewportHintStore.getState().hints.get('vp1');
    expect(hint?.expiresAt).toBe(before + DEFAULT_HINT_TTL_MS);
  });

  it('respects a custom TTL', () => {
    vi.setSystemTime(new Date(2025, 0, 1));
    const before = Date.now();
    useViewportHintStore.getState().setHint('vp1', 'Hint', 5000);
    expect(useViewportHintStore.getState().hints.get('vp1')?.expiresAt).toBe(before + 5000);
  });

  it('auto-clears after the TTL expires', () => {
    useViewportHintStore.getState().setHint('vp1', 'Hint', 1000);
    expect(useViewportHintStore.getState().hints.has('vp1')).toBe(true);
    vi.advanceTimersByTime(999);
    expect(useViewportHintStore.getState().hints.has('vp1')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(useViewportHintStore.getState().hints.has('vp1')).toBe(false);
  });

  it('replacing a hint mid-TTL bumps the revision and resets the timer', () => {
    useViewportHintStore.getState().setHint('vp1', 'First', 1000);
    expect(useViewportHintStore.getState().hints.get('vp1')?.revision).toBe(1);

    vi.advanceTimersByTime(500);
    useViewportHintStore.getState().setHint('vp1', 'Second', 1000);
    expect(useViewportHintStore.getState().hints.get('vp1')?.message).toBe('Second');
    expect(useViewportHintStore.getState().hints.get('vp1')?.revision).toBe(2);

    // The first timer (expired at +1000) fires; the revision check
    // prevents it from clearing the new hint.
    vi.advanceTimersByTime(500);
    expect(useViewportHintStore.getState().hints.get('vp1')?.message).toBe('Second');

    // The second timer (expired at +500 + 1000 = 1500) fires next.
    vi.advanceTimersByTime(500);
    expect(useViewportHintStore.getState().hints.has('vp1')).toBe(false);
  });

  it('hints in different viewports are independent', () => {
    useViewportHintStore.getState().setHint('vp1', 'A', 1000);
    useViewportHintStore.getState().setHint('vp2', 'B', 2000);
    vi.advanceTimersByTime(1000);
    expect(useViewportHintStore.getState().hints.has('vp1')).toBe(false);
    expect(useViewportHintStore.getState().hints.get('vp2')?.message).toBe('B');
  });

  it('clearHint removes immediately', () => {
    useViewportHintStore.getState().setHint('vp1', 'Hint', 5000);
    useViewportHintStore.getState().clearHint('vp1');
    expect(useViewportHintStore.getState().hints.has('vp1')).toBe(false);
  });

  it('clearHint on absent viewport is a no-op (no error)', () => {
    expect(() => useViewportHintStore.getState().clearHint('vp-missing')).not.toThrow();
  });

  it('clearAll wipes every hint', () => {
    useViewportHintStore.getState().setHint('vp1', 'A');
    useViewportHintStore.getState().setHint('vp2', 'B');
    useViewportHintStore.getState().clearAll();
    expect(useViewportHintStore.getState().hints.size).toBe(0);
  });

  it('ignores empty viewportId or empty message', () => {
    useViewportHintStore.getState().setHint('', 'msg');
    useViewportHintStore.getState().setHint('vp1', '');
    expect(useViewportHintStore.getState().hints.size).toBe(0);
  });
});
