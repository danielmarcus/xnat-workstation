/**
 * Interpolate sheet (SegWorks #152–168). Presentational; everything from useInterpolateSheet.
 * Gaps are listed in the viewport's slice numbers; each can be previewed on its own.
 */
import type { InterpolateSheetModel } from '../../hooks/useInterpolateSheet';
import OperationSheet, { SheetSection } from './OperationSheet';

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex rounded overflow-hidden border border-zinc-700" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 px-1.5 py-0.5 text-[10px] ${value === o.value ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function InterpolateSheet({ m }: { m: InterpolateSheetModel }) {
  if (!m.open) return null;
  const s = m.settings;
  const method = m.methods.find((x) => x.id === s.method);
  const canCommit = !!m.target && !m.target.locked && !m.previewReadOnly;
  return (
    <OperationSheet
      title="Interpolate"
      testId="interpolate-sheet"
      target={m.target}
      onBack={m.back}
      message={m.message}
      advancedOpen={m.advancedOpen}
      onToggleAdvanced={m.toggleAdvanced}
      advanced={(
        <div className="px-3 py-2 border-b border-zinc-800/70">
          <label className="flex items-center gap-2 text-[10px] text-zinc-400">
            Distance transform
            <select aria-label="Distance transform" value={s.distance} onChange={(e) => m.set({ distance: e.target.value as 'exact' | 'chamfer' })} className="flex-1 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]">
              <option value="exact">Exact Euclidean</option>
              <option value="chamfer">Chamfer (faster)</option>
            </select>
          </label>
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
      <SheetSection label="Method">
        <select aria-label="Interpolation method" value={s.method} onChange={(e) => m.set({ method: e.target.value as typeof s.method })} className="w-full px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[11px]">
          {m.methods.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        {method && <div className="mt-1 text-[10px] text-zinc-500">{method.hint}</div>}
      </SheetSection>
      <SheetSection label="Fill">
        <Segmented
          label="Fill"
          value={s.fill}
          onChange={(fill) => m.set({ fill })}
          options={[{ value: 'gaps', label: 'All gaps' }, { value: 'current', label: 'This slice' }, { value: 'anchors', label: 'A → B' }]}
        />
        {s.fill === 'anchors' && (
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-zinc-400" data-testid="interp-anchors">
            <span className="text-amber-300 font-semibold">A</span>
            <span className="tabular-nums w-6" data-testid="anchor-a">{s.anchorA ?? '—'}</span>
            <button type="button" onClick={() => m.setAnchorHere('A')} className="rounded bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700">Set A</button>
            <span className="text-amber-300 font-semibold">B</span>
            <span className="tabular-nums w-6" data-testid="anchor-b">{s.anchorB ?? '—'}</span>
            <button type="button" onClick={() => m.setAnchorHere('B')} className="rounded bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700">Set B</button>
          </div>
        )}
        <div className="mt-1 text-[9px] text-zinc-500">Keys while open: A / B set an anchor here · ⇧A / ⇧B clear · ⇧C clear both</div>
        <div className="mt-1.5">
          <Segmented
            label="Labels"
            value={m.labels}
            onChange={m.setLabels}
            options={[{ value: 'active', label: 'Active segment' }, { value: 'all', label: 'All segments' }]}
          />
        </div>
      </SheetSection>
      <SheetSection label={`Gaps · ${m.gaps.length} found`}>
        {m.gaps.length === 0 ? (
          <div className="text-[10px] text-zinc-500">No empty slices between painted ones.</div>
        ) : (
          <ul className="space-y-0.5" data-testid="gap-table">
            {m.gaps.map((g) => (
              <li key={`${g.segmentIndex}-${g.from}`} className="flex items-center gap-2 text-[10px] text-zinc-300" data-testid={`gap-${g.from}-${g.to}`}>
                <span className="flex-1 truncate">
                  {g.name} · {g.from === g.to ? `slice ${g.from + 1}` : `slices ${g.from + 1}–${g.to + 1}`}
                  <span className="text-zinc-500"> ({g.to - g.from + 1})</span>
                </span>
                <button
                  type="button"
                  aria-label={`Preview gap ${g.from + 1}–${g.to + 1} of ${g.name}`}
                  onClick={() => m.previewGap(g.from + 1, g.to + 1)}
                  className="rounded bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700"
                >
                  Preview gap
                </button>
              </li>
            ))}
          </ul>
        )}
      </SheetSection>
    </OperationSheet>
  );
}
