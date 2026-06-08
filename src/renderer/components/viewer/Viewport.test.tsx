import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Viewport from './Viewport';
import { useViewerStore } from '../../stores/viewerStore';

// Mock the Cornerstone-bound hook so the component renders in jsdom; the
// click-to-select wiring under test lives in Viewport itself, not the hook.
vi.mock('../../hooks/useViewport', () => ({
  useViewport: () => ({ containerRef: { current: null } }),
}));

describe('Viewport click-to-select', () => {
  beforeEach(() => {
    useViewerStore.setState(useViewerStore.getInitialState(), true);
    useViewerStore.setState({ ...useViewerStore.getState(), activeViewportId: 'panel_0' });
  });

  it('selects the panel as active on pointer-down (the regression: no wiring existed)', () => {
    render(<Viewport panelId="panel_1" imageIds={['i1']} scanId="s" />);
    const el = screen.getByTestId('unified-viewport:panel_1');
    expect(el).toHaveAttribute('data-active', 'false');

    fireEvent.pointerDown(el);

    expect(useViewerStore.getState().activeViewportId).toBe('panel_1');
    expect(el).toHaveAttribute('data-active', 'true');
  });

  it('reflects active state from the store', () => {
    useViewerStore.setState({ ...useViewerStore.getState(), activeViewportId: 'panel_2' });
    render(<Viewport panelId="panel_2" imageIds={['i1']} scanId="s" />);
    expect(screen.getByTestId('unified-viewport:panel_2')).toHaveAttribute('data-active', 'true');
  });
});
