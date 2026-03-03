import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ScrollSlider from './ScrollSlider';
import { useViewerStore } from '../../stores/viewerStore';

const mocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  mprScrollToIndex: vi.fn(),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
}));

vi.mock('../../lib/cornerstone/viewportService', () => ({
  viewportService: {
    scrollToIndex: mocks.scrollToIndex,
  },
}));

vi.mock('../../lib/cornerstone/mprService', () => ({
  mprService: {
    scrollToIndex: mocks.mprScrollToIndex,
  },
}));

function resetStore(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
}

function seedPanelState(panelId: string): void {
  useViewerStore.setState({
    ...useViewerStore.getState(),
    panelOrientationMap: { [panelId]: 'STACK' },
    viewports: {
      [panelId]: {
        viewportId: panelId,
        imageIndex: 1,
        requestedImageIndex: null,
        totalImages: 10,
        windowWidth: 0,
        windowCenter: 0,
        zoomPercent: 100,
        rotation: 0,
        flipH: false,
        flipV: false,
        invert: false,
        imageWidth: 512,
        imageHeight: 512,
      },
    },
    mprViewports: {
      [panelId]: {
        sliceIndex: 0,
        totalSlices: 0,
        plane: 'AXIAL',
      },
    },
  });
}

describe('ScrollSlider', () => {
  const panelId = 'panel_0';

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: mocks.setPointerCapture,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: mocks.releasePointerCapture,
    });
  });

  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  function dispatchPointer(
    target: Element,
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    clientY: number,
    pointerId: number,
  ): void {
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
      clientY: number;
      pointerId: number;
    };
    event.clientY = clientY;
    event.pointerId = pointerId;
    target.dispatchEvent(event);
  }

  it('does not render for single-slice stacks', () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      panelOrientationMap: { [panelId]: 'STACK' },
      viewports: {
        [panelId]: {
          viewportId: panelId,
          imageIndex: 0,
          requestedImageIndex: null,
          totalImages: 1,
          windowWidth: 0,
          windowCenter: 0,
          zoomPercent: 100,
          rotation: 0,
          flipH: false,
          flipV: false,
          invert: false,
          imageWidth: 0,
          imageHeight: 0,
        },
      },
    });

    render(<ScrollSlider panelId={panelId} />);
    expect(screen.queryByTestId(`scroll-slider:${panelId}`)).not.toBeInTheDocument();
  });

  it('shows requested index in the hover indicator and dispatches stack scroll requests', () => {
    const requestImageIndex = vi.fn();
    seedPanelState(panelId);
    useViewerStore.setState({
      ...useViewerStore.getState(),
      viewports: {
        ...useViewerStore.getState().viewports,
        [panelId]: {
          ...useViewerStore.getState().viewports[panelId],
          requestedImageIndex: 4,
        },
      },
      _requestImageIndex: requestImageIndex,
    });

    render(<ScrollSlider panelId={panelId} />);
    const slider = screen.getByTestId(`scroll-slider:${panelId}`);
    const track = screen.getByTestId(`scroll-slider-track:${panelId}`) as HTMLDivElement & {
      setPointerCapture?: (id: number) => void;
      releasePointerCapture?: (id: number) => void;
    };
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 10,
      top: 10,
      left: 0,
      right: 10,
      bottom: 110,
      width: 10,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseEnter(slider);
    expect(screen.getByTestId(`scroll-slider-indicator:${panelId}`)).toHaveTextContent('5/10');

    dispatchPointer(track, 'pointerdown', 60, 1);
    dispatchPointer(track, 'pointermove', 100, 1);
    dispatchPointer(track, 'pointerup', 100, 1);

    expect(requestImageIndex).toHaveBeenCalledWith(panelId, 5, 10);
    expect(requestImageIndex).toHaveBeenCalledWith(panelId, 8, 10);
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(panelId, 5);
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(panelId, 8);
    expect(mocks.setPointerCapture).toHaveBeenCalledWith(1);
    expect(mocks.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('routes oriented viewport interactions through mprService', () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      panelOrientationMap: { [panelId]: 'AXIAL' },
      viewports: {
        [panelId]: {
          viewportId: panelId,
          imageIndex: 0,
          requestedImageIndex: null,
          totalImages: 0,
          windowWidth: 0,
          windowCenter: 0,
          zoomPercent: 100,
          rotation: 0,
          flipH: false,
          flipV: false,
          invert: false,
          imageWidth: 0,
          imageHeight: 0,
        },
      },
      mprViewports: {
        [panelId]: {
          sliceIndex: 2,
          totalSlices: 11,
          plane: 'AXIAL',
        },
      },
    });

    render(<ScrollSlider panelId={panelId} />);
    const track = screen.getByTestId(`scroll-slider-track:${panelId}`);
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 10,
      bottom: 100,
      width: 10,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);

    dispatchPointer(track, 'pointerdown', 90, 2);
    expect(mocks.mprScrollToIndex).toHaveBeenCalledWith(panelId, 9);
    expect(mocks.scrollToIndex).not.toHaveBeenCalled();
  });
});
