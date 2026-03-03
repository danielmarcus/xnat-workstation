import type { RefObject } from 'react';

interface NameEntryDialogProps {
  open: boolean;
  title: string;
  value: string;
  placeholder: string;
  confirmLabel: string;
  inputRef?: RefObject<HTMLInputElement>;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function NameEntryDialog({
  open,
  title,
  value,
  placeholder,
  confirmLabel,
  inputRef,
  onChange,
  onConfirm,
  onCancel,
}: NameEntryDialogProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 bg-zinc-950/70 flex items-center justify-center">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 mx-4 w-full max-w-[220px]">
        <label className="block text-xs text-zinc-400 mb-1.5">
          {title}
        </label>
        <input
          ref={inputRef}
          className="w-full text-xs text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 outline-none focus:border-blue-500 transition-colors"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onConfirm();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder={placeholder}
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onCancel}
            className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!value.trim()}
            className="text-[10px] text-blue-400 hover:text-blue-300 px-2.5 py-1 rounded bg-blue-900/30 hover:bg-blue-900/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
