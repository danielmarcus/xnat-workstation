/**
 * Cleanup sheet (SegWorks #182–205): pick an operation, set its parameters and scope,
 * Preview → ⏎ / Commit. Presentational; everything comes from useCleanupSheet.
 */
import type { CleanupSheetModel, ParamSpec } from '../../hooks/useCleanupSheet';
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

function Param({ spec, value, onChange, onDone }: { spec: ParamSpec; value: number | string; onChange: (v: number | string) => void; onDone: () => void }) {
  if (spec.kind === 'select') {
    return (
      <label className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400" title={spec.hint}>
        <span className="whitespace-nowrap">{spec.label}</span>
        <select
          aria-label={spec.label}
          value={String(value)}
          onChange={(e) => { onChange(e.target.value); onDone(); }}
          className="flex-1 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
        >
          {spec.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400" title={spec.hint}>
      <span className="whitespace-nowrap">{spec.label}</span>
      <input
        type="range"
        aria-label={spec.label}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={Number(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onDone}
        className="flex-1 accent-blue-500"
      />
      <span className="text-zinc-300 tabular-nums whitespace-nowrap">
        {Number(value)}{spec.unit ? ` ${spec.unit}` : ''}
      </span>
    </label>
  );
}

export default function CleanupSheet({ m }: { m: CleanupSheetModel }) {
  if (!m.open) return null;
  const basic = m.op.params.filter((p) => !p.advanced);
  const advanced = m.op.params.filter((p) => p.advanced);
  const canCommit = !!m.target && !m.target.locked && !m.previewReadOnly;
  return (
    <OperationSheet
      title="Cleanup"
      testId="cleanup-sheet"
      target={m.target}
      onBack={m.back}
      message={m.message}
      advancedOpen={m.advancedOpen}
      onToggleAdvanced={m.toggleAdvanced}
      advanced={advanced.length ? (
        <div className="px-3 py-2 border-b border-zinc-800/70">
          {advanced.map((spec) => (
            <Param key={spec.key} spec={spec} value={m.params[spec.key]} onChange={(v) => m.setParam(spec.key, v)} onDone={m.releaseFocus} />
          ))}
        </div>
      ) : undefined}
      confirm={m.confirmingLeave ? { text: 'Discard the preview?', confirmLabel: 'Discard', onConfirm: m.confirmLeave, onCancel: m.cancelLeave } : null}
      footer={(
        <>
          <button
            type="button"
            onClick={m.preview}
            disabled={!m.target}
            className="rounded bg-zinc-700 px-2.5 py-1 text-[10px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-40"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={m.commit}
            disabled={!canCommit}
            title={m.target?.locked ? `${m.target.name} is locked` : undefined}
            className="rounded bg-blue-600 px-2.5 py-1 text-[10px] text-white hover:bg-blue-500 disabled:opacity-40"
          >
            Commit
          </button>
          <button
            type="button"
            onClick={m.discard}
            disabled={!m.previewActive}
            className="rounded bg-zinc-800 px-2.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
          >
            Discard
          </button>
        </>
      )}
    >
      <SheetSection label="Operation">
        <select
          aria-label="Cleanup operation"
          value={m.op.id}
          onChange={(e) => m.selectOp(e.target.value)}
          className="w-full px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[11px]"
        >
          <optgroup label="Clean">
            {m.ops.filter((o) => o.group === 'clean').map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </optgroup>
          <optgroup label="Segments">
            {m.ops.filter((o) => o.group === 'segments').map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </optgroup>
        </select>
        <div className="mt-1 text-[10px] text-zinc-500">{m.op.description}</div>
        {m.isPair && (
          <label className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-400">
            <span>Into</span>
            <select
              aria-label="Into segment"
              value={m.into ?? ''}
              disabled={m.intoOptions.length === 0}
              onChange={(e) => m.setInto(Number(e.target.value))}
              className="flex-1 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
            >
              {m.intoOptions.length === 0 && <option value="">No other segment</option>}
              {m.intoOptions.map((o) => <option key={o.segmentIndex} value={o.segmentIndex}>{o.name}</option>)}
            </select>
          </label>
        )}
      </SheetSection>
      {basic.length > 0 && (
        <SheetSection label="Parameters">
          {basic.map((spec) => (
            <Param key={spec.key} spec={spec} value={m.params[spec.key]} onChange={(v) => m.setParam(spec.key, v)} onDone={m.releaseFocus} />
          ))}
        </SheetSection>
      )}
      <SheetSection label="Scope">
        <Segmented
          label="Slices"
          value={m.scope.slices}
          onChange={(v) => m.setScope({ slices: v })}
          options={[{ value: 'current', label: 'Slice' }, { value: 'range', label: 'Range' }, { value: 'volume', label: 'Volume' }]}
        />
        {m.scope.slices === 'range' && (
          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-zinc-400">
            <span>Slices</span>
            <input
              type="number"
              aria-label="Range from"
              min={1}
              max={m.sliceTotal || undefined}
              value={m.scope.from}
              onChange={(e) => m.setScope({ from: Number(e.target.value) })}
              className="w-14 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 tabular-nums"
            />
            <span>–</span>
            <input
              type="number"
              aria-label="Range to"
              min={1}
              max={m.sliceTotal || undefined}
              value={m.scope.to}
              onChange={(e) => m.setScope({ to: Number(e.target.value) })}
              className="w-14 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 tabular-nums"
            />
            <span className="text-zinc-500">of {m.sliceTotal}</span>
          </div>
        )}
        {!m.isPair && <div className="mt-1.5">
          <Segmented
            label="Labels"
            value={m.scope.labels}
            onChange={(v) => m.setScope({ labels: v })}
            options={[{ value: 'active', label: 'Active segment' }, { value: 'all', label: 'All segments' }]}
          />
        </div>}
      </SheetSection>
    </OperationSheet>
  );
}
