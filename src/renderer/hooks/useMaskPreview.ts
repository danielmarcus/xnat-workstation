/**
 * The pending mask-operation preview for components (SegWorks parity D4): its state and
 * the commit / discard actions, so presentational components never import the service.
 */
import { commitPreview, discardPreview } from '../lib/cornerstone/maskPreview';
import { computeClient } from '../lib/compute/computeClient';
import { useMaskPreviewStore, type MaskPreviewState } from '../stores/maskPreviewStore';
import { useComputeStore, type ComputeJobState } from '../stores/computeStore';

export function useMaskPreview(): MaskPreviewState & {
  commit: () => void;
  discard: () => void;
  /** A compute job running toward a preview (shown in the bar's slot), and its Cancel. */
  job: ComputeJobState | null;
  cancelJob: () => void;
} {
  const state = useMaskPreviewStore();
  const job = useComputeStore((s) => s.job);
  return { ...state, commit: () => { commitPreview(); }, discard: discardPreview, job, cancelJob: () => (job?.cancel ? job.cancel() : computeClient.cancelCurrent()) };
}
