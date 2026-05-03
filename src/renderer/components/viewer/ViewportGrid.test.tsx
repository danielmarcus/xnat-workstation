import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolName } from '@shared/types/viewer';
import ViewportGrid from './ViewportGrid';
import { useViewerStore } from '../../stores/viewerStore';

// ViewportGrid renders panels through `Viewport`, which routes between
// stack-mode (StackViewport) and volume-mode (VolumeViewport)
// internally. The test stubs `Viewport` directly so it can observe the
// orientation prop that ViewportGrid passes down.
vi.mock('./Viewport', () => ({
  default: ({ panelId, orientation }: { panelId: string; orientation?: string }) => (
    <div data-testid={`viewport-${panelId}`}>VP {panelId}{orientation ? `:${orientation}` : ''}</div>
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

  it('passes orientation prop to Viewport when the panel orientation is non-STACK', () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      layoutConfig: { rows: 1, cols: 1, panelCount: 1 },
      activeViewportId: 'panel_0',
      panelOrientationMap: { panel_0: 'AXIAL' },
    });

    render(<ViewportGrid panelImageIds={{ panel_0: ['img-1', 'img-2'] }} />);
    expect(screen.getByTestId('viewport-panel_0')).toHaveTextContent('AXIAL');
    expect(screen.getByTestId('overlay-panel_0')).toBeInTheDocument();
    expect(screen.getByTestId('slider-panel_0')).toBeInTheDocument();
  });

  it('omits the orientation prop for STACK panels and updates active viewport on click', () => {
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

    // panel_0 (no orientation set, defaults to STACK) renders without the
    // orientation suffix; panel_1 (SAGITTAL) renders with it.
    expect(screen.getByTestId('viewport-panel_0')).toHaveTextContent(/^VP panel_0$/);
    expect(screen.getByTestId('viewport-panel_1')).toHaveTextContent('SAGITTAL');
    expect(container.firstChild).toHaveClass('crosshair-mode');
    expect(container.querySelector('[data-panel-id="panel_0"]')).not.toHaveClass('cursor-pointer');
    expect(container.querySelector('[data-panel-id="panel_1"]')).not.toHaveClass('cursor-pointer');

    fireEvent.click(container.querySelector('[data-panel-id="panel_1"]') as HTMLElement);
    expect(setActiveViewport).toHaveBeenCalledWith('panel_1');
  });
});
