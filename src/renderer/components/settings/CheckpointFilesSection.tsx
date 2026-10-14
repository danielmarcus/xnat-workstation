/**
 * Settings › File Backup › Segmentation checkpoints (SegWorks parity D8). Presentational.
 * Status is shown here, in place — never a toast.
 */
import { useCheckpointFiles } from '../../hooks/useCheckpointFiles';

export default function CheckpointFilesSection() {
  const f = useCheckpointFiles();
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-3" data-testid="checkpoint-files">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-zinc-300">
          Segmentation checkpoints{f.label && <span className="text-zinc-500 font-normal"> · {f.label}</span>}
        </h3>
        <button
          type="button"
          disabled={!f.label}
          onClick={() => { void f.importOne(); }}
          className="px-2 py-1 rounded text-[11px] bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
        >
          Import checkpoint file…
        </button>
      </div>
      {!f.label ? (
        <p className="text-[11px] text-zinc-500">Select a segmentation in the Annotations panel to export or import its checkpoints.</p>
      ) : f.list.length === 0 ? (
        <p className="text-[11px] text-zinc-500">“{f.label}” has no checkpoints yet — save one from its menu.</p>
      ) : (
        <ul className="space-y-1">
          {f.list.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[11px]" data-testid={`checkpoint-file-${c.id}`}>
              <span className="flex-1 text-zinc-300 truncate">
                <span>{c.kind === 'baseline' ? 'Baseline' : c.name}</span>
                <span className="text-zinc-500"> · {new Date(c.createdAt).toLocaleString()}</span>
              </span>
              <button
                type="button"
                onClick={() => { void f.exportOne(c.id); }}
                className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              >
                Export…
              </button>
            </li>
          ))}
        </ul>
      )}
      {f.status && <p className="text-[11px] text-zinc-400" role="status" data-testid="checkpoint-files-status">{f.status}</p>}
    </div>
  );
}
