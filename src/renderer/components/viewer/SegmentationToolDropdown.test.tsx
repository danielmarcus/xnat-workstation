import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolName } from '@shared/types/viewer';
import SegmentationToolDropdown from './SegmentationToolDropdown';
import { useViewerStore } from '../../stores/viewerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';

const segmentationServiceMock = vi.hoisted(() => ({
  getPreferredDicomType: vi.fn(() => null),
}));

vi.mock('../../lib/cornerstone/segmentationService', () => ({
  segmentationService: segmentationServiceMock,
}));

function resetStores(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
}

describe('SegmentationToolDropdown', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  it('opens and selects an enabled segmentation tool', async () => {
    const user = userEvent.setup();
    const setActiveTool = vi.fn();
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeTool: ToolName.WindowLevel,
      setActiveTool,
    });
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegmentationId: 'seg-1',
      dicomTypeBySegmentationId: { 'seg-1': 'SEG' },
    });

    render(<SegmentationToolDropdown />);
    await user.click(screen.getByRole('button', { name: /Annotate/i }));
    await user.click(screen.getByRole('button', { name: 'Brush' }));

    expect(setActiveTool).toHaveBeenCalledWith(ToolName.Brush);
    expect(screen.queryByRole('button', { name: 'Eraser' })).not.toBeInTheDocument();
  });

  it('disables contour tools for SEG and labelmap tools for RTSTRUCT', async () => {
    const user = userEvent.setup();
    const setActiveTool = vi.fn();
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeTool: ToolName.WindowLevel,
      setActiveTool,
    });

    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegmentationId: 'seg-1',
      dicomTypeBySegmentationId: { 'seg-1': 'SEG' },
    });

    const { rerender } = render(<SegmentationToolDropdown />);
    await user.click(screen.getByRole('button', { name: /Annotate/i }));
    const freehandForSeg = screen.getByRole('button', { name: 'Freehand Contour' });
    expect(freehandForSeg).toBeDisabled();
    await user.click(freehandForSeg);
    expect(setActiveTool).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);

    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegmentationId: 'rt-1',
      dicomTypeBySegmentationId: { 'rt-1': 'RTSTRUCT' },
    });
    rerender(<SegmentationToolDropdown />);
    await user.click(screen.getByRole('button', { name: /Annotate/i }));
    const brushForRt = screen.getByRole('button', { name: 'Brush' });
    expect(brushForRt).toBeDisabled();
    await user.click(brushForRt);
    expect(setActiveTool).not.toHaveBeenCalled();
  });

  it('falls back to segmentationService preferred type when store map is missing', async () => {
    const user = userEvent.setup();
    segmentationServiceMock.getPreferredDicomType.mockReturnValue('RTSTRUCT');

    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeTool: ToolName.Brush,
      setActiveTool: vi.fn(),
    });
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      activeSegmentationId: 'seg-2',
      dicomTypeBySegmentationId: {},
    });

    render(<SegmentationToolDropdown />);
    await user.click(screen.getByRole('button', { name: /Annotate/i }));
    expect(screen.getByRole('button', { name: 'Brush' })).toBeDisabled();
    expect(segmentationServiceMock.getPreferredDicomType).toHaveBeenCalledWith('seg-2');
  });
});
