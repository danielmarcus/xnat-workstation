interface SavingOverlayProps {
  saving: boolean;
}

export default function SavingOverlay({ saving }: SavingOverlayProps) {
  if (!saving) return null;

  return (
    <div className="absolute inset-0 z-50 bg-zinc-950/60 flex items-center justify-center">
      <div className="flex items-center gap-2 text-xs text-zinc-300">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
        </svg>
        Exporting...
      </div>
    </div>
  );
}
