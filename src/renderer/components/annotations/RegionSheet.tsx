/**
 * Region competition — SegWorks' "Chan-Vese" (#136–151; branch 5). Presentational; everything
 * from useRegionSheet. The clinical preset library (#137) is deferred: every parameter a preset
 * would set is here.
 */
import type { RegionSheetModel } from '../../hooks/useRegionSheet';
import { OperationBody, OperationRow } from './OperationsSection';

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <OperationRow label={label}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 min-w-0 accent-blue-500" />
      <span className="text-zinc-300 tabular-nums whitespace-nowrap">{value}</span>
    </OperationRow>
  );
}
function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-300">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      {label}
    </label>
  );
}

const BTN = 'rounded px-2.5 py-0.5 text-[10px] disabled:opacity-40';

export default function RegionSheet({ m }: { m: RegionSheetModel }) {
  if (!m.open) return null;
  const r = m.settings;
  const canRun = !!m.target && !m.running && m.estimate?.level !== 'block' && !m.domainProblem;
  return (
    <OperationBody
      testId="region-sheet"
      message={m.message}
      confirm={m.confirmingLeave ? { text: 'Discard the preview?', confirmLabel: 'Discard', onConfirm: m.confirmLeave, onCancel: m.cancelLeave } : null}
      footer={m.running ? (
        <button type="button" onClick={m.cancel} className={`${BTN} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}>Cancel run</button>
      ) : (
        <>
          <button type="button" onClick={m.preview} disabled={!canRun} className={`${BTN} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}>Run</button>
          <button type="button" onClick={m.commit} disabled={!m.previewActive && !canRun} className={`${BTN} bg-blue-600 text-white hover:bg-blue-500`}>Commit</button>
          <button type="button" onClick={m.discard} disabled={!m.previewActive} className={`${BTN} bg-zinc-800 text-zinc-300 hover:bg-zinc-700`}>Discard</button>
        </>
      )}
    >
      <OperationRow label="Run on">
        <select
          aria-label="Run on"
          value={r.mode}
          onChange={(e) => m.set({ mode: e.target.value as typeof r.mode })}
          className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
        >
          <option value="slice">The slice on screen</option>
          <option value="bounded">Slices around it (± Z pad)</option>
          <option value="extent10">The segmentation's slices ± 10</option>
          <option value="extent20">The segmentation's slices ± 20</option>
          <option value="volume">The whole volume</option>
        </select>
      </OperationRow>
      <div className="mt-1.5 text-[10px] text-zinc-400">Labels that compete</div>
      <div role="group" aria-label="Labels" className="flex flex-wrap gap-x-3">
        {m.members.map((x) => (
          <Check key={x.id} label={x.locked ? `${x.name} (locked)` : x.name} checked={x.selected && !x.locked} disabled={x.locked} onChange={() => m.toggleLabel(x.id)} />
        ))}
        <Check label="Background" checked={r.includeBackground} onChange={(includeBackground) => m.set({ includeBackground })} />
      </div>
      <div
        data-testid="region-estimate"
        data-level={m.estimate?.level ?? 'none'}
        className={`mt-1 text-[10px] ${m.estimate?.level === 'block' ? 'text-red-400' : m.estimate?.level === 'warn' ? 'text-amber-300' : 'text-zinc-500'}`}
      >
        {m.domainProblem ?? (m.estimate ? `${m.estimate.text}${m.estimate.reason ? ` — ${m.estimate.reason}` : ''}` : '')}
      </div>
      <Slider label="Iterations" min={1} max={200} step={1} value={r.iterations} onChange={(iterations) => m.set({ iterations })} />
      <div className="flex justify-end mt-1 text-[10px]">
        <button type="button" onClick={m.toggleAdvanced} aria-expanded={m.advancedOpen} className="text-zinc-400 hover:text-zinc-200 whitespace-nowrap">
          {m.advancedOpen ? '▾' : '▸'} Parameters
        </button>
      </div>
      {m.advancedOpen && (
        <>
          <Slider label="Smoothness (in-plane)" min={0.2} max={6} step={0.1} value={r.smoothXY} onChange={(smoothXY) => m.set({ smoothXY })} />
          <Slider label="Data weight" min={0.0001} max={0.02} step={0.0001} value={r.dataWeight} onChange={(dataWeight) => m.set({ dataWeight })} />
          <Slider label="Stay bias" min={0} max={1.5} step={0.05} value={r.stay} onChange={(stay) => m.set({ stay })} />
          <Slider label="Edge assist" min={0} max={0.1} step={0.001} value={r.edgeWeight} onChange={(edgeWeight) => m.set({ edgeWeight })} />
          <Slider label="Edge gate" min={0} max={300} step={1} value={r.edgeGate} onChange={(edgeGate) => m.set({ edgeGate })} />
          <Slider label="Clean up islands below (0 = off)" min={0} max={500} step={1} value={r.cleanup} onChange={(cleanup) => m.set({ cleanup })} />
          <Check label="Clip intensities (CT)" checked={r.clipOn} onChange={(clipOn) => m.set({ clipOn })} />
          {r.clipOn && (
            <>
              <Slider label="Clip low" min={-1000} max={500} step={10} value={r.clipLo} onChange={(clipLo) => m.set({ clipLo })} />
              <Slider label="Clip high" min={-200} max={1500} step={10} value={r.clipHi} onChange={(clipHi) => m.set({ clipHi })} />
            </>
          )}
          <Slider label="Z pad" min={1} max={10} step={1} value={r.zPad} onChange={(zPad) => m.set({ zPad })} />
          <Slider label="Smoothness (through slices)" min={0} max={4} step={0.1} value={r.smoothZ} onChange={(smoothZ) => m.set({ smoothZ })} />
          <Slider label="Z coupling" min={0} max={3} step={0.1} value={r.zCoupling} onChange={(zCoupling) => m.set({ zCoupling })} />
        </>
      )}
    </OperationBody>
  );
}
