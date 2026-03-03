import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolName } from '@shared/types/viewer';
import { useViewerStore } from '../../stores/viewerStore';
import AnnotationToolDropdown from './AnnotationToolDropdown';

function resetViewerStore(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
}

describe('AnnotationToolDropdown', () => {
  beforeEach(() => {
    resetViewerStore();
  });

  it('opens and selects an annotation tool', async () => {
    const user = userEvent.setup();
    const setActiveTool = vi.fn();
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeTool: ToolName.WindowLevel,
      setActiveTool,
    });

    render(<AnnotationToolDropdown />);
    await user.click(screen.getByRole('button', { name: /Measure/i }));
    await user.click(screen.getByRole('button', { name: 'Angle' }));

    expect(setActiveTool).toHaveBeenCalledWith(ToolName.Angle);
    expect(screen.queryByRole('button', { name: 'Bidirectional' })).not.toBeInTheDocument();
  });

  it('shows active-tool title and closes on outside click', async () => {
    const user = userEvent.setup();
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeTool: ToolName.Length,
    });

    render(<AnnotationToolDropdown />);
    expect(screen.getByTitle('Measure: Length')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Measure/i }));
    expect(screen.getByRole('button', { name: 'Rectangle ROI' })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: 'Rectangle ROI' })).not.toBeInTheDocument();
  });
});
