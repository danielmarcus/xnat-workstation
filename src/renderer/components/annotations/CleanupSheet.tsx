/**
 * Cleanup (SegWorks #182–205): pick an operation, set its parameters and scope,
 * Preview → ⏎ / Commit. Presentational; everything comes from useCleanupSheet. Rendered
 * as the open operation of the Operations section, in the toolbox Controls strip's compact
 * row style (a label, then the control), so the common operations fit without scrolling.
 */
import type { CleanupSheetModel, ParamSpec } from '../../hooks/useCleanupSheet';
import { OperationBody, OperationRow } from './OperationsSection';

function Segmented<T extends string>({ value, options, onChange, label, className = '' }: {
  value: T;
  options: Array<{ value: T; label: string; ariaLabel?: string }>;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`flex rounded overflow-hidden border border-zinc-700 ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={o.ariaLabel}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 px-1.5 py-0.5 text-[10px] whitespace-nowrap ${value === o.value ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
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
      <OperationRow label={spec.label} title={spec.hint}>
        <select
          aria-label={spec.label}
          value={String(value)}
          onChange={(e) => { onChange(e.target.value); onDone(); }}
          className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
        >
          {spec.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </OperationRow>
    );
  }
  return (
    <OperationRow label={spec.label} title={spec.hint}>
      <input
        type="range"
        aria-label={spec.label}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={Number(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onDone}
        className="flex-1 min-w-0 accent-blue-500"
      />
      <span className="text-zinc-300 tabular-nums whitespace-nowrap">
        {Number(value)}{spec.unit ? ` ${spec.unit}` : ''}
      </span>
    </OperationRow>
  );
}

export default function CleanupSheet({ m }: { m: CleanupSheetModel }) {
  if (!m.open) return null;
  const basic = m.op.params.filter((p) => !p.advanced);
  const advanced = m.op.params.filter((p) => p.advanced);
  const canCommit = !!m.target && !m.target.locked && !m.previewReadOnly;
  const param = (spec: ParamSpec) => (
    <Param key={spec.key} spec={spec} value={m.params[spec.key]} onChange={(v) => m.setParam(spec.key, v)} onDone={m.releaseFocus} />
  );
  return (
    <OperationBody
      testId="cleanup-sheet"
      message={m.message}
      confirm={m.confirmingLeave ? { text: 'Discard the preview?', confirmLabel: 'Discard', onConfirm: m.confirmLeave, onCancel: m.cancelLeave } : null}
      footer={(
        <>
          <button
            type="button"
            onClick={m.preview}
            disabled={!m.target}
            className="rounded bg-zinc-700 px-2.5 py-0.5 text-[10px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-40"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={m.commit}
            disabled={!canCommit}
            title={m.target?.locked ? `${m.target.name} is locked` : undefined}
            className="rounded bg-blue-600 px-2.5 py-0.5 text-[10px] text-white hover:bg-blue-500 disabled:opacity-40"
          >
            Commit
          </button>
          <button
            type="button"
            onClick={m.discard}
            disabled={!m.previewActive}
            className="rounded bg-zinc-800 px-2.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
          >
            Discard
          </button>
        </>
      )}
    >
      <OperationRow label="Operation">
        <select
          aria-label="Cleanup operation"
          value={m.op.id}
          onChange={(e) => m.selectOp(e.target.value)}
          className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[11px]"
        >
          <optgroup label="Clean">
            {m.ops.filter((o) => o.group === 'clean').map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </optgroup>
          <optgroup label="Segments">
            {m.ops.filter((o) => o.group === 'segments').map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </optgroup>
        </select>
      </OperationRow>
      <div className="flex items-start gap-2 mt-1 text-[10px]">
        <span className="flex-1 min-w-0 text-zinc-500 truncate" title={m.op.description}>{m.op.description}</span>
        {advanced.length > 0 && (
          <button
            type="button"
            onClick={m.toggleAdvanced}
            aria-expanded={m.advancedOpen}
            className="text-zinc-400 hover:text-zinc-200 whitespace-nowrap"
          >
            {m.advancedOpen ? '▾' : '▸'} Advanced
          </button>
        )}
      </div>
      {m.isPair && (
        <OperationRow label="Into">
          <select
            aria-label="Into segment"
            value={m.into ?? ''}
            disabled={m.intoOptions.length === 0}
            onChange={(e) => m.setInto(Number(e.target.value))}
            className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
          >
            {m.intoOptions.length === 0 && <option value="">No other segment</option>}
            {m.intoOptions.map((o) => <option key={o.segmentIndex} value={o.segmentIndex}>{o.name}</option>)}
          </select>
        </OperationRow>
      )}
      {basic.map(param)}
      {m.advancedOpen && advanced.map(param)}
      <OperationRow label="Scope">
        <Segmented
          label="Slices"
          className="flex-[3]"
          value={m.scope.slices}
          onChange={(v) => m.setScope({ slices: v })}
          options={[{ value: 'current', label: 'Slice' }, { value: 'range', label: 'Range' }, { value: 'volume', label: 'Volume' }]}
        />
        {!m.isPair && (
          <Segmented
            label="Labels"
            className="flex-[2]"
            value={m.scope.labels}
            onChange={(v) => m.setScope({ labels: v })}
            options={[{ value: 'active', label: 'Active', ariaLabel: 'Active segment' }, { value: 'all', label: 'All', ariaLabel: 'All segments' }]}
          />
        )}
      </OperationRow>
      {m.scope.slices === 'range' && (
        <OperationRow label="Slices">
          <input
            type="number"
            aria-label="Range from"
            min={1}
            max={m.sliceTotal || undefined}
            value={m.scope.from}
            onChange={(e) => m.setScope({ from: Number(e.target.value) })}
            className="w-12 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 tabular-nums"
          />
          <span>–</span>
          <input
            type="number"
            aria-label="Range to"
            min={1}
            max={m.sliceTotal || undefined}
            value={m.scope.to}
            onChange={(e) => m.setScope({ to: Number(e.target.value) })}
            className="w-12 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 tabular-nums"
          />
          <span className="text-zinc-500">of {m.sliceTotal}</span>
        </OperationRow>
      )}
      {m.smart.visible && (
        <div className="mt-2">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wide mb-1">Per-segment plan</div>
          <label className="flex items-center gap-2 text-[10px] text-zinc-300">
            <input type="checkbox" checked={m.smart.protect} onChange={(e) => { m.smart.setProtect(e.target.checked); m.releaseFocus(); }} />
            Protect small and thin segments
          </label>
          {m.smart.protect && (
            <>
              <OperationRow label="Protected segments get">
                <select
                  aria-label="Protected segments get"
                  value={m.smart.safeAction}
                  onChange={(e) => m.smart.setSafeAction(e.target.value)}
                  className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
                >
                  <option value="skip">Skip</option>
                  <option value="median">Median smooth</option>
                </select>
              </OperationRow>
              <table className="w-full mt-1.5 text-[10px]" data-testid="smart-plan">
                <tbody>
                  {m.smart.entries.map((e) => (
                    <tr key={e.segmentIndex} data-testid={`smart-plan-row-${e.segmentIndex}`} className="border-t border-zinc-800/70">
                      <td className="py-0.5 text-zinc-200 truncate max-w-[90px]">{e.name}</td>
                      <td className="py-0.5 text-zinc-500 tabular-nums text-right pr-1">{e.voxels.toLocaleString('en-US')}</td>
                      <td className="py-0.5">
                        {e.small && <span className="mr-1 rounded border border-amber-600/60 px-1 text-amber-300">small</span>}
                        {e.thin && <span className="rounded border border-amber-600/60 px-1 text-amber-300">thin</span>}
                      </td>
                      <td className="py-0.5 text-right">
                        <select
                          aria-label={`Action for ${e.name}`}
                          value={e.action}
                          disabled={e.voxels === 0}
                          onChange={(ev) => m.smart.setAction(e.segmentIndex, ev.target.value)}
                          className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
                        >
                          {m.smart.actionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </OperationBody>
  );
}
