/**
 * Live Wire and Spline drawing settings in the toolbox's Controls area (SegWorks parity
 * branch 6 — docs/segworks-parity.md §10). Shared by the Structure tools and, from F4,
 * Contour Fill's boundary modes, so both draw the same way. Presentational; everything
 * comes from useContourToolSettings.
 */
import { useState, type ReactNode } from 'react';
import type { ContourToolSettingsModel } from '../../hooks/useContourToolSettings';

function Row({ label, children, testId, title }: { label: string; children: ReactNode; testId?: string; title?: string }) {
  return (
    <div className="flex items-center gap-2 mt-1.5" data-testid={testId} title={title}>
      <span className="text-[10px] text-zinc-400 whitespace-nowrap w-20 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange, title }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; title?: string;
}) {
  return (
    <Row label={label} title={title}>
      <input
        type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 accent-blue-500"
      />
      <span className="text-[10px] text-zinc-300 whitespace-nowrap w-12 text-right tabular-nums">{value}{unit}</span>
    </Row>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange, trailing, title }: {
  label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void; trailing?: ReactNode; title?: string;
}) {
  return (
    <Row label={label} title={title}>
      <div className="flex flex-1 rounded overflow-hidden border border-zinc-700" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
            className={`flex-1 text-[10px] py-0.5 ${value === v ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
          >
            {text}
          </button>
        ))}
      </div>
      {trailing}
    </Row>
  );
}

function LivewireControls({ m }: { m: ContourToolSettingsModel }) {
  const lw = m.livewire;
  const [weightsOpen, setWeightsOpen] = useState(false);
  const advanced = lw.mode === 'advanced';
  return (
    <div data-testid="livewire-controls">
      <Segmented
        label="Edge cost"
        value={lw.mode}
        options={[['basic', 'Basic'], ['advanced', 'Advanced']]}
        onChange={(mode) => m.setLivewire({ mode })}
        title="Basic: Cornerstone's built-in path cost. Advanced: smoothing, Scharr or Sobel gradient, Laplacian and direction cues, weighted below"
        trailing={advanced ? (
          <button type="button" aria-expanded={weightsOpen} onClick={() => setWeightsOpen((v) => !v)} className="text-[10px] text-zinc-400 hover:text-zinc-200 whitespace-nowrap">
            {weightsOpen ? '▾' : '▸'} Weights
          </button>
        ) : undefined}
      />
      {advanced && (
        <Slider label="Edge weight" value={lw.gradientWeight} min={0} max={1} step={0.05} onChange={(v) => m.setLivewire({ gradientWeight: v })}
          title="How strongly edge strength pulls the path" />
      )}
      {advanced && weightsOpen && (
        <>
          <Slider label="Direction" value={lw.directionWeight} min={0} max={1} step={0.05} onChange={(v) => m.setLivewire({ directionWeight: v })}
            title="Penalty for a path that cuts across the local edge direction" />
          <Slider label="Laplacian" value={lw.laplacianWeight} min={0} max={1} step={0.02} onChange={(v) => m.setLivewire({ laplacianWeight: v })}
            title="Pull toward the centre line of an edge (second-derivative zero crossing)" />
          <Slider label="Pre-smooth" value={lw.preSmoothSigma} min={0} max={3} step={0.1} unit=" σ" onChange={(v) => m.setLivewire({ preSmoothSigma: v })}
            title="Gaussian smoothing before edges are measured, so fine texture distracts the path less" />
          <Segmented label="Kernel" value={lw.edgeKernel} options={[['scharr', 'Scharr'], ['sobel', 'Sobel']]} onChange={(edgeKernel) => m.setLivewire({ edgeKernel })} />
        </>
      )}
      <Slider label="Close within" value={lw.closeTolerancePx} min={2} max={30} unit=" px" onChange={(v) => m.setLivewire({ closeTolerancePx: v })}
        title="A click this close to the first anchor closes the contour" />
      <Segmented label="Smooth commit" value={lw.commitSmoothing} options={[[0, 'Off'], [1, '1'], [2, '2'], [3, '3']]} onChange={(commitSmoothing) => m.setLivewire({ commitSmoothing })}
        title="Chaikin corner-cutting passes on the closed contour as it is committed" />
    </div>
  );
}

const BUTTON = 'text-[10px] px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800';
/** The Spline and Slice rows' buttons: tighter than BUTTON, and never wrapping their label. */
const SLICE_BUTTON = 'text-[10px] leading-tight whitespace-nowrap px-1.5 py-px rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800';
const ARROW_BUTTON = 'text-[9px] leading-tight px-1.5 py-px bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800';
const TENSIONED = new Set(['localCR', 'tensionSpline', 'roiActiveSpline']);

function SplineControls({ m }: { m: ContourToolSettingsModel }) {
  const sp = m.spline;
  const [optionsOpen, setOptionsOpen] = useState(false);
  return (
    <div data-testid="spline-controls">
      <Row label="Algorithm" title="Interpolating families pass through every point; Cubic B-spline smooths them; Monotone and Akima avoid overshoot; ROI active pulls the curve onto image edges inside the ROI limit">
        <select
          aria-label="Spline algorithm"
          value={sp.algorithm}
          onChange={(e) => m.setSpline({ algorithm: e.target.value as typeof sp.algorithm })}
          className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
        >
          {m.splineAlgorithms.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          <option value="linear">Linear (polygon)</option>
        </select>
        <button type="button" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((v) => !v)} className="text-[10px] text-zinc-400 hover:text-zinc-200 whitespace-nowrap">
          {optionsOpen ? '▾' : '▸'} Options
        </button>
      </Row>
      {optionsOpen && (
        <>
          <Slider label="Density" value={sp.samplesPerSegment} min={8} max={64} step={2} onChange={(v) => m.setSpline({ samplesPerSegment: v })}
            title="Samples between two control points: smoother curve, slower drawing" />
          {TENSIONED.has(sp.algorithm) && (
            <Slider label="Tension" value={sp.tension} min={0} max={0.95} step={0.01} onChange={(v) => m.setSpline({ tension: v })}
              title="Higher = tighter curve, closer to the straight lines between points" />
          )}
          <Row label="No crossing">
            <label className="flex items-center gap-1 text-[10px] text-zinc-300">
              <input type="checkbox" checked={sp.preventSelfIntersection} onChange={(e) => m.setSpline({ preventSelfIntersection: e.target.checked })} aria-label="Prevent self-intersection" className="accent-blue-500" />
              Refuse a point or drag that makes the curve cross itself
            </label>
          </Row>
          <Row label="Track" title="How Propagate carries the spline to the next slice">
            <select
              aria-label="Propagation track"
              value={sp.propagateTrack}
              onChange={(e) => m.setSpline({ propagateTrack: e.target.value as typeof sp.propagateTrack })}
              className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
            >
              {m.propagateTracks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Row>
        </>
      )}
      <Segmented
        label="Edit"
        value={sp.editMode}
        options={[['global', 'Global'], ['localRoi', 'Local ROI']]}
        onChange={(editMode) => m.setSpline({ editMode })}
        title="Local ROI: points are added and moved only inside the ROI limit (draw one with the Segmentation ROI limit tool)"
        trailing={sp.editMode === 'localRoi' ? (
          <button type="button" className={BUTTON} disabled={!m.roiPresent} onClick={m.fitToRoi} title="Zoom the viewport to the ROI limit">Fit ROI</button>
        ) : undefined}
      />
      <Row label="Spline">
        <button type="button" className={SLICE_BUTTON} onClick={m.undoSplinePoint} title="Remove the last point of the spline being drawn (also Backspace)">Undo point</button>
        <button type="button" className={SLICE_BUTTON} onClick={m.clearSpline} title="Discard the spline being drawn or held (⎋)">Clear</button>
        {m.splineInHand && (
          <button type="button" className={SLICE_BUTTON} onClick={m.commitSpline} title="Commit the spline in hand (⏎) — one undo step">Commit</button>
        )}
      </Row>
      {/* Compact, one line from the default width down to ~300 px: no button wraps its label
          (that doubled the row and made the fixed Controls area scroll), and ◀ ▶ are one pair.
          Narrower still, whole buttons wrap, aligned under the first. */}
      <div className="flex items-start gap-2 mt-1.5" data-testid="spline-slice-row">
        <span className="text-[10px] text-zinc-400 whitespace-nowrap w-20 shrink-0 leading-[18px]">Slice</span>
        <div className="flex flex-wrap items-center gap-1 min-w-0">
        <button type="button" className={SLICE_BUTTON} disabled={!m.canUndoEdit} onClick={m.undoAndEdit} title="Undo the last spline and hold its points again to adjust them">Undo &amp; edit</button>
        <button type="button" className={SLICE_BUTTON} onClick={m.copyNearby} title="Hold the outline from the nearest slice that has one, to adjust it here — nothing is written until ⏎">Copy nearby</button>
        <span className="flex rounded border border-zinc-700 overflow-hidden" role="group" aria-label="Propagate">
          <button type="button" className={ARROW_BUTTON} disabled={m.propagating} onClick={() => m.propagate(-1)} aria-label="Propagate to the previous slice" title="Commit this spline and carry it to the previous slice (track in ▸ Options)">◀</button>
          <button type="button" className={`${ARROW_BUTTON} border-l border-zinc-700`} disabled={m.propagating} onClick={() => m.propagate(1)} aria-label="Propagate to the next slice" title="Commit this spline and carry it to the next slice (track in ▸ Options)">▶</button>
        </span>
        </div>
      </div>
    </div>
  );
}

/** Contour Fill (D3): the boundary is drawn freehand, as a spline or with Live Wire — then filled. */
function ContourFillControls({ m }: { m: ContourToolSettingsModel }) {
  return (
    <div data-testid="contour-fill-controls">
      <Segmented
        label="Boundary"
        value={m.contourFillMode}
        options={m.contourFillModes.map((o) => [o.id, o.label] as [typeof o.id, string])}
        onChange={m.setContourFillMode}
        title="How the outline is drawn (O cycles). Whatever it encloses joins the active segment"
      />
      {m.contourFillMode === 'spline' && <SplineControls m={m} />}
      {m.contourFillMode === 'livewire' && <LivewireControls m={m} />}
    </div>
  );
}

export default function ContourToolControls({ toolId, m }: { toolId: string; m: ContourToolSettingsModel }) {
  if (toolId === 'livewire') return <LivewireControls m={m} />;
  if (toolId === 'spline') return <SplineControls m={m} />;
  if (toolId === 'contourFill') return <ContourFillControls m={m} />;
  return null;
}
