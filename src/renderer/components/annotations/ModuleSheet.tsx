/**
 * A module's operation (SegWorks parity branch 9, M4). Presentational; everything from
 * useModuleSheet. Its parameters are rendered by the same control as Cleanup's.
 */
import type { ModuleSheetModel } from '../../hooks/useModuleSheet';
import { OperationBody, OperationRow, Segmented } from './OperationsSection';
import { OperationParam } from './OperationParams';

const BTN = 'rounded px-2.5 py-0.5 text-[10px] disabled:opacity-40';
const BADGE = {
  bundled: { label: 'Bundled', className: 'bg-zinc-700 text-zinc-200' },
  verified: { label: 'Verified', className: 'bg-emerald-900/70 text-emerald-200' },
  community: { label: 'Community', className: 'bg-amber-900/70 text-amber-200' },
} as const;

export default function ModuleSheet({ m }: { m: ModuleSheetModel }) {
  if (!m.open || !m.manifest || !m.summary) return null;
  const mf = m.manifest;
  const basic = mf.params.filter((p) => !p.advanced);
  const advanced = mf.params.filter((p) => p.advanced);
  const canRun = !!m.target && !m.running && m.estimate?.level !== 'block' && !m.domainProblem;
  const param = (p: (typeof mf.params)[number]) => <OperationParam key={p.key} spec={p} value={m.values[p.key]} onChange={(v) => m.setParam(p.key, v)} />;
  return (
    <OperationBody
      testId="module-sheet"
      message={m.message}
      confirm={m.confirmingLeave ? { text: 'Discard the preview?', confirmLabel: 'Discard', onConfirm: m.confirmLeave, onCancel: m.cancelLeave } : null}
      footer={m.running ? (
        <button type="button" onClick={m.cancel} className={`${BTN} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}>Cancel run</button>
      ) : (
        <>
          <button type="button" onClick={m.preview} disabled={!canRun} className={`${BTN} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}>Run</button>
          <button type="button" onClick={m.commit} disabled={m.previewActive ? m.previewReadOnly : !canRun || !!m.target?.locked} className={`${BTN} bg-blue-600 text-white hover:bg-blue-500`}>Commit</button>
          <button type="button" onClick={m.discard} disabled={!m.previewActive} className={`${BTN} bg-zinc-800 text-zinc-300 hover:bg-zinc-700`}>Discard</button>
        </>
      )}
    >
      <div className="flex items-center gap-2 text-[10px]">
        <span className={`px-1.5 py-0.5 rounded ${BADGE[m.summary.tier].className}`} data-testid="module-tier">{BADGE[m.summary.tier].label}</span>
        <span className="text-zinc-400 truncate" title={mf.description}>{mf.publisher} · {mf.version}</span>
      </div>
      <div className="mt-1 text-[10px] text-zinc-500 line-clamp-2" title={mf.description}>{mf.description}</div>
      {basic.map(param)}
      {mf.scopes.length > 1 && (
        <OperationRow label="Scope">
          <Segmented label="Scope" className="flex-1" value={m.scope.kind} onChange={(kind) => m.setScope({ ...m.scope, kind })} options={m.scopes} />
        </OperationRow>
      )}
      {m.scope.kind === 'range' && (
        <OperationRow label="Slices">
          <input type="number" aria-label="From slice" value={m.scope.from ?? ''} onChange={(e) => m.setScope({ ...m.scope, from: Number(e.target.value) })} className="w-14 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]" />
          <span>to</span>
          <input type="number" aria-label="To slice" value={m.scope.to ?? ''} onChange={(e) => m.setScope({ ...m.scope, to: Number(e.target.value) })} className="w-14 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]" />
        </OperationRow>
      )}
      <div
        data-testid="module-estimate"
        data-level={m.estimate?.level ?? 'none'}
        className={`mt-1 text-[10px] ${m.estimate?.level === 'block' ? 'text-red-400' : m.estimate?.level === 'warn' ? 'text-amber-300' : 'text-zinc-500'}`}
      >
        {m.domainProblem ?? (m.estimate ? `${m.estimate.text}${m.estimate.reason ? ` — ${m.estimate.reason}` : ''}` : '')}
      </div>
      {advanced.length > 0 && (
        <div className="flex justify-end mt-1 text-[10px]">
          <button type="button" onClick={m.toggleAdvanced} aria-expanded={m.advancedOpen} className="text-zinc-400 hover:text-zinc-200 whitespace-nowrap">
            {m.advancedOpen ? '▾' : '▸'} Advanced
          </button>
        </div>
      )}
      {m.advancedOpen && advanced.map(param)}
      {m.table && (
        <div className="mt-1.5 overflow-x-auto" data-testid="module-table">
          <table className="text-[10px] text-zinc-300">
            <thead><tr>{m.table.columns.map((c) => <th key={c} className="px-1 text-left text-zinc-500 font-normal">{c}</th>)}</tr></thead>
            <tbody>{m.table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="px-1 tabular-nums">{String(v)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-2 mt-1.5 text-[10px]">
        <button type="button" onClick={m.toggleLog} aria-expanded={m.logOpen} className="text-zinc-400 hover:text-zinc-200">
          {m.logOpen ? '▾' : '▸'} Log ({m.logs.length})
        </button>
        {m.logOpen && (
          <>
            <button type="button" onClick={m.copyLog} disabled={!m.logs.length} className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40">Copy</button>
            <button type="button" onClick={m.downloadLog} disabled={!m.logs.length} className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40">Download</button>
          </>
        )}
      </div>
      {m.logOpen && (
        <pre data-testid="module-log" className="mt-1 max-h-24 overflow-auto rounded bg-zinc-950 p-1.5 text-[10px] leading-tight whitespace-pre-wrap">
          {m.logs.map((l, i) => <div key={i} className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-300' : 'text-zinc-400'}>{l.text}</div>)}
        </pre>
      )}
    </OperationBody>
  );
}
