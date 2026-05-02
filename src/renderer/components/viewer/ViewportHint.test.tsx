/**
 * Component tests for ViewportHint (Phase 2.5b).
 *
 * Use `queryByTestId` + null/non-null assertions to sidestep the
 * pre-existing `toBeInTheDocument` matcher TS issue in this repo.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewportHint } from './ViewportHint';
import { useViewportHintStore } from '../../stores/viewportHintStore';

beforeEach(() => {
  useViewportHintStore.getState().clearAll();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setHint(viewportId: string, message: string, ttlMs?: number): void {
  // Wrap in act() so React flushes the Zustand-driven re-render before the
  // assertion runs.
  act(() => {
    useViewportHintStore.getState().setHint(viewportId, message, ttlMs);
  });
}

describe('ViewportHint', () => {
  it('renders nothing when no hint exists for the viewport', () => {
    const { container } = render(<ViewportHint viewportId="vp1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the hint message when one is set for the viewport', () => {
    render(<ViewportHint viewportId="vp1" />);
    setHint('vp1', 'Drawing blocked — switch series');
    expect(screen.queryByTestId('viewport-hint:vp1')?.textContent).toBe(
      'Drawing blocked — switch series',
    );
  });

  it('updates when the hint changes for the same viewport', () => {
    render(<ViewportHint viewportId="vp1" />);
    setHint('vp1', 'First');
    expect(screen.queryByTestId('viewport-hint:vp1')?.textContent).toBe('First');

    setHint('vp1', 'Second');
    expect(screen.queryByTestId('viewport-hint:vp1')?.textContent).toBe('Second');
  });

  it('disappears after the TTL expires', () => {
    render(<ViewportHint viewportId="vp1" />);
    setHint('vp1', 'Hint', 1000);
    expect(screen.queryByTestId('viewport-hint:vp1')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('viewport-hint:vp1')).toBeNull();
  });

  it('does not render hints destined for a different viewport', () => {
    render(<ViewportHint viewportId="vp1" />);
    setHint('vp2', 'Other panel');
    expect(screen.queryByTestId('viewport-hint:vp1')).toBeNull();
    expect(screen.queryByTestId('viewport-hint:vp2')).toBeNull(); // not mounted for vp2
  });

  it('has accessibility attributes for assistive tech (role=status, polite live region)', () => {
    render(<ViewportHint viewportId="vp1" />);
    setHint('vp1', 'Hint');
    const el = screen.queryByTestId('viewport-hint:vp1');
    expect(el?.getAttribute('role')).toBe('status');
    expect(el?.getAttribute('aria-live')).toBe('polite');
  });

  it('is pointer-events: none so it cannot intercept the next gesture', () => {
    render(<ViewportHint viewportId="vp1" />);
    setHint('vp1', 'Hint');
    const el = screen.queryByTestId('viewport-hint:vp1');
    expect(el?.className).toContain('pointer-events-none');
  });
});
