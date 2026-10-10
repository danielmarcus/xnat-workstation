/**
 * The Smart-tab tools' rows in the toolbox's Controls strip (SegWorks parity branch 4):
 * Level Trace's band / growth / edge guard / smoothing, Smart Brush's radius, tolerance and
 * spacing, Random Walker's β, seed size, Run and Clear seeds, and the ROI limit's Clear.
 */
import type { ReactNode } from 'react';
import type { SemiAutoControlsModel } from '../../hooks/useSemiAutoControls';

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-center gap-2 mt-1.5" data-testid={testId}>
      <span className="text-[10px] text-zinc-400 whitespace-nowrap w-20 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <Row label={label}>
      <input
        type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 accent-blue-500"
      />
      <span className="text-[10px] text-zinc-300 whitespace-nowrap w-12 text-right">{value}{unit}</span>
    </Row>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <div className="flex flex-1 rounded overflow-hidden border border-zinc-700" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
            className={`flex-1 text-[10px] py-0.5 ${value === v ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
          >
            {text}
          </button>
        ))}
      </div>
    </Row>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-zinc-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-blue-500" />
      {label}
    </label>
  );
}

const BUTTON = 'text-[10px] px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800';

function RoiChip({ m }: { m: SemiAutoControlsModel }) {
  if (!m.roiHere) return null;
  return (
    <Row label="ROI limit" testId="roi-limit-chip">
      <span className="text-[10px] text-amber-300 flex-1">On — results stay inside it</span>
      <button type="button" className={BUTTON} onClick={m.clearRoi}>Clear</button>
    </Row>
  );
}

export default function SmartToolControls({ toolId, m }: { toolId: string; m: SemiAutoControlsModel }) {
  const lt = m.levelTrace;
  const body = (() => {
    switch (toolId) {
      case 'levelTrace':
        return (
          <>
            <Segmented label="Band" value={lt.modality ?? 'auto'} options={[['auto', 'From scan'], ['ct', 'CT (HU)'], ['mr', 'MR (σ)']]}
              onChange={(v) => m.setLevelTrace({ modality: v === 'auto' ? null : v })} />
            {lt.modality !== 'mr' && (
              <Slider label="HU tolerance" value={lt.huTolerance} min={10} max={400} step={10} unit=" HU" onChange={(v) => m.setLevelTrace({ huTolerance: v })} />
            )}
            {lt.modality !== 'ct' && (
              <>
                <Slider label="Band width" value={lt.sigmaK} min={0.5} max={5} step={0.1} unit=" σ" onChange={(v) => m.setLevelTrace({ sigmaK: v })} />
                <Segmented label="Sample" value={String(lt.window) as '7' | '11' | '15'} options={[['7', '7×7'], ['11', '11×11'], ['15', '15×15']]}
                  onChange={(v) => m.setLevelTrace({ window: Number(v) as 7 | 11 | 15 })} />
              </>
            )}
            <Segmented label="Growth" value={lt.growth} options={[['binary', 'Binary'], ['fuzzy', 'Fuzzy']]} onChange={(v) => m.setLevelTrace({ growth: v })} />
            {lt.growth === 'fuzzy' && (
              <Slider label="Affinity" value={lt.fuzzyThreshold} min={0.1} max={0.9} step={0.05} unit="" onChange={(v) => m.setLevelTrace({ fuzzyThreshold: v })} />
            )}
            <Segmented label="Edge guard" value={lt.edgeGuard} options={[['off', 'Off'], ['gentle', 'Gentle'], ['strong', 'Strong']]} onChange={(v) => m.setLevelTrace({ edgeGuard: v })} />
            {lt.edgeGuard !== 'off' && (
              <>
                <Segmented label="Operator" value={lt.edgeOperator} options={[['sobel', 'Sobel'], ['scharr', 'Scharr']]} onChange={(v) => m.setLevelTrace({ edgeOperator: v })} />
                <Segmented label="Polarity" value={lt.polarity} options={[['auto', 'Any'], ['darkToLight', 'Dark→light'], ['lightToDark', 'Light→dark']]} onChange={(v) => m.setLevelTrace({ polarity: v })} />
              </>
            )}
            <Segmented label="Smoothing" value={lt.smoothing} options={[['none', 'None'], ['gentle', 'Gentle'], ['standard', 'Std'], ['strong', 'Strong']]} onChange={(v) => m.setLevelTrace({ smoothing: v })} />
            <Slider label="Simplify" value={lt.simplifyPx} min={0} max={5} step={0.5} unit=" px" onChange={(v) => m.setLevelTrace({ simplifyPx: v })} />
            <Slider label="Round corners" value={lt.roundCorners} min={0} max={4} unit="×" onChange={(v) => m.setLevelTrace({ roundCorners: v })} />
            <div className="flex items-center gap-3 mt-1.5 pl-[5.5rem]">
              <Check label="Fill holes" checked={lt.fillHoles} onChange={(v) => m.setLevelTrace({ fillHoles: v })} />
              {lt.modality !== 'mr' && <Check label="Stop at air" checked={lt.airGuard} onChange={(v) => m.setLevelTrace({ airGuard: v })} />}
            </div>
            <RoiChip m={m} />
          </>
        );
      case 'smartBrush':
        return (
          <>
            <Slider label="Radius" value={m.smartBrush.radiusMm} min={1} max={40} unit=" mm" onChange={(v) => m.setSmartBrush({ radiusMm: v })} />
            <Slider label="Tolerance" value={m.smartBrush.tolerance} min={5} max={400} step={5} unit="" onChange={(v) => m.setSmartBrush({ tolerance: v })} />
            <Slider label="Spacing" value={m.smartBrush.spacingPx} min={1} max={10} unit=" px" onChange={(v) => m.setSmartBrush({ spacingPx: v })} />
          </>
        );
      case 'randomWalker':
        return (
          <>
            <Slider label="Edge (β)" value={m.randomWalker.beta} min={10} max={4000} step={10} unit="" onChange={(v) => m.setRandomWalker({ beta: v })} />
            <Slider label="Seed size" value={m.randomWalker.seedRadiusPx} min={0} max={8} unit=" px" onChange={(v) => m.setRandomWalker({ seedRadiusPx: v })} />
            <Row label="Seeds" testId="random-walker-seeds">
              <span className="text-[10px] text-zinc-300 flex-1">
                <span className="text-green-400">{m.seedCounts.fg} fg</span> · <span className="text-red-400">{m.seedCounts.bg} bg</span>
                <span className="text-zinc-500"> · ⇧-drag = bg</span>
              </span>
            </Row>
            <div className="flex items-center gap-2 mt-1.5 pl-[5.5rem]">
              <button type="button" className={BUTTON} disabled={m.running || !m.seedCounts.fg || !m.seedCounts.bg} onClick={m.runRandomWalker}>{m.running ? 'Running…' : 'Run'}</button>
              <button type="button" className={BUTTON} disabled={!m.seedCounts.fg && !m.seedCounts.bg} onClick={m.clearSeeds}>Clear seeds</button>
            </div>
            <RoiChip m={m} />
          </>
        );
      case 'roiLimit':
        return (
          <Row label="ROI limit" testId="roi-limit-controls">
            <span className="text-[10px] text-zinc-300 flex-1">
              {m.roiHere ? 'Drawn — Level Trace, Random Walker and Cleanup stay inside' : m.roiDrawn ? 'Drawn on another viewport' : 'Drag a rectangle on the image'}
            </span>
            <button type="button" className={BUTTON} disabled={!m.roiDrawn} onClick={m.clearRoi}>Clear</button>
          </Row>
        );
      default:
        return null;
    }
  })();
  return (
    <div data-testid="smart-tool-controls" data-tool={toolId}>
      {body}
      {m.message && <div className="mt-1.5 text-[10px] text-amber-300" data-testid="smart-tool-message">{m.message}</div>}
    </div>
  );
}
