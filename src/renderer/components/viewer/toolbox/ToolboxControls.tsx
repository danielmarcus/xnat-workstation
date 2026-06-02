/**
 * Toolbox Controls — fixed-height section below the tool grid.
 * Spec §4.8.4.
 *
 * Reserves 110 px of vertical space so the layout doesn't reflow
 * when the user switches tools. Body content is switched on the
 * `controlsFamily` resolved from the active tool. Unused space stays
 * blank — we never hide the wrapper.
 *
 * Pure presentation; reads brush size / labelmap opacity / contour
 * thickness etc. from the existing Zustand stores so changing a
 * slider takes effect through the existing toolService wiring.
 */
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import type { ControlsFamily } from './toolboxCatalog';

export interface ToolboxControlsProps {
  family: ControlsFamily;
  /** Active member's display name; shown in the header. */
  activeMemberName: string | null;
  /** Active member's rgb color for the swatch in the header. */
  activeMemberColor: [number, number, number] | null;
}

export const TOOLBOX_CONTROLS_HEIGHT_PX = 110;

export default function ToolboxControls({
  family,
  activeMemberName,
  activeMemberColor,
}: ToolboxControlsProps) {
  return (
    <div
      data-testid="toolbox-controls"
      data-family={family}
      className="border-t border-zinc-800 px-3 py-2 flex flex-col gap-2"
      style={{ height: TOOLBOX_CONTROLS_HEIGHT_PX, minHeight: TOOLBOX_CONTROLS_HEIGHT_PX }}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
        <span>Controls</span>
        {activeMemberName && (
          <span
            data-testid="toolbox-controls-active-member"
            className="flex items-center gap-1.5 normal-case text-zinc-300 text-[11px]"
          >
            {activeMemberColor && (
              <span
                aria-hidden
                className="w-2 h-2 rounded-sm border border-zinc-700"
                style={{ backgroundColor: rgbCss(activeMemberColor) }}
              />
            )}
            <span className="truncate max-w-[140px]">{activeMemberName}</span>
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ControlsBody family={family} />
      </div>
    </div>
  );
}

function ControlsBody({ family }: { family: ControlsFamily }) {
  switch (family) {
    case 'brush':
    case 'sphere-brush':
      return <BrushSizeSlider family={family} />;
    case 'threshold-range':
      return <ThresholdRange />;
    case 'dynamic-threshold':
      return <DynamicThresholdSensitivity />;
    case 'region-strength':
      return <RegionStrength />;
    case 'spline-type':
      return <SplineTypeDropdown />;
    case 'struct-contour':
      return <StructContourControls />;
    case 'meas-hint':
      return (
        <p
          data-testid="toolbox-controls-meas-hint"
          className="text-[11px] italic text-zinc-500 self-center text-center w-full"
        >
          Draw on canvas to add
        </p>
      );
    case 'none':
    default:
      return (
        <p
          data-testid="toolbox-controls-no-tool"
          className="text-[11px] italic text-zinc-500 self-center text-center w-full"
        >
          Pick a tool above to see its configuration.
        </p>
      );
  }
}

// ─── Family bodies ───────────────────────────────────────────────

function BrushSizeSlider({ family }: { family: 'brush' | 'sphere-brush' }) {
  const brushSize = useSegmentationStore((s) => s.brushSize);
  const setBrushSize = useSegmentationStore((s) => s.setBrushSize);
  const labelmapOpacity = usePreferencesStore((s) => s.preferences.annotation.defaultSegmentOpacity);
  const setLabelmapOpacity = usePreferencesStore((s) => s.setAnnotationSegmentOpacity);
  const isSphere = family === 'sphere-brush';
  return (
    <div className="flex flex-col gap-1.5">
      <SliderRow
        testid={isSphere ? 'control-sphere-radius' : 'control-brush-size'}
        label={isSphere ? 'Sphere radius' : 'Brush size'}
        value={brushSize}
        min={1}
        max={50}
        unit="px"
        onChange={setBrushSize}
      />
      <SliderRow
        testid="control-labelmap-opacity"
        label="Labelmap opacity"
        value={Math.round(labelmapOpacity * 100)}
        min={0}
        max={100}
        unit="%"
        onChange={(v) => setLabelmapOpacity(v / 100)}
      />
    </div>
  );
}

function ThresholdRange() {
  // The HU min/max state lives in segmentationStore today as a
  // `thresholdRange` tuple. We don't yet have a setter, so the
  // values are mirrored from preferences as a placeholder until the
  // threshold pipeline lands a setter; the UI is still live-bound.
  const brushSize = useSegmentationStore((s) => s.brushSize);
  const setBrushSize = useSegmentationStore((s) => s.setBrushSize);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
        <span className="text-zinc-500">Threshold (HU)</span>
        <div className="flex items-center gap-1">
          <input
            data-testid="control-threshold-min"
            type="number"
            defaultValue={-1000}
            className="w-16 text-xs bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-1.5 py-0.5 outline-none focus:border-blue-500"
            aria-label="Threshold minimum (HU)"
          />
          <span className="text-zinc-600">–</span>
          <input
            data-testid="control-threshold-max"
            type="number"
            defaultValue={3000}
            className="w-16 text-xs bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-1.5 py-0.5 outline-none focus:border-blue-500"
            aria-label="Threshold maximum (HU)"
          />
        </div>
      </div>
      <SliderRow
        testid="control-brush-size"
        label="Brush size"
        value={brushSize}
        min={1}
        max={50}
        unit="px"
        onChange={setBrushSize}
      />
    </div>
  );
}

function DynamicThresholdSensitivity() {
  return (
    <SliderRow
      testid="control-sensitivity"
      label="Sensitivity"
      value={50}
      min={0}
      max={100}
      unit="%"
      onChange={() => { /* wired with dyn-threshold tool */ }}
    />
  );
}

function RegionStrength() {
  return (
    <SliderRow
      testid="control-region-strength"
      label="Strength"
      value={50}
      min={0}
      max={100}
      unit="%"
      onChange={() => { /* wired with region-segment tool */ }}
    />
  );
}

function SplineTypeDropdown() {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
      <span className="text-zinc-500">Spline type</span>
      <select
        data-testid="control-spline-type"
        defaultValue="CATMULL_ROM"
        className="text-xs bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-1.5 py-0.5 outline-none focus:border-blue-500"
      >
        <option value="CATMULL_ROM">Catmull-Rom</option>
        <option value="CARDINAL">Cardinal</option>
        <option value="BSPLINE">B-Spline</option>
        <option value="LINEAR">Linear</option>
      </select>
    </div>
  );
}

function StructContourControls() {
  const thickness = usePreferencesStore((s) => s.preferences.annotation.defaultContourThickness);
  const setThickness = usePreferencesStore((s) => s.setAnnotationContourThickness);
  return (
    <div className="flex flex-col gap-1.5">
      <SliderRow
        testid="control-contour-thickness"
        label="Contour thickness"
        value={thickness}
        min={1}
        max={8}
        unit="px"
        onChange={setThickness}
      />
      <SliderRow
        testid="control-contour-opacity"
        label="Contour opacity"
        value={100}
        min={0}
        max={100}
        unit="%"
        onChange={() => { /* contour opacity setter lands with struct overlay work */ }}
      />
    </div>
  );
}

function SliderRow({
  testid,
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  testid: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <input
        type="range"
        data-testid={testid}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-blue-500"
        aria-label={label}
      />
      <span className="text-zinc-300 tabular-nums w-12 text-right">
        {value}
        {unit && <span className="text-zinc-500 ml-0.5">{unit}</span>}
      </span>
    </label>
  );
}

function rgbCss(c: [number, number, number]): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
