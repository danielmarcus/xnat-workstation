import { useEffect, useRef } from 'react';
import type { SegmentationDicomType } from '../../../stores/segmentationStore';

export type ExistingSaveDialogResult =
  | { action: 'overwrite' }
  | { action: 'create-new'; label: string }
  | { action: 'cancel' };

export interface ExistingSaveDialogState {
  scanId: string;
  dicomType: SegmentationDicomType;
  suggestedLabel: string;
  newLabel: string;
  mode: 'choose' | 'name';
}

interface ExistingSaveDialogProps {
  state: ExistingSaveDialogState | null;
  onStateChange: (updater: (prev: ExistingSaveDialogState | null) => ExistingSaveDialogState | null) => void;
  onResolve: (result: ExistingSaveDialogResult) => void;
}

export default function ExistingSaveDialog({
  state,
  onStateChange,
  onResolve,
}: ExistingSaveDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.mode === 'name' && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [state?.mode]);

  if (!state) return null;

  return (
    <div className="absolute inset-0 z-50 bg-zinc-950/70 flex items-center justify-center">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 mx-4 w-full max-w-[260px]">
        {state.mode === 'choose' ? (
          <>
            <div className="text-xs text-zinc-300 leading-relaxed">
              This annotation already exists on XNAT as scan <span className="font-semibold text-zinc-100">#{state.scanId}</span>.
            </div>
            <div className="text-[11px] text-zinc-500 mt-1.5">
              Choose how you want to save this update:
            </div>
            <div className="grid gap-2 mt-3">
              <button
                onClick={() => onResolve({ action: 'overwrite' })}
                className="text-[11px] text-zinc-100 px-3 py-1.5 rounded bg-blue-900/35 hover:bg-blue-900/50 transition-colors text-left"
              >
                Overwrite
              </button>
              <button
                onClick={() => {
                  onStateChange((prev) => (prev ? { ...prev, mode: 'name' } : prev));
                }}
                className="text-[11px] text-zinc-200 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors text-left"
              >
                Create New
              </button>
              <button
                onClick={() => onResolve({ action: 'cancel' })}
                className="text-[11px] text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors text-left"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="block text-xs text-zinc-400 mb-1.5">
              {state.dicomType === 'RTSTRUCT' ? 'Structure name' : 'Segmentation name'}
            </label>
            <input
              ref={inputRef}
              className="w-full text-xs text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 outline-none focus:border-blue-500 transition-colors"
              value={state.newLabel}
              onChange={(e) => {
                const value = e.target.value;
                onStateChange((prev) => (prev ? { ...prev, newLabel: value } : prev));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const finalLabel = state.newLabel.trim();
                  if (finalLabel) {
                    onResolve({ action: 'create-new', label: finalLabel });
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onResolve({ action: 'cancel' });
                }
              }}
              placeholder={state.suggestedLabel}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => {
                  onStateChange((prev) => (prev ? { ...prev, mode: 'choose' } : prev));
                }}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded hover:bg-zinc-800 transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => onResolve({ action: 'cancel' })}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const finalLabel = state.newLabel.trim();
                  if (!finalLabel) return;
                  onResolve({ action: 'create-new', label: finalLabel });
                }}
                disabled={!state.newLabel.trim()}
                className="text-[10px] text-blue-400 hover:text-blue-300 px-2.5 py-1 rounded bg-blue-900/30 hover:bg-blue-900/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
