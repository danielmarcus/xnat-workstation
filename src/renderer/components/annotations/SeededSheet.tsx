/**
 * Seeded segmentation (SegWorks #101–135; branch 5). Presentational; everything from
 * useSeededSheet. Method is one dropdown (sheet rule: variants are never separate operations).
 */
import type { SeededSheetModel } from '../../hooks/useSeededSheet';
import { OperationBody, OperationRow, Segmented } from './OperationsSection';

function Slider({ label, min, max, step, value, unit, onChange }: { label: string; min: number; max: number; step: number; value: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <OperationRow label={label}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 min-w-0 accent-blue-500" />
      <span className="text-zinc-300 tabular-nums whitespace-nowrap">{value}{unit ? ` ${unit}` : ''}</span>
    </OperationRow>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      {label}
    </label>
  );
}

const LINK = 'text-[10px] text-zinc-400 hover:text-zinc-200 disabled:opacity-40';
const BTN = 'rounded px-2.5 py-0.5 text-[10px] disabled:opacity-40';

export default function SeededSheet({ m }: { m: SeededSheetModel }) {
  if (!m.open) return null;
  const s = m.settings;
  const blocked = m.estimate?.level === 'block';
  const canRun = !!m.target && !m.running && !blocked && !m.domainProblem;
  const canCommit = canRun && !m.target?.locked && !m.previewReadOnly;
  return (
    <OperationBody
      testId="seeded-sheet"
      message={m.message}
      confirm={m.confirmingLeave ? { text: 'Discard the preview?', confirmLabel: 'Discard', onConfirm: m.confirmLeave, onCancel: m.cancelLeave } : null}
      footer={m.running ? (
        <button type="button" onClick={m.cancel} className={`${BTN} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}>Cancel run</button>
      ) : (
        <>
          <button type="button" onClick={m.preview} disabled={!canRun} title={m.estimate?.reason ?? undefined} className={`${BTN} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}>Run</button>
          <button type="button" onClick={m.commit} disabled={!(m.previewActive ? !m.previewReadOnly : canCommit)} className={`${BTN} bg-blue-600 text-white hover:bg-blue-500`}>Commit</button>
          <button type="button" onClick={m.discard} disabled={!m.previewActive} className={`${BTN} bg-zinc-800 text-zinc-300 hover:bg-zinc-700`}>Discard</button>
        </>
      )}
    >
      <OperationRow label="Method">
        <select
          aria-label="Method"
          value={s.method}
          onChange={(e) => m.set({ method: e.target.value as typeof s.method })}
          className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
        >
          <option value="growCut">Fast GrowCut</option>
          <option value="graphCut">Graph Cut</option>
          <option value="alphaExpansion">Multi-label graph cut (α-expansion)</option>
        </select>
      </OperationRow>

      <div className="mt-1.5 text-[10px] text-zinc-400 flex items-center gap-2">
        <span>Seeds</span>
        <button
          type="button"
          aria-pressed={m.painting}
          onClick={m.togglePainting}
          title="Paint seeds on the image: drag lays the chosen class, ⇧-drag lays Background"
          className={`rounded px-1.5 py-0.5 ${m.painting ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
        >
          Paint seeds
        </button>
        <span className="flex-1" />
        <button type="button" className={LINK} disabled={!m.canRestore} onClick={m.restoreSeeds} title="Bring back the seeds of the last run">↺ Restore seeds</button>
        <button type="button" className={LINK} onClick={m.clearSeeds}>Clear seeds</button>
      </div>
      <div role="group" aria-label="Seed class" className="flex flex-wrap gap-1 mt-1" data-testid="seed-classes">
        {m.classes.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={m.paintClass === c.id}
            onClick={() => m.choose(c.id)}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border ${m.paintClass === c.id ? 'border-blue-500 text-zinc-100' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
          >
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: c.color }} />
            {c.name}
            <span className="text-zinc-500 tabular-nums" data-testid={`seed-count-${c.id}`}>{c.strokes}</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={m.paintClass === 'erase'}
          onClick={() => m.choose('erase')}
          className={`rounded px-1.5 py-0.5 text-[10px] border ${m.paintClass === 'erase' ? 'border-blue-500 text-zinc-100' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
        >
          Erase
        </button>
      </div>
      <Slider label="Seed brush" min={2} max={40} step={1} value={m.brushPx} unit="px" onChange={m.setBrush} />

      <OperationRow label="Domain">
        <Segmented
          label="Domain"
          className="flex-1"
          value={s.domain}
          onChange={(domain) => m.set({ domain })}
          options={[{ value: 'seeded', label: 'Around seeds' }, { value: 'roi', label: 'ROI limit' }, { value: 'volume', label: 'Volume' }]}
        />
      </OperationRow>
      <div
        data-testid="seeded-estimate"
        data-level={m.estimate?.level ?? 'none'}
        className={`mt-1 text-[10px] ${m.estimate?.level === 'block' ? 'text-red-400' : m.estimate?.level === 'warn' ? 'text-amber-300' : 'text-zinc-500'}`}
      >
        {m.domainProblem ?? (m.estimate ? `${m.estimate.text}${m.estimate.reason ? ` — ${m.estimate.reason}` : ''}` : '')}
      </div>

      {s.method === 'growCut' && (
        <>
          <Check label="Intensity range" checked={s.gateOn} onChange={(gateOn) => m.set({ gateOn })} />
          {s.gateOn && (
            <>
              <Slider label="From" min={-1024} max={3000} step={10} value={s.gateLo} onChange={(gateLo) => m.set({ gateLo })} />
              <Slider label="To" min={-1024} max={3000} step={10} value={s.gateHi} onChange={(gateHi) => m.set({ gateHi })} />
            </>
          )}
        </>
      )}
      {s.method === 'graphCut' && (
        <>
          <Slider label="Smoothness λ" min={5} max={200} step={5} value={s.lambda} onChange={(lambda) => m.set({ lambda })} />
          <Slider label="Edge σ" min={5} max={150} step={5} value={s.sigma} onChange={(sigma) => m.set({ sigma })} />
        </>
      )}
      {s.method === 'alphaExpansion' && (
        <>
          <Slider label="Smoothness" min={1} max={16} step={0.5} value={s.smooth} onChange={(smooth) => m.set({ smooth })} />
          <Slider label="Edge σ" min={5} max={80} step={1} value={s.alphaSigma} onChange={(alphaSigma) => m.set({ alphaSigma })} />
          <Slider label="Sweeps" min={1} max={4} step={1} value={s.sweeps} onChange={(sweeps) => m.set({ sweeps })} />
        </>
      )}

      <div className="flex justify-end mt-1 text-[10px]">
        <button type="button" onClick={m.toggleAdvanced} aria-expanded={m.advancedOpen} className="text-zinc-400 hover:text-zinc-200 whitespace-nowrap">
          {m.advancedOpen ? '▾' : '▸'} Advanced
        </button>
      </div>
      {m.advancedOpen && (
        <>
          <Slider label="Pad in-plane" min={0} max={80} step={2} value={s.padXY} unit="px" onChange={(padXY) => m.set({ padXY })} />
          <Slider label="Pad slices" min={0} max={64} step={1} value={s.padZ} onChange={(padZ) => m.set({ padZ })} />
          {s.method === 'alphaExpansion' && (
            <>
              <Slider label="Intensity weight" min={0} max={1} step={0.05} value={s.uInt} onChange={(uInt) => m.set({ uInt })} />
              <Slider label="Locality weight" min={0} max={1} step={0.05} value={s.uLoc} onChange={(uLoc) => m.set({ uLoc })} />
              <Slider label="Start: locality" min={0} max={1} step={0.05} value={s.locality} onChange={(locality) => m.set({ locality })} />
              <Slider label="Start: intensity" min={0} max={1} step={0.05} value={s.intensity} onChange={(intensity) => m.set({ intensity })} />
            </>
          )}
          {s.method !== 'growCut' && (
            <>
              <Check label="Clean up the result" checked={s.postOn} onChange={(postOn) => m.set({ postOn })} />
              {s.postOn && (
                <>
                  <OperationRow label="Keep">
                    <select aria-label="Keep component" value={s.postKeep} onChange={(e) => m.set({ postKeep: e.target.value as typeof s.postKeep })} className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]">
                      <option value="seed">The seeded component</option>
                      <option value="largest">The largest component</option>
                      <option value="off">Every component</option>
                    </select>
                  </OperationRow>
                  <Slider label="Remove islands below" min={0} max={5000} step={10} value={s.postMinIsland} unit="voxels" onChange={(postMinIsland) => m.set({ postMinIsland })} />
                  <Slider label="Smoothing passes" min={0} max={5} step={1} value={s.postSmooth} onChange={(postSmooth) => m.set({ postSmooth })} />
                  <Slider label="Shrink–grow passes" min={0} max={5} step={1} value={s.postShrinkGrow} onChange={(postShrinkGrow) => m.set({ postShrinkGrow })} />
                </>
              )}
            </>
          )}
        </>
      )}
    </OperationBody>
  );
}
