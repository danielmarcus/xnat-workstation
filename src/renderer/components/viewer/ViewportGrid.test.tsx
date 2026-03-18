import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolName } from '@shared/types/viewer';
import ViewportGrid from './ViewportGrid';
import { useViewerStore } from '../../stores/viewerStore';

vi.mock('./CornerstoneViewport', () => ({
  default: ({ panelId }: { panelId: string }) => <div data-testid={`cs-${panelId}`}>CS {panelId}</div>,
}));

vi.mock('./OrientedViewport', () => ({
  default: ({ panelId, plane }: { panelId: string; plane: string }) => (
    <div data-testid={`oriented-${panelId}`}>Oriented {panelId}:{plane}</div>
  ),
}));

vi.mock('./ViewportOverlay', () => ({
  default: ({ panelId }: { panelId: string }) => <div data-testid={`overlay-${panelId}`} />,
}));

vi.mock('./ScrollSlider', () => ({
  default: ({ panelId }: { panelId: string }) => <div data-testid={`slider-${panelId}`} />,
}));

function resetViewerStore(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
}

describe('ViewportGrid', () => {
  beforeEach(() => {
    resetViewerStore();
  });

  it('renders placeholder panel with loading message when imageIds are missing', () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      layoutConfig: { rows: 1, cols: 1, panelCount: 1 },
      activeViewportId: 'panel_0',
      panelScanMap: { panel_0: '11' },
      sessionScans: [{ id: '11', seriesDescription: 'CTA Head' } as any],
    });

    render(<ViewportGrid panelImageIds={{}} />);
    expect(screen.getByText('Panel 1')).toBeInTheDocument();
    expect(screen.getByText('Loading #11 CTA Head')).toBeInTheDocument();
  });

  it('uses oriented viewport when orientation is non-stack and panel has multiple images', () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      layoutConfig: { rows: 1, cols: 1, panelCount: 1 },
      activeViewportId: 'panel_0',
      panelOrientationMap: { panel_0: 'AXIAL' },
    });

    render(<ViewportGrid panelImageIds={{ panel_0: ['img-1', 'img-2'] }} />);
    expect(screen.getByTestId('oriented-panel_0')).toHaveTextContent('AXIAL');
    expect(screen.queryByTestId('cs-panel_0')).not.toBeInTheDocument();
    expect(screen.getByTestId('overlay-panel_0')).toBeInTheDocument();
    expect(screen.getByTestId('slider-panel_0')).toBeInTheDocument();
  });

  it('uses cornerstone viewport for stack mode and updates active viewport on click', () => {
    const setActiveViewport = vi.fn();
    useViewerStore.setState({
      ...useViewerStore.getState(),
      layoutConfig: { rows: 1, cols: 2, panelCount: 2 },
      activeViewportId: 'panel_0',
      activeTool: ToolName.Crosshairs,
      setActiveViewport,
      panelOrientationMap: { panel_1: 'SAGITTAL' },
    });

    const { container } = render(
      <ViewportGrid panelImageIds={{ panel_0: ['img-1'], panel_1: ['img-2'] }} />,
    );

    expect(screen.getByTestId('cs-panel_0')).toBeInTheDocument();
    expect(screen.getByTestId('cs-panel_1')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('crosshair-mode');
    expect(container.querySelector('[data-panel-id="panel_0"]')).not.toHaveClass('cursor-pointer');
    expect(container.querySelector('[data-panel-id="panel_1"]')).not.toHaveClass('cursor-pointer');

    fireEvent.click(container.querySelector('[data-panel-id="panel_1"]') as HTMLElement);
    expect(setActiveViewport).toHaveBeenCalledWith('panel_1');
  });
});
