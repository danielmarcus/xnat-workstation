import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The scrollbar drives the viewport through the service via useSliceScrollbar;
// mock the service so we can assert the absolute index it scrolls to.
const scrollToSlice = vi.fn();
vi.mock('../../lib/cornerstone/viewportService', () => ({
  viewportService: { scrollToSlice: (id: string, i: number) => scrollToSlice(id, i) },
}));

import ViewportScrollbar from './ViewportScrollbar';
import { useViewerStore } from '../../stores/viewerStore';

function setSlice(index: number, total: number): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useViewerStore.getState()._initPanel('panel_0');
  useViewerStore.getState()._updateImageIndex('panel_0', index, total);
}

/** Stub the track's layout so client-Y → index math is deterministic. */
function stubTrackRect(): void {
  const track = screen.getByTestId('viewport-scrollbar:panel_0');
  track.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 10, bottom: 400, width: 10, height: 400, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

beforeEach(() => scrollToSlice.mockClear());
afterEach(() => vi.clearAllMocks());

describe('ViewportScrollbar', () => {
  it('is hidden for a single-slice series', () => {
    setSlice(0, 1);
    render(<ViewportScrollbar panelId="panel_0" />);
    expect(screen.queryByTestId('viewport-scrollbar:panel_0')).toBeNull();
  });

  it('renders a thumb positioned by the current slice', () => {
    setSlice(0, 16);
    const { rerender } = render(<ViewportScrollbar panelId="panel_0" />);
    // First slice ⇒ thumb at the top.
    expect(screen.getByTestId('scrollbar-thumb:panel_0')).toHaveStyle({ top: '0%' });

    // Last slice ⇒ thumb at the bottom (top = (100 - thumbPct)%, thumbPct = max(6, 100/16)=6.25).
    setSlice(15, 16);
    rerender(<ViewportScrollbar panelId="panel_0" />);
    expect(screen.getByTestId('scrollbar-thumb:panel_0')).toHaveStyle({ top: '93.75%' });
  });

  // jsdom's synthetic PointerEvent doesn't carry clientX/Y; a real MouseEvent
  // (which PointerEvent extends) does, and React still fires onPointerDown/Move for
  // a 'pointerdown'/'pointermove' typed event.
  const pointer = (type: string, init: MouseEventInit): MouseEvent =>
    new MouseEvent(type, { bubbles: true, ...init });

  it('clicking the track scrolls to the slice at that position', () => {
    setSlice(0, 11); // 11 slices ⇒ indices 0..10, track height 400 ⇒ 40px/slice
    render(<ViewportScrollbar panelId="panel_0" />);
    stubTrackRect();
    // Click at y = 200 (mid-track) ⇒ frac 0.5 ⇒ round(0.5 * 10) = index 5.
    fireEvent(screen.getByTestId('viewport-scrollbar:panel_0'), pointer('pointerdown', { clientY: 200, button: 0 }));
    expect(scrollToSlice).toHaveBeenCalledWith('panel_0', 5);
  });

  it('dragging (primary button held) scrubs slices', () => {
    setSlice(0, 11);
    render(<ViewportScrollbar panelId="panel_0" />);
    stubTrackRect();
    const track = screen.getByTestId('viewport-scrollbar:panel_0');
    fireEvent(track, pointer('pointerdown', { clientY: 0, button: 0 }));
    expect(scrollToSlice).toHaveBeenLastCalledWith('panel_0', 0);
    fireEvent(track, pointer('pointermove', { clientY: 400, buttons: 1 })); // drag to bottom ⇒ last index
    expect(scrollToSlice).toHaveBeenLastCalledWith('panel_0', 10);
  });

  it('ignores pointer-move when no button is held', () => {
    setSlice(0, 11);
    render(<ViewportScrollbar panelId="panel_0" />);
    stubTrackRect();
    fireEvent(screen.getByTestId('viewport-scrollbar:panel_0'), pointer('pointermove', { clientY: 200, buttons: 0 }));
    expect(scrollToSlice).not.toHaveBeenCalled();
  });
});
