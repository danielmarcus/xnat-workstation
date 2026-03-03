interface PanelToastProps {
  toast: { message: string; type: 'success' | 'error' } | null;
}

export default function PanelToast({ toast }: PanelToastProps) {
  if (!toast) return null;

  return (
    <div
      className={`absolute top-2 left-2 right-2 z-[100] px-3 py-2 rounded-lg shadow-lg text-[11px] font-medium transition-opacity ${
        toast.type === 'success'
          ? 'bg-green-800/90 text-green-100'
          : 'bg-red-800/90 text-red-100'
      }`}
    >
      {toast.message}
    </div>
  );
}
