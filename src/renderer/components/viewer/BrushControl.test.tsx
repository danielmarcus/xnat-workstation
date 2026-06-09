import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolName } from '@shared/types/viewer';

// Isolate from Cornerstone — the store routes through unifiedToolService.
const setActiveTool = vi.fn();
const setBrushSize = vi.fn();
vi.mock('../../lib/cornerstone/unifiedToolService', () => ({
  unifiedToolService: { setActiveTool: (t: unknown) => setActiveTool(t), setBrushSize: (n: number) => setBrushSize(n) },
}));

import BrushControl from './BrushControl';
import { useViewerStore } from '../../stores/viewerStore';

beforeEach(() => {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  setActiveTool.mockClear();
  setBrushSize.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe('BrushControl', () => {
  it('shows the Brush button; the size slider appears only when the brush is active', () => {
    render(<BrushControl />);
    expect(screen.getByTestId('tool-brush')).toBeInTheDocument();
    // Not active yet ⇒ no slider.
    expect(screen.queryByTestId('brush-size-slider')).toBeNull();

    fireEvent.click(screen.getByTestId('tool-brush'));
    expect(useViewerStore.getState().activeTool).toBe(ToolName.Brush);
    expect(setActiveTool).toHaveBeenCalledWith(ToolName.Brush);
    // Now active ⇒ slider visible, showing the current size.
    expect(screen.getByTestId('brush-size-slider')).toBeInTheDocument();
    expect(screen.getByTestId('brush-size-value')).toHaveTextContent('10');
  });

  it('dragging the slider updates the brush size (store + service)', () => {
    useViewerStore.setState({ activeTool: ToolName.Brush });
    render(<BrushControl />);
    fireEvent.change(screen.getByTestId('brush-size-slider'), { target: { value: '28' } });
    expect(useViewerStore.getState().brushSize).toBe(28);
    expect(setBrushSize).toHaveBeenCalledWith(28);
    expect(screen.getByTestId('brush-size-value')).toHaveTextContent('28');
  });
});
