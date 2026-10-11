/** 3D QC sheet (SegWorks #230–257; D9). Presentational; everything from useQc3dSheet. */
import type { ReactNode } from 'react';
import type { Qc3dSheetModel } from '../../hooks/useQc3dSheet';
import OperationSheet, { SheetSection } from './OperationSheet';

function Slider({ label, min, max, step, value, unit, onChange, onDone }: { label: string; min: number; max: number; step: number; value: number; unit?: string; onChange: (v: number) => void; onDone: () => void }) {
  return (
    <label className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400">
      <span className="whitespace-nowrap w-16">{label}</span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onDone} className="flex-1 accent-blue-500" />
      <span className="text-zinc-300 tabular-nums whitespace-nowrap w-10 text-right">{value}{unit ?? ''}</span>
    </label>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="accent-blue-500" />
      {label}
    </label>
  );
}
function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <span className="text-[10px] text-zinc-400 w-16 whitespace-nowrap">{label}</span>
      <div className="flex flex-1 rounded overflow-hidden border border-zinc-700" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
            className={`flex-1 px-1.5 py-0.5 text-[10px] ${value === v ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
const BUTTON = 'rounded bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-40';
const BAND_STYLE: Record<string, string> = {
  main: 'text-zinc-300', fragment: 'text-zinc-300', stray: 'text-amber-300', speck: 'text-red-300',
};
const BAND_LABEL: Record<string, string> = { main: 'Main', fragment: 'Fragment', stray: 'Stray', speck: 'Speck' };

export default function Qc3dSheet({ m }: { m: Qc3dSheetModel }) {
  if (!m.open) return null;
  const s = m.settings;
  const status: ReactNode = m.building !== null
    ? <span data-testid="qc3d-building">Building surfaces · {Math.round(m.building * 100)}%</span>
    : m.stale ? <span className="text-amber-300" data-testid="qc3d-stale">The segmentation changed — Rebuild to update</span> : null;
  return (
    <OperationSheet
      title="3D QC"
      testId="qc3d-sheet"
      target={m.target}
      onBack={m.back}
      message={m.message}
      footer={(
        <>
          <button type="button" onClick={m.rebuild} disabled={m.building !== null} className="rounded bg-blue-600 px-2.5 py-1 text-[10px] text-white hover:bg-blue-500 disabled:opacity-40">Rebuild</button>
          <button type="button" onClick={m.resetView} className={BUTTON}>Reset view</button>
          <button type="button" onClick={m.toggleExpanded} aria-pressed={m.expanded} className={BUTTON}>{m.expanded ? 'Shrink 3D' : 'Expand 3D'}</button>
          <button type="button" onClick={m.back} className="rounded bg-zinc-800 px-2.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700">Done</button>
        </>
      )}
    >
      {status && <div className="px-3 py-1.5 text-[10px] text-zinc-400 border-b border-zinc-800/70">{status}</div>}
      <SheetSection label="Components">
        <div className="flex items-center gap-2 text-[10px] text-zinc-400" data-testid="qc3d-counts">
          <span>{m.counts.main ?? 0} main</span>·<span>{m.counts.fragment ?? 0} fragment</span>·
          <span className="text-amber-300">{m.counts.stray ?? 0} stray</span>·<span className="text-red-300">{m.counts.speck ?? 0} speck</span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400">
          <label className="flex items-center gap-1">Stray ≤
            <input type="number" aria-label="Stray threshold (voxels)" min={1} value={s.strayVoxels} onChange={(e) => m.set({ strayVoxels: Math.max(1, Number(e.target.value)) })} className="w-14 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-200" /> vox
          </label>
          <label className="flex items-center gap-1">Speck ≤
            <input type="number" aria-label="Speck threshold (voxels)" min={0} value={s.speckVoxels} onChange={(e) => m.set({ speckVoxels: Math.max(0, Number(e.target.value)) })} className="w-12 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-200" /> vox
          </label>
        </div>
        <table className="w-full mt-1.5 text-[10px]" data-testid="qc3d-report">
          <thead>
            <tr className="text-zinc-500 text-left">
              <th className="font-normal">Label</th><th className="font-normal">Kind</th><th className="font-normal text-right">cc</th><th className="font-normal text-right">voxels</th><th className="font-normal text-right">slices</th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr
                key={`${r.segmentIndex}:${r.id}`}
                data-testid="qc3d-row"
                data-band={r.band}
                aria-selected={r.selected}
                onClick={() => m.select(r.segmentIndex, r.id)}
                title="Select it in 3D and show it in the 2D viewport"
                className={`border-t border-zinc-800/60 cursor-pointer ${r.selected ? 'bg-blue-600/25' : 'hover:bg-zinc-800/60'}`}
              >
                <td className="py-0.5"><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: r.color }} />{r.label}</td>
                <td className={BAND_STYLE[r.band]}>{BAND_LABEL[r.band]}</td>
                <td className="text-right tabular-nums text-zinc-300">{r.volumeCc < 0.01 ? '<0.01' : r.volumeCc.toFixed(2)}</td>
                <td className="text-right tabular-nums text-zinc-400">{r.voxels.toLocaleString('en-US')}</td>
                <td className="text-right tabular-nums text-zinc-400" data-testid="qc3d-row-slices">{r.slices ? (r.slices[0] === r.slices[1] ? r.slices[0] : `${r.slices[0]}–${r.slices[1]}`) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-2 mt-1.5">
          <button type="button" className={BUTTON} disabled={!m.selectedRow || m.selectedLocked} onClick={m.deleteSelected} title="Remove the selected component from its segment (⌫)">
            Delete component
          </button>
          <span className="text-[10px] text-zinc-500">{m.selectedLocked ? 'Locked segment' : 'Click a row or a surface to select'}</span>
        </div>
      </SheetSection>
      <SheetSection label="3D scissor">
        <div className="flex items-center gap-2">
          <button type="button" aria-pressed={m.scissor.on} onClick={() => m.setScissor({ on: !m.scissor.on })}
            className={`rounded px-2 py-0.5 text-[10px] ${m.scissor.on ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-700 text-zinc-100 hover:bg-zinc-600'}`}>
            ✂ Scissor
          </button>
          <div className="flex flex-1 rounded overflow-hidden border border-zinc-700" role="group" aria-label="Scissor removes">
            {([['inside', 'Erase inside'], ['outside', 'Keep inside']] as const).map(([v, text]) => (
              <button key={v} type="button" aria-pressed={m.scissor.remove === v} onClick={() => m.setScissor({ remove: v })}
                className={`flex-1 px-1.5 py-0.5 text-[10px] ${m.scissor.remove === v ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                {text}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1 text-[10px] text-zinc-500">
          {m.scissor.on ? 'Draw around material on the 3D view; it is cut through the whole volume along the view. ⏎ applies.' : 'Cuts the active segment along the 3D view direction.'}
        </div>
      </SheetSection>
      <SheetSection label="Labels">
        <div className="flex gap-2 mb-1">
          <button type="button" className={BUTTON} onClick={() => m.setAllHidden(false)}>Show all</button>
          <button type="button" className={BUTTON} onClick={() => m.setAllHidden(true)}>Hide all</button>
        </div>
        {m.labels.map((l) => (
          <label key={l.segmentIndex} className="flex items-center gap-1.5 text-[10px] text-zinc-300" data-testid="qc3d-label">
            <input type="checkbox" checked={!l.hidden} onChange={() => m.toggleLabel(l.segmentIndex)} aria-label={`Show ${l.label} in 3D`} className="accent-blue-500" />
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: l.color }} />{l.label}
          </label>
        ))}
      </SheetSection>
      <SheetSection label="Display">
        <div className="flex flex-wrap gap-x-3">
          <Check label="Highlight strays" checked={s.showStrays} onChange={(v) => m.set({ showStrays: v })} />
          <Check label="Hide largest" checked={s.hideLargest} onChange={(v) => m.set({ hideLargest: v })} />
          <Check label="Auto-rotate" checked={s.autoRotate} onChange={(v) => m.set({ autoRotate: v })} />
        </div>
        <Slider label="Brightness" min={0} max={1} step={0.05} value={s.brightness} onChange={(v) => m.set({ brightness: v })} onDone={m.releaseFocus} />
        <Slider label="Ambient" min={0} max={1} step={0.05} value={s.ambient} onChange={(v) => m.set({ ambient: v })} onDone={m.releaseFocus} />
      </SheetSection>
      <SheetSection label="Surfaces">
        <Segmented label="Resolution" value={s.resolution} options={[[128, '128'], [192, '192'], [256, '256']]} onChange={(v) => m.set({ resolution: v })} />
        <Segmented label="Renderer" value={s.renderer} options={[['smooth', 'Smooth'], ['blocky', 'Voxels']]} onChange={(v) => m.set({ renderer: v })} />
        <Slider label="Smoothing" min={0} max={30} step={1} value={s.smoothIterations} onChange={(v) => m.set({ smoothIterations: v })} onDone={m.releaseFocus} />
        <Check label="Thicken thin structures (display only)" checked={s.thinBoost} onChange={(v) => m.set({ thinBoost: v })} />
      </SheetSection>
    </OperationSheet>
  );
}
