/**
 * The pending mask-operation preview, as the UI sees it (SegWorks parity D4). The staged
 * edit itself lives in lib/cornerstone/maskPreview; this is what the preview bar and the
 * operation sheet render from.
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
}

export const useMaskPreviewStore = create<MaskPreviewState>(() => ({
  active: false,
  label: '',
  summary: '',
  viewportId: null,
  comparing: false,
}));
