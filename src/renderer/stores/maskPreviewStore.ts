/**
 * The pending mask-operation preview, as the UI sees it (SegWorks parity D4). The staged
 * edit itself lives in lib/cornerstone/maskPreview; this is what the preview bar and the
 * open operation render from.
 */
import { create } from 'zustand';

export interface MaskPreviewState {
  /** A preview is waiting for commit or discard. */
  active: boolean;
  /** Operation name, e.g. "Keep largest". */
  label: string;
  /** What it will change, e.g. "slices 30–58 · −1,204 px". */
  summary: string;
  /** The viewport the operation was run from — where the preview bar is shown. */
  viewportId: string | null;
  /** Holding the compare key: the preview overlay is hidden to show the current mask. */
  comparing: boolean;
  /** The target is locked: shown for inspection, cannot be committed. */
  readOnly: boolean;
  /**
   * The last preview was discarded because its segment changed underneath it (a stroke, an
   * undo). Lets the open operation say so instead of the preview silently vanishing.
   */
  discardedStale: boolean;
}

export const useMaskPreviewStore = create<MaskPreviewState>(() => ({
  active: false,
  label: '',
  summary: '',
  viewportId: null,
  comparing: false,
  readOnly: false,
  discardedStale: false,
}));
