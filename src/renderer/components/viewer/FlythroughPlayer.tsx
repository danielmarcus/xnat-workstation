/**
 * Auto Review flythrough mini-player (SegWorks parity D6). Top-centre of the viewport
 * under review (the preview bar's slot — a review discards any preview), collapsed to
 * play/pause · stop · position, with the settings behind ▾. Space pauses, ⎋ stops.
 */
import { useFlythrough } from '../../hooks/useFlythrough';

// Line glyphs, not ⏸/⏹ characters — macOS renders those as coloured emoji tiles.
const G = (d: string) => (
  <svg viewBox="0 0 12 12" width={11} height={11} fill="currentColor" aria-hidden="true"><path d={d} /></svg>
);
const PAUSE = G('M3 2h2v8H3zM7 2h2v8H7z');
const PLAY = G('M3 2l7 4-7 4z');
const STOP = G('M2.5 2.5h7v7h-7z');

export default function FlythroughPlayer({ panelId }: { panelId: string }) {
  const f = useFlythrough(panelId);
  if (!f.visible) return null;
  const s = f.settings;
  return (
    <div data-testid="flythrough-player" className="absolute top-12 left-1/2 -translate-x-1/2 z-30 text-[11px] text-zinc-200">
      <div className="flex items-center gap-2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 shadow">
        <button type="button" tabIndex={-1} aria-label={f.paused ? 'Resume review' : 'Pause review'} onMouseDown={(e) => e.preventDefault()} onClick={f.togglePause} className="px-1 hover:text-white">
          {f.paused ? PLAY : PAUSE}
        </button>
        <button type="button" tabIndex={-1} aria-label="Stop review" onMouseDown={(e) => e.preventDefault()} onClick={f.stop} className="px-1 hover:text-white">{STOP}</button>
        <span data-testid="flythrough-position">
          Review {f.step} / {f.steps} · slice {f.shownSlice}
          <span className="text-zinc-500"> ({f.range[0]}–{f.range[1]})</span>
          {f.anatomyPhase && <span className="text-zinc-400"> · anatomy</span>}
        </span>
        <button type="button" tabIndex={-1} aria-label="Review settings" aria-expanded={f.settingsOpen} onMouseDown={(e) => e.preventDefault()} onClick={f.toggleSettings} className="px-1 text-zinc-400 hover:text-white">▾</button>
      </div>
      {f.settingsOpen && (
        <div className="mt-1 rounded-md border border-zinc-700 bg-zinc-900/95 p-2 shadow space-y-1.5" data-testid="flythrough-settings">
          <div className="text-[9px] uppercase tracking-wide text-zinc-500">Segments</div>
          {f.segments.map((m) => (
            <label key={m.segmentIndex} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={s.segmentIndices.length === 0 || s.segmentIndices.includes(m.segmentIndex)}
                onChange={(e) => {
                  const all = s.segmentIndices.length ? s.segmentIndices : f.segments.map((x) => x.segmentIndex);
                  const next = e.target.checked ? [...new Set([...all, m.segmentIndex])] : all.filter((i) => i !== m.segmentIndex);
                  f.setSettings({ segmentIndices: next.length === f.segments.length ? [] : next });
                }}
              />
              {m.name}
            </label>
          ))}
          <label className="flex items-center gap-1.5">
            Direction
            <select aria-label="Direction" value={s.direction} onChange={(e) => f.setSettings({ direction: e.target.value as 'forward' | 'backward' })} className="bg-zinc-800 rounded px-1">
              <option value="forward">Forward</option>
              <option value="backward">Backward</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Start
            <select aria-label="Start" value={s.startFrom} onChange={(e) => f.setSettings({ startFrom: e.target.value as 'bounds' | 'current' })} className="bg-zinc-800 rounded px-1">
              <option value="bounds">At the first segmented slice</option>
              <option value="current">From the current slice</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={s.flicker} onChange={(e) => f.setSettings({ flicker: e.target.checked })} />
            Flicker masks (anatomy, then mask)
          </label>
          <label className="flex items-center gap-1.5">
            Anatomy
            <input type="range" aria-label="Anatomy dwell" min={100} max={2000} step={50} value={s.anatomyMs} onChange={(e) => f.setSettings({ anatomyMs: Number(e.target.value) })} className="accent-blue-500" />
            <span className="tabular-nums">{s.anatomyMs} ms</span>
          </label>
          <label className="flex items-center gap-1.5">
            Mask
            <input type="range" aria-label="Mask dwell" min={100} max={3000} step={50} value={s.maskMs} onChange={(e) => f.setSettings({ maskMs: Number(e.target.value) })} className="accent-blue-500" />
            <span className="tabular-nums">{s.maskMs} ms</span>
          </label>
          <button type="button" onClick={f.restart} className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600">Restart with these settings</button>
        </div>
      )}
    </div>
  );
}
