/**
 * The pending mask-operation preview for components (SegWorks parity D4): its state and
 * the commit / discard actions, so presentational components never import the service.
 */
import { commitPreview, discardPreview } from '../lib/cornerstone/maskPreview';
import { useMaskPreviewStore, type MaskPreviewState } from '../stores/maskPreviewStore';

export function useMaskPreview(): MaskPreviewState & { commit: () => void; discard: () => void } {
  const state = useMaskPreviewStore();
  return { ...state, commit: () => { commitPreview(); }, discard: discardPreview };
}
