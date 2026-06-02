/**
 * ErrorBoundary tests (MV-Phase 7.1, spec §13.1).
 *
 * Covers: app-variant recovery screen, viewport-variant in-cell recovery,
 * crash-snapshot capture on catch, and reset-remounts-children semantics.
 */
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureCrashSnapshot = vi.fn().mockResolvedValue('snap-id');
vi.mock('../lib/diagnostics/crashSnapshotService', () => ({
  captureCrashSnapshot: (...args: unknown[]) => captureCrashSnapshot(...args),
}));

import ErrorBoundary from './ErrorBoundary';

/** Throws on render until `recovered` flips true via the prop. */
function Bomb({ defused = false }: { defused?: boolean }) {
  if (!defused) throw new Error('kaboom');
  return <div data-testid="bomb-defused">ok</div>;
}

/**
 * Mounts a Bomb whose defused state lives OUTSIDE the boundary, so a
 * boundary reset re-renders the (now-defused) child successfully.
 */
function Harness({ variant, label }: { variant: 'app' | 'viewport'; label?: string }) {
  const [defused, setDefused] = useState(false);
  return (
    <>
      <button data-testid="defuse" onClick={() => setDefused(true)}>defuse</button>
      <ErrorBoundary variant={variant} label={label}>
        <Bomb defused={defused} />
      </ErrorBoundary>
    </>
  );
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    captureCrashSnapshot.mockClear();
    // React logs caught render errors to console.error — silence for clean output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('viewport variant', () => {
    it('renders children when nothing throws', () => {
      render(
        <ErrorBoundary variant="viewport" label="panel_0">
          <div data-testid="child">content</div>
        </ErrorBoundary>,
      );
      expect(screen.getByTestId('child')).toBeTruthy();
    });

    it('shows the in-cell recovery UI when a child throws', () => {
      render(<Harness variant="viewport" label="panel_0" />);
      expect(screen.getByTestId('viewport-error-boundary')).toBeTruthy();
      expect(screen.getByText('Render error')).toBeTruthy();
      expect(screen.getByText('kaboom')).toBeTruthy();
    });

    it('captures a crash snapshot identifying the viewport', () => {
      render(<Harness variant="viewport" label="panel_2" />);
      expect(captureCrashSnapshot).toHaveBeenCalledWith(
        'error-boundary',
        expect.objectContaining({ message: 'kaboom' }),
        expect.objectContaining({ boundary: 'panel_2' }),
      );
    });

    it('"Reload viewport" resets the boundary and remounts children', () => {
      render(<Harness variant="viewport" label="panel_0" />);
      expect(screen.getByTestId('viewport-error-boundary')).toBeTruthy();

      // Defuse the bomb (state outside the boundary), then reset.
      fireEvent.click(screen.getByTestId('defuse'));
      fireEvent.click(screen.getByText('Reload viewport'));

      expect(screen.queryByTestId('viewport-error-boundary')).toBeNull();
      expect(screen.getByTestId('bomb-defused')).toBeTruthy();
    });
  });

  describe('app variant', () => {
    it('shows the full recovery screen when a child throws', () => {
      render(<Harness variant="app" />);
      expect(screen.getByTestId('app-error-boundary')).toBeTruthy();
      expect(screen.getByText('Something went wrong')).toBeTruthy();
      expect(screen.getByText('kaboom')).toBeTruthy();
      expect(screen.getByText('Reload renderer')).toBeTruthy();
      expect(screen.getByText('Copy error report')).toBeTruthy();
    });

    it('captures a crash snapshot with the app boundary label', () => {
      render(<Harness variant="app" />);
      expect(captureCrashSnapshot).toHaveBeenCalledWith(
        'error-boundary',
        expect.objectContaining({ message: 'kaboom' }),
        expect.objectContaining({ boundary: 'app' }),
      );
    });

    it('"Reload renderer" calls window.location.reload', () => {
      const reload = vi.fn();
      const original = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...original, reload },
      });
      try {
        render(<Harness variant="app" />);
        fireEvent.click(screen.getByText('Reload renderer'));
        expect(reload).toHaveBeenCalled();
      } finally {
        Object.defineProperty(window, 'location', { configurable: true, value: original });
      }
    });
  });
});
