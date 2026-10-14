/**
 * Cleanup (SegWorks #182–205): pick an operation, set its parameters and scope,
 * Preview → ⏎ / Commit. Presentational; everything comes from useCleanupSheet. Rendered
 * as the open operation of the Operations section, in the toolbox Controls strip's compact
 * row style (a label, then the control), so the common operations fit without scrolling.
 */
import type { CleanupSheetModel, ParamSpec } from '../../hooks/useCleanupSheet';
import { OperationBody, OperationRow, PreviewCommitButtons, Segmented } from './OperationsSection';
import { OperationParam as Param } from './OperationParams';


export default function CleanupSheet({ m }: { m: CleanupSheetModel }) {
  if (!m.open) return null;
  const basic = m.op.params.filter((p) => !p.advanced);
  const advanced = m.op.params.filter((p) => p.advanced);
  // A pair operation's commit depends on what it writes (its preview says read-only if that is
  // locked) — not on the active segment, which Copy into and Magnet bridge only read.
  const canCommit = !!m.target && (m.isPair || !m.target.locked) && !m.previewReadOnly;
  const param = (spec: ParamSpec) => (
    <Param key={spec.key} spec={spec} value={m.params[spec.key]} onChange={(v) => m.setParam(spec.key, v as number | string)} /> // Cleanup has no boolean parameters
  );
  return (
    <OperationBody
      testId="cleanup-sheet"
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
          commitTitle={m.target?.locked ? `${m.target.name} is locked` : undefined}
        />
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
            <input type="checkbox" checked={m.smart.protect} onChange={(e) => m.smart.setProtect(e.target.checked)} />
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
