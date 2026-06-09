import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolate from Cornerstone — the scrubber switches time points via viewportService.
const setTimepoint = vi.fn();
vi.mock('../../lib/cornerstone/viewportService', () => ({
  viewportService: { setTimepoint: (id: string, t: number) => setTimepoint(id, t) },
}));

import ViewportTimeScrubber from './ViewportTimeScrubber';
import { useViewerStore } from '../../stores/viewerStore';

function setTimepointInfo(current: number, total: number): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useViewerStore.getState()._setPanelTimepointInfo('panel_0', current, total);
}

beforeEach(() => setTimepoint.mockClear());
afterEach(() => vi.clearAllMocks());

describe('ViewportTimeScrubber', () => {
  it('is hidden for a 3D series (total <= 1)', () => {
    setTimepointInfo(1, 1);
    render(<ViewportTimeScrubber panelId="panel_0" />);
    expect(screen.queryByTestId('time-scrubber:panel_0')).toBeNull();
  });

  it('shows the slider + label for a 4D series', () => {
    setTimepointInfo(1, 40);
    render(<ViewportTimeScrubber panelId="panel_0" />);
    expect(screen.getByTestId('time-scrubber:panel_0')).toBeInTheDocument();
    expect(screen.getByTestId('time-label:panel_0')).toHaveTextContent('1 / 40');
    expect(screen.getByTestId('time-slider:panel_0')).toHaveValue('1');
  });

  it('the slider sets the time point (store + service)', () => {
    setTimepointInfo(1, 40);
    render(<ViewportTimeScrubber panelId="panel_0" />);
    fireEvent.change(screen.getByTestId('time-slider:panel_0'), { target: { value: '17' } });
    expect(setTimepoint).toHaveBeenCalledWith('panel_0', 17);
    expect(useViewerStore.getState().panelTimepointMap['panel_0']).toBe(17);
    expect(screen.getByTestId('time-label:panel_0')).toHaveTextContent('17 / 40');
  });

  it('prev/next step the time point and clamp at the ends', () => {
    setTimepointInfo(1, 3);
    render(<ViewportTimeScrubber panelId="panel_0" />);
    // At t=1, prev is disabled; next → 2.
    expect(screen.getByTestId('time-prev:panel_0')).toBeDisabled();
    fireEvent.click(screen.getByTestId('time-next:panel_0'));
    expect(setTimepoint).toHaveBeenLastCalledWith('panel_0', 2);
    expect(useViewerStore.getState().panelTimepointMap['panel_0']).toBe(2);
  });
});
