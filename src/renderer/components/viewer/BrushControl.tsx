/**
 * BrushControl — INTERIM toolbar affordance for the segmentation brush: a Brush
 * toggle + a radius slider (shown only while the brush is active). The brush tool
 * works (P1.7) but had no mounted selector; the full editing toolbox lives in the
 * Phase-3 Annotations side panel, which will REPLACE this. Kept minimal + clearly
 * interim so it's cheap to remove.
 *
 * Reads/writes viewerStore (activeTool / brushSize); the store routes brushSize to
 * unifiedToolService.setBrushSize (§2 — no Cornerstone import here).
 */
import { useViewerStore } from '../../stores/viewerStore';
import { ToolName } from '@shared/types/viewer';
import { IconBrush } from '../icons';

interface BrushControlProps {
  hideLabel?: boolean;
}

export default function BrushControl({ hideLabel }: BrushControlProps): React.ReactElement {
  const activeTool = useViewerStore((s) => s.activeTool);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const brushSize = useViewerStore((s) => s.brushSize);
  const setBrushSize = useViewerStore((s) => s.setBrushSize);
  const isBrush = activeTool === ToolName.Brush;

  return (
    <div className="flex items-center gap-1.5">
      <button
        data-testid="tool-brush"
        onClick={() => setActiveTool(ToolName.Brush)}
        title="Brush (segmentation)"
        className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
          isBrush ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
        }`}
      >
        <IconBrush className="w-3.5 h-3.5" />
        {!hideLabel && <span>Brush</span>}
      </button>
      {isBrush && (
        <label className="flex items-center gap-1 text-[10px] text-zinc-300" title="Brush size">
          <input
            data-testid="brush-size-slider"
            type="range"
            min={1}
            max={50}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-20 accent-sky-500"
          />
          <span data-testid="brush-size-value" className="w-5 tabular-nums">{brushSize}</span>
        </label>
      )}
    </div>
  );
}
