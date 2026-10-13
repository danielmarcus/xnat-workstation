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

export default function ContourToolControls({ toolId, m }: { toolId: string; m: ContourToolSettingsModel }) {
  if (toolId === 'livewire') return <LivewireControls m={m} />;
  return null;
}
