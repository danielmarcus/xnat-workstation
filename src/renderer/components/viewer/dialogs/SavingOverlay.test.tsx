/**
 * SavingOverlay component tests — spec §4.4.5.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SavingOverlay from './SavingOverlay';

describe('SavingOverlay (spec §4.4.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render when open=false', () => {
    render(<SavingOverlay open={false} mode="single" currentName="x" />);
    expect(screen.queryByTestId('saving-overlay')).toBeNull();
  });

  describe('single mode', () => {
    it('renders the title with the current container name', () => {
      render(<SavingOverlay open mode="single" currentName="Tumor A" />);
      expect(screen.getByTestId('saving-overlay').dataset.mode).toBe('single');
      expect(screen.getByTestId('saving-overlay-single-title').textContent).toMatch(/Saving .Tumor A. to XNAT…/);
    });

    it('Cancel button is hidden initially and appears after the delay (default 2200 ms)', () => {
      const onCancel = vi.fn();
      render(<SavingOverlay open mode="single" currentName="X" onCancel={onCancel} />);
      expect(screen.queryByTestId('saving-overlay-cancel')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(2200);
      });
      expect(screen.queryByTestId('saving-overlay-cancel')).not.toBeNull();
    });

    it('omitting onCancel suppresses the Cancel button entirely', () => {
      render(<SavingOverlay open mode="single" currentName="X" cancelButtonAppearAt={10} />);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByTestId('saving-overlay-cancel')).toBeNull();
    });

    it('clicking Cancel fires onCancel', () => {
      const onCancel = vi.fn();
      render(<SavingOverlay open mode="single" currentName="X" onCancel={onCancel} cancelButtonAppearAt={10} />);
      act(() => {
        vi.advanceTimersByTime(20);
      });
      act(() => {
        fireEvent.click(screen.getByTestId('saving-overlay-cancel'));
      });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('batch mode', () => {
    it('renders "Saving N of M — \\"{name}\\"…" and a progress bar with the correct fill', () => {
      render(<SavingOverlay open mode="batch" currentName="Heart" current={2} total={5} />);
      expect(screen.getByTestId('saving-overlay').dataset.mode).toBe('batch');
      expect(screen.getByTestId('saving-overlay-batch-title').textContent).toMatch(/Saving 2 of 5 — .Heart.…/);
      const fill = screen.getByTestId('saving-overlay-progress-fill') as HTMLDivElement;
      expect(fill.style.width).toBe('40%');
    });

    it('aria-valuenow reflects the clamped current; valuemax = total', () => {
      render(<SavingOverlay open mode="batch" current={7} total={5} />);
      const bar = screen.getByRole('progressbar');
      expect(bar.getAttribute('aria-valuemax')).toBe('5');
      expect(bar.getAttribute('aria-valuenow')).toBe('5');
    });

    it('total=0 keeps width at 0%', () => {
      render(<SavingOverlay open mode="batch" current={0} total={0} />);
      const fill = screen.getByTestId('saving-overlay-progress-fill') as HTMLDivElement;
      expect(fill.style.width).toBe('0%');
    });
  });

  describe('batch-failed mode', () => {
    const failures = [
      { containerId: 'c1', containerName: 'Tumor A', errorMessage: 'HTTP 502' },
      { containerId: 'c2', containerName: 'Heart B' },
    ];

    it('lists every failure and shows a Retry button per row', () => {
      render(
        <SavingOverlay
          open
          mode="batch-failed"
          failures={failures}
          onRetry={() => {}}
        />,
      );
      expect(screen.getByTestId('saving-overlay-failed-title').textContent).toMatch(/2 saves failed/);
      expect(screen.queryByTestId('saving-overlay-failure-row:c1')).not.toBeNull();
      expect(screen.queryByTestId('saving-overlay-failure-row:c2')).not.toBeNull();
      expect(screen.queryByTestId('saving-overlay-retry:c1')).not.toBeNull();
      expect(screen.queryByTestId('saving-overlay-retry:c2')).not.toBeNull();
    });

    it('singular header when exactly one failure', () => {
      render(
        <SavingOverlay
          open
          mode="batch-failed"
          failures={[failures[0]]}
          onRetry={() => {}}
        />,
      );
      expect(screen.getByTestId('saving-overlay-failed-title').textContent).toMatch(/^1 save failed/);
    });

    it('per-row Retry calls onRetry with the failed container id', () => {
      const onRetry = vi.fn();
      render(
        <SavingOverlay
          open
          mode="batch-failed"
          failures={failures}
          onRetry={onRetry}
        />,
      );
      act(() => {
        fireEvent.click(screen.getByTestId('saving-overlay-retry:c2'));
      });
      expect(onRetry).toHaveBeenCalledWith('c2');
    });

    it('Retry all fires onRetryAll when provided; hidden when not provided or no failures', () => {
      const onRetryAll = vi.fn();
      const { rerender } = render(
        <SavingOverlay
          open
          mode="batch-failed"
          failures={failures}
          onRetryAll={onRetryAll}
        />,
      );
      expect(screen.queryByTestId('saving-overlay-retry-all')).not.toBeNull();
      act(() => {
        fireEvent.click(screen.getByTestId('saving-overlay-retry-all'));
      });
      expect(onRetryAll).toHaveBeenCalled();

      rerender(
        <SavingOverlay
          open
          mode="batch-failed"
          failures={[]}
          onRetryAll={onRetryAll}
        />,
      );
      expect(screen.queryByTestId('saving-overlay-retry-all')).toBeNull();
    });

    it('shows error-message text when provided on a failure row', () => {
      render(
        <SavingOverlay
          open
          mode="batch-failed"
          failures={failures}
          onRetry={() => {}}
        />,
      );
      expect(screen.getByTestId('saving-overlay-failure-row:c1').textContent).toMatch(/HTTP 502/);
    });
  });
});
