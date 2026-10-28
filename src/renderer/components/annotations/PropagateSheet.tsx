/**
 * Propagate (SegWorks #169–181). Presentational; everything from usePropagateSheet.
 * Rendered as the open operation of the Operations section, in its compact row style.
 */
import type { PropagateSheetModel } from '../../hooks/usePropagateSheet';
import { MoreToggle, OperationBody, OperationRow, PreviewCommitButtons, Segmented, differsFrom } from './OperationsSection';
import { PROPAGATE_DEFAULTS } from '../../stores/operationSheetStore';

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

export default function PropagateSheet({ m }: { m: PropagateSheetModel }) {
  if (!m.open) return null;
  const s = m.settings;
  const canCommit = !!m.target && !m.target.locked && !m.previewReadOnly;
  return (
    <OperationBody
      testId="propagate-sheet"
      message={m.message}
      confirm={m.confirmingLeave ? { text: 'Discard the preview?', confirmLabel: 'Discard', onConfirm: m.confirmLeave, onCancel: m.cancelLeave } : null}
      footer={(
        <PreviewCommitButtons
          onPreview={m.preview}
          onCommit={m.commit}
          onDiscard={m.discard}
          canPreview={!!m.target}
          canCommit={canCommit}
          previewActive={m.previewActive}
        />
      )}
    >
      <OperationRow label="From this slice">
        <Segmented
          label="Direction"
          className="flex-1"
          value={s.direction}
          onChange={(direction) => m.set({ direction })}
          options={[{ value: 'backward', label: '← Backward' }, { value: 'both', label: 'Both' }, { value: 'forward', label: 'Forward →' }]}
        />
      </OperationRow>
      <Slider label="Up to" min={1} max={200} step={1} value={s.maxSlices} unit="slices" onChange={(v) => m.set({ maxSlices: v })} />
      <OperationRow label="Image">
        <select
          aria-label="Intensity model"
          value={m.modality}
          onChange={(e) => m.set({ modality: e.target.value as 'ct' | 'mr' })}
          className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
        >
          <option value="ct">CT — tolerance in HU</option>
          <option value="mr">MR — tolerance in σ</option>
        </select>
      </OperationRow>
      {m.modality === 'ct'
        ? <Slider label="Tolerance ±" min={10} max={1000} step={10} value={s.huTolerance} unit="HU" onChange={(v) => m.set({ huTolerance: v })} />
        : <Slider label="Tolerance ±" min={0.5} max={5} step={0.1} value={s.sigma} unit="σ" onChange={(v) => m.set({ sigma: v })} />}
      <div className="flex justify-end mt-1 text-[10px]">
        <MoreToggle open={m.advancedOpen} onToggle={m.toggleAdvanced} changed={differsFrom(s, PROPAGATE_DEFAULTS, ['stable', 'growPx', 'maxAreaChangePct', 'fillHoles', 'edgeGuard', 'zSmoothing'])} />
      </div>
      {m.advancedOpen && (
        <>
          <Check label="Stable reference (median of the start slice)" checked={s.stable} onChange={(v) => m.set({ stable: v })} />
          <Slider label="Max growth per slice (0 = no limit)" min={0} max={20} step={1} value={s.growPx} unit="px" onChange={(v) => m.set({ growPx: v })} />
          <Slider label="Stop if area changes by" min={10} max={300} step={5} value={s.maxAreaChangePct} unit="%" onChange={(v) => m.set({ maxAreaChangePct: v })} />
          <Check label="Fill holes" checked={s.fillHoles} onChange={(v) => m.set({ fillHoles: v })} />
          <Check label="Stop at strong image edges" checked={s.edgeGuard} onChange={(v) => m.set({ edgeGuard: v })} />
          <Check label="Smooth through slices" checked={s.zSmoothing} onChange={(v) => m.set({ zSmoothing: v })} />
        </>
      )}
    </OperationBody>
  );
}
