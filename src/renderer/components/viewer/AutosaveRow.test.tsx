/**
 * AutosaveRow component tests — spec §4.9.
 *
 * Drives the four states through `useSegmentationStore` directly and
 * supplies a deterministic `now()` clock for the "Backed up Ns ago"
 * label and the fade window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AutosaveRow, { formatAgo } from './AutosaveRow';
import { useSegmentationStore } from '../../stores/segmentationStore';

function setStatus(status: 'idle' | 'saving' | 'saved' | 'error', lastTime: number | null = null) {
  useSegmentationStore.setState({
    autoSaveStatus: status,
    lastAutoSaveTime: lastTime,
  } as Partial<ReturnType<typeof useSegmentationStore.getState>>);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setStatus('idle');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AutosaveRow (spec §4.9)', () => {
  it('idle → row is hidden (collapsed)', () => {
    setStatus('idle');
    render(<AutosaveRow />);
    expect(screen.queryByTestId('autosave-row')).toBeNull();
  });

  it('saving → renders the spinner + "Saving…" label with polite aria-live', () => {
    setStatus('saving');
    render(<AutosaveRow />);
    const row = screen.getByTestId('autosave-row');
    expect(row.dataset.state).toBe('saving');
    expect(row.textContent).toMatch(/Saving…/);
    expect(row.getAttribute('aria-live')).toBe('polite');
  });

  it('saved → ✓ "Backed up Ns ago" using the injected clock', () => {
    setStatus('saved', 1_000_000);
    render(<AutosaveRow now={() => 1_000_000 + 1500} savedDisplayMs={5000} />);
    const row = screen.getByTestId('autosave-row');
    expect(row.dataset.state).toBe('saved');
    expect(row.textContent).toMatch(/Backed up 1s ago/);
  });

  it('saved → row disappears once the age crosses savedDisplayMs', () => {
    setStatus('saved', 1_000_000);
    let nowVal = 1_000_000 + 100;
    const { rerender } = render(
      <AutosaveRow now={() => nowVal} savedDisplayMs={3000} />,
    );
    expect(screen.queryByTestId('autosave-row')).not.toBeNull();

    // Advance the clock past the fade window; force a re-render.
    nowVal = 1_000_000 + 3500;
    rerender(<AutosaveRow now={() => nowVal} savedDisplayMs={3000} />);
    expect(screen.queryByTestId('autosave-row')).toBeNull();
  });

  it('saved tick — the seconds-ago counter updates while shown', () => {
    setStatus('saved', 0);
    let nowVal = 1500;
    const { rerender } = render(
      <AutosaveRow now={() => nowVal} savedDisplayMs={10_000} />,
    );
    expect(screen.getByTestId('autosave-row').textContent).toMatch(/1s ago/);

    nowVal = 4500;
    // Internal interval fires every 1s; advance fake timers + force
    // a re-render to pick up the new `now()`.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rerender(<AutosaveRow now={() => nowVal} savedDisplayMs={10_000} />);
    expect(screen.getByTestId('autosave-row').textContent).toMatch(/4s ago/);
  });

  it('error → ⚠ + "Backup failed — retry" with assertive aria-live', () => {
    setStatus('error');
    render(<AutosaveRow />);
    const row = screen.getByTestId('autosave-row');
    expect(row.dataset.state).toBe('error');
    expect(row.textContent).toMatch(/Backup failed/);
    expect(row.getAttribute('aria-live')).toBe('assertive');
  });

  it('error → clicking retry fires onRetry', () => {
    const onRetry = vi.fn();
    setStatus('error');
    render(<AutosaveRow onRetry={onRetry} />);
    act(() => {
      fireEvent.click(screen.getByTestId('autosave-retry'));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('error → retry button is disabled when no onRetry handler provided', () => {
    setStatus('error');
    render(<AutosaveRow />);
    const retry = screen.getByTestId('autosave-retry') as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
  });

  it('transitions: idle → saving → saved → idle (status drives mount/unmount)', () => {
    const { rerender } = render(<AutosaveRow now={() => 5000} savedDisplayMs={10_000} />);
    expect(screen.queryByTestId('autosave-row')).toBeNull();

    act(() => setStatus('saving'));
    rerender(<AutosaveRow now={() => 5000} savedDisplayMs={10_000} />);
    expect(screen.getByTestId('autosave-row').dataset.state).toBe('saving');

    act(() => setStatus('saved', 5000));
    rerender(<AutosaveRow now={() => 5500} savedDisplayMs={10_000} />);
    expect(screen.getByTestId('autosave-row').dataset.state).toBe('saved');

    act(() => setStatus('idle'));
    rerender(<AutosaveRow now={() => 6000} savedDisplayMs={10_000} />);
    expect(screen.queryByTestId('autosave-row')).toBeNull();
  });

  it('error state does NOT fade — stays visible until status changes', () => {
    setStatus('error');
    const { rerender } = render(
      <AutosaveRow now={() => 100} savedDisplayMs={1000} />,
    );
    expect(screen.queryByTestId('autosave-row')).not.toBeNull();
    rerender(<AutosaveRow now={() => 999_999} savedDisplayMs={1000} />);
    expect(screen.queryByTestId('autosave-row')).not.toBeNull();
  });
});

describe('formatAgo', () => {
  it('seconds under a minute', () => {
    expect(formatAgo(0)).toBe('0s');
    expect(formatAgo(11)).toBe('0s');
    expect(formatAgo(1500)).toBe('1s');
    expect(formatAgo(59_999)).toBe('59s');
  });
  it('minutes under an hour', () => {
    expect(formatAgo(60_000)).toBe('1m');
    expect(formatAgo(59 * 60_000)).toBe('59m');
  });
  it('hours otherwise', () => {
    expect(formatAgo(60 * 60_000)).toBe('1h');
    expect(formatAgo(125 * 60_000)).toBe('2h');
  });
});
