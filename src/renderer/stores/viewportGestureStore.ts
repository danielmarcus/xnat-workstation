/**
 * Whether a pointer drag that STARTED on a viewport's image is still in progress.
 *
 * Reported: while drawing a mask, drifting a few pixels onto the slice scrollbar at the
 * viewport's right edge handed the drag to the scrollbar — the stroke stopped and the
 * slice started scrubbing. The scrollbar lives inside the viewport, so a stroke near the
 * right edge can reach it without the user meaning to leave the image at all.
 *
 * The viewport sets this on pointer-down and clears it on release (or cancel), and the
 * chrome that sits over the image — the scrollbar, the time scrubber — makes itself
 * inert while it is set, so the pointer stays with the stroke until the button comes up.
 */
import { create } from 'zustand';

interface ViewportGestureState {
  /** Panel whose image a drag started on, or null when no drag is in progress. */
  draggingPanelId: string | null;
  beginDrag: (panelId: string) => void;
  endDrag: () => void;
}

export const useViewportGestureStore = create<ViewportGestureState>((set) => ({
  draggingPanelId: null,
  beginDrag: (panelId) => set({ draggingPanelId: panelId }),
  endDrag: () => set({ draggingPanelId: null }),
}));

/** True while any viewport drag is in progress. For the over-image chrome. */
export const useIsViewportDragging = (): boolean =>
  useViewportGestureStore((s) => s.draggingPanelId !== null);
