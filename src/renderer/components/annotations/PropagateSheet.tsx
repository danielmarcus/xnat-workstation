/** Propagate sheet (SegWorks #169–181). Presentational; everything from usePropagateSheet. */
import type { PropagateSheetModel } from '../../hooks/usePropagateSheet';
import OperationSheet, { SheetSection } from './OperationSheet';

function Slider({ label, min, max, step, value, unit, onChange, onDone }: { label: string; min: number; max: number; step: number; value: number; unit?: string; onChange: (v: number) => void; onDone: () => void }) {
  return (
    <label className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400">
      <span className="whitespace-nowrap">{label}</span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onDone} className="flex-1 accent-blue-500" />
      <span className="text-zinc-300 tabular-nums whitespace-nowrap">{value}{unit ? ` ${unit}` : ''}</span>
    </label>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 mt-1 text-[10px] text-zinc-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      {label}
    </label>
  );
}

export default function PropagateSheet({ m }: { m: PropagateSheetModel }) {
  if (!m.open) return null;
  const s = m.settings;
  const canCommit = !!m.target && !m.target.locked && !m.previewReadOnly;
  return (
    <OperationSheet
      title="Propagate"
      testId="propagate-sheet"
      target={m.target}
      onBack={m.back}
      message={m.message}
      advancedOpen={m.advancedOpen}
      onToggleAdvanced={m.toggleAdvanced}
      advanced={(
        <div className="px-3 py-2 border-b border-zinc-800/70">
          <Check label="Stable reference (median of the start slice)" checked={s.stable} onChange={(v) => m.set({ stable: v })} />
          <Slider label="Max growth per slice (0 = no limit)" min={0} max={20} step={1} value={s.growPx} unit="px" onChange={(v) => m.set({ growPx: v })} onDone={m.releaseFocus} />
          <Slider label="Stop if area changes by" min={10} max={300} step={5} value={s.maxAreaChangePct} unit="%" onChange={(v) => m.set({ maxAreaChangePct: v })} onDone={m.releaseFocus} />
          <Check label="Fill holes" checked={s.fillHoles} onChange={(v) => m.set({ fillHoles: v })} />
          <Check label="Stop at strong image edges" checked={s.edgeGuard} onChange={(v) => m.set({ edgeGuard: v })} />
          <Check label="Smooth through slices" checked={s.zSmoothing} onChange={(v) => m.set({ zSmoothing: v })} />
        </div>
      )}
      confirm={m.confirmingLeave ? { text: 'Discard the preview?', confirmLabel: 'Discard', onConfirm: m.confirmLeave, onCancel: m.cancelLeave } : null}
      footer={(
        <>
          <button type="button" onClick={m.preview} disabled={!m.target} className="rounded bg-zinc-700 px-2.5 py-1 text-[10px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-40">Preview</button>
          <button type="button" onClick={m.commit} disabled={!canCommit} className="rounded bg-blue-600 px-2.5 py-1 text-[10px] text-white hover:bg-blue-500 disabled:opacity-40">Commit</button>
          <button type="button" onClick={m.discard} disabled={!m.previewActive} className="rounded bg-zinc-800 px-2.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40">Discard</button>
        </>
      )}
    >
      <SheetSection label="From the slice on screen">
        <div className="flex rounded overflow-hidden border border-zinc-700" role="group" aria-label="Direction">
          {(['backward', 'both', 'forward'] as const).map((d) => (
            <button key={d} type="button" aria-pressed={s.direction === d} onClick={() => m.set({ direction: d })}
              className={`flex-1 px-1.5 py-0.5 text-[10px] ${s.direction === d ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
              {d === 'backward' ? '← Backward' : d === 'forward' ? 'Forward →' : 'Both'}
            </button>
          ))}
        </div>
        <Slider label="Up to" min={1} max={200} step={1} value={s.maxSlices} unit="slices" onChange={(v) => m.set({ maxSlices: v })} onDone={m.releaseFocus} />
      </SheetSection>
      <SheetSection label="Intensity">
        <label className="flex items-center gap-2 text-[10px] text-zinc-400">
          Image
          <select aria-label="Intensity model" value={m.modality} onChange={(e) => m.set({ modality: e.target.value as 'ct' | 'mr' })} className="flex-1 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]">
            <option value="ct">CT — tolerance in HU</option>
            <option value="mr">MR — tolerance in σ</option>
          </select>
        </label>
        {m.modality === 'ct'
          ? <Slider label="Tolerance ±" min={10} max={1000} step={10} value={s.huTolerance} unit="HU" onChange={(v) => m.set({ huTolerance: v })} onDone={m.releaseFocus} />
          : <Slider label="Tolerance ±" min={0.5} max={5} step={0.1} value={s.sigma} unit="σ" onChange={(v) => m.set({ sigma: v })} onDone={m.releaseFocus} />}
      </SheetSection>
    </OperationSheet>
  );
}
