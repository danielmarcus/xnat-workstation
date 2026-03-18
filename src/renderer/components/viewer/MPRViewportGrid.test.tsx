import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToolName } from '@shared/types/viewer';
import MPRViewportGrid from './MPRViewportGrid';
import { useViewerStore } from '../../stores/viewerStore';

const mprGridMocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
}));

vi.mock('../../lib/cornerstone/mprService', () => ({
  mprService: {
    scrollToIndex: mprGridMocks.scrollToIndex,
  },
}));

vi.mock('./MPRViewport', () => ({
  default: ({ panelId }: { panelId: string }) => <div data-testid={`mpr-viewport-${panelId}`} />,
}));

vi.mock('./CornerstoneViewport', () => ({
  default: ({ panelId }: { panelId: string }) => <div data-testid={`stack-viewport-${panelId}`} />,
}));

vi.mock('./ViewportOverlay', () => ({
  default: ({ panelId }: { panelId: string }) => <div data-testid={`overlay-${panelId}`} />,
}));

vi.mock('./ScrollSlider', () => ({
  default: ({ panelId }: { panelId: string }) => <div data-testid={`scroll-slider-${panelId}`} />,
}));

function resetViewerStore(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
}

describe('MPRViewportGrid', () => {
  beforeEach(() => {
    resetViewerStore();
    vi.clearAllMocks();

    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      value: () =>
        ({
          left: 0,
          top: 0,
          width: 10,
          height: 100,
          right: 10,
          bottom: 100,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
      configurable: true,
    });
  });

  it('renders MPR and stack panels with loading overlay and crosshair class', () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeTool: ToolName.Crosshairs,
      mprVolumeProgress: { loaded: 12, total: 24, percent: 50 },
    });

    const { container } = render(<MPRViewportGrid volumeId="vol-1" sourceImageIds={['img-1', 'img-2']} />);

    expect(container.querySelector('.crosshair-mode')).toBeInTheDocument();
    expect(screen.getByText('Creating Volume')).toBeInTheDocument();
    expect(screen.getByText('12 / 24 slices (50%)')).toBeInTheDocument();

    expect(screen.getByTestId('mpr-viewport-mpr_panel_0')).toBeInTheDocument();
    expect(screen.getByTestId('mpr-viewport-mpr_panel_1')).toBeInTheDocument();
    expect(screen.getByTestId('mpr-viewport-mpr_panel_2')).toBeInTheDocument();
    expect(screen.getByTestId('stack-viewport-mpr_stack')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-mpr_stack')).toBeInTheDocument();
    expect(screen.getByTestId('scroll-slider-mpr_stack')).toBeInTheDocument();
    expect(container.querySelector('[data-panel-id="mpr_panel_0"]')).not.toHaveClass('cursor-pointer');
    expect(container.querySelector('[data-panel-id="mpr_stack"]')).not.toHaveClass('cursor-pointer');
  });

  it('updates active viewport id on panel clicks', () => {
    const { container } = render(<MPRViewportGrid volumeId="vol-1" sourceImageIds={['img-1']} />);
    const target = container.querySelector('[data-panel-id="mpr_panel_1"]');
    expect(target).toBeTruthy();

    fireEvent.click(target!);
    expect(useViewerStore.getState().activeViewportId).toBe('mpr_panel_1');
  });

  it('shows stack fallback when no source images are available and hides loader at 100%', () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      mprVolumeProgress: { loaded: 10, total: 10, percent: 100 },
    });

    render(<MPRViewportGrid volumeId="vol-1" sourceImageIds={[]} />);

    expect(screen.getByText('Stack View')).toBeInTheDocument();
    expect(screen.getByText('No images loaded')).toBeInTheDocument();
    expect(screen.queryByText('Creating Volume')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stack-viewport-mpr_stack')).not.toBeInTheDocument();
  });

  it('scrolls MPR slice index from slider pointer interactions', () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      mprViewports: {
        mpr_panel_0: {
          orientation: 'AXIAL',
          sliceIndex: 4,
          totalSlices: 10,
        } as any,
      },
    });

    render(<MPRViewportGrid volumeId="vol-1" sourceImageIds={['img-1']} />);

    const track = screen.getByTestId('mpr-scroll-track-mpr_panel_0');
    fireEvent.mouseEnter(track.parentElement!);
    expect(screen.getByTestId('mpr-scroll-value-mpr_panel_0')).toHaveTextContent('5/10');
    fireEvent.pointerDown(track, { pointerId: 1, clientY: 50 });
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 70 });
    fireEvent.pointerUp(track, { pointerId: 1, clientY: 70 });

    expect(mprGridMocks.scrollToIndex).toHaveBeenCalled();
    expect(mprGridMocks.scrollToIndex).toHaveBeenCalledWith('mpr_panel_0', expect.any(Number));
  });
});
