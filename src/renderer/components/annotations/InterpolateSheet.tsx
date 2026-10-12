/**
 * Interpolate (SegWorks #152–168). Presentational; everything from useInterpolateSheet.
 * Rendered as the open operation of the Operations section, in its compact row style.
 * Gaps are listed in the viewport's slice numbers; each can be previewed on its own. The
 * gap table updates while the user paints with the operation open.
 */
import type { InterpolateSheetModel } from '../../hooks/useInterpolateSheet';
import { OperationBody, OperationRow, PreviewCommitButtons, Segmented } from './OperationsSection';

export default function InterpolateSheet({ m }: { m: InterpolateSheetModel }) {
  if (!m.open) return null;
  const s = m.settings;
  const method = m.methods.find((x) => x.id === s.method);
  const canCommit = !!m.target && !m.target.locked && !m.previewReadOnly;
  return (
    <OperationBody
      testId="interpolate-sheet"
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
      <OperationRow label="Method">
        <select
          aria-label="Interpolation method"
          value={s.method}
          onChange={(e) => m.set({ method: e.target.value as typeof s.method })}
          className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[11px]"
        >
          {m.methods.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </OperationRow>
      <div className="flex items-start gap-2 mt-1 text-[10px]">
        <span className="flex-1 min-w-0 text-zinc-500 truncate" title={method?.hint}>{method?.hint}</span>
        <button type="button" onClick={m.toggleAdvanced} aria-expanded={m.advancedOpen} className="text-zinc-400 hover:text-zinc-200 whitespace-nowrap">
          {m.advancedOpen ? '▾' : '▸'} Advanced
        </button>
      </div>
      {m.advancedOpen && (
        <OperationRow label="Distance transform">
          <select
            aria-label="Distance transform"
            value={s.distance}
            onChange={(e) => m.set({ distance: e.target.value as 'exact' | 'chamfer' })}
            className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
          >
            <option value="exact">Exact Euclidean</option>
            <option value="chamfer">Chamfer (faster)</option>
          </select>
        </OperationRow>
      )}
      <OperationRow label="Fill">
        <Segmented
          label="Fill"
          className="flex-[3]"
          value={s.fill}
          onChange={(fill) => m.set({ fill })}
          options={[{ value: 'gaps', label: 'All gaps' }, { value: 'current', label: 'This slice' }, { value: 'anchors', label: 'A → B' }]}
        />
        <Segmented
          label="Labels"
          className="flex-[2]"
          value={m.labels}
          onChange={m.setLabels}
          options={[{ value: 'active', label: 'Active', ariaLabel: 'Active segment' }, { value: 'all', label: 'All', ariaLabel: 'All segments' }]}
        />
      </OperationRow>
      {s.fill === 'anchors' && (
        <OperationRow label="Anchors" title="⌥A / ⌥B set an anchor at the slice on screen · ⌥⇧A / ⌥⇧B clear it · ⌥⇧C clears both">
          <span className="flex items-center gap-1.5" data-testid="interp-anchors">
            <span className="text-amber-300 font-semibold">A</span>
            <span className="tabular-nums w-6" data-testid="anchor-a">{s.anchorA ?? '—'}</span>
            <button type="button" onClick={() => m.setAnchorHere('A')} className="rounded bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700">Set A</button>
            <span className="text-amber-300 font-semibold ml-1">B</span>
            <span className="tabular-nums w-6" data-testid="anchor-b">{s.anchorB ?? '—'}</span>
            <button type="button" onClick={() => m.setAnchorHere('B')} className="rounded bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700">Set B</button>
          </span>
        </OperationRow>
      )}
      <div className="mt-2 text-[9px] text-zinc-500 uppercase tracking-wide">Gaps · {m.gaps.length} found</div>
      {m.gaps.length === 0 ? (
        <div className="mt-0.5 text-[10px] text-zinc-500">No empty slices between painted ones.</div>
      ) : (
        <ul className="mt-0.5 space-y-0.5" data-testid="gap-table">
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
    </OperationBody>
  );
}
