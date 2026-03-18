import type { SegmentationDicomType } from '../../../stores/segmentationStore';

export type DeleteConfirmDialogResult =
  | { action: 'local-only' }
  | { action: 'delete-from-xnat' }
  | { action: 'cancel' };

export interface DeleteConfirmDialogState {
  segmentationId: string;
  segmentLabel: string;
  scanId: string;
  xnatHost: string;
  dicomType: SegmentationDicomType;
}

interface DeleteConfirmDialogProps {
  state: DeleteConfirmDialogState | null;
  onResolve: (result: DeleteConfirmDialogResult) => void;
}

export default function DeleteConfirmDialog({
  state,
  onResolve,
}: DeleteConfirmDialogProps) {
  if (!state) return null;

  const typeLabel = state.dicomType === 'RTSTRUCT' ? 'structure' : 'segmentation';

  // Extract just the hostname from the full URL for concise display
  let hostDisplay = state.xnatHost;
  try {
    hostDisplay = new URL(state.xnatHost).hostname;
  } catch {
    // Use raw value if not a valid URL
  }

  return (
    <div className="absolute inset-0 z-50 bg-zinc-950/70 flex items-center justify-center">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 mx-4 w-full max-w-[280px]">
        <div className="text-xs text-zinc-300 leading-relaxed">
          This {typeLabel} is saved on XNAT as scan{' '}
          <span className="font-semibold text-zinc-100">#{state.scanId}</span>.
        </div>
        <div className="text-[11px] text-zinc-500 mt-1.5">
          How do you want to delete it?
        </div>
        <div className="grid gap-2 mt-3">
          <button
            onClick={() => onResolve({ action: 'local-only' })}
            className="text-[11px] text-zinc-200 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors text-left"
          >
            Delete {typeLabel} locally only
          </button>
          <button
            onClick={() => onResolve({ action: 'delete-from-xnat' })}
            className="text-[11px] text-red-300 px-3 py-1.5 rounded bg-red-900/25 hover:bg-red-900/40 transition-colors text-left"
          >
            Delete {typeLabel} on {hostDisplay}
          </button>
          <button
            onClick={() => onResolve({ action: 'cancel' })}
            className="text-[11px] text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors text-left"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
