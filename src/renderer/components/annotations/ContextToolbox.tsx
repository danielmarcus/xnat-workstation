/**
 * ContextToolbox (Rebuild Phase 3, R3.6) — the kind-adaptive tool grid (frozen
 * mockup §4; SegWorks parity D2 as amended 2026-10-12). Presentational. Header =
 * "<KIND> tools" + the silent in-place backup status (§3.4 — never a toast/banner) + the
 * active member's name in its kind color. One icon+label grid holding every tool — no
 * tabs — in `columns` columns (icon-only when `compact`). Tool states: active = blue;
 * FoR-disabled = dashed + slash + disabled (D3, supplied at runtime via
 * `disabledToolIds`); otherwise normal. A Controls strip follows (Segmentation: active
 * segment + labelmap opacity + the active tool's settings; Structure: contour thickness +
 * contour opacity). The toolbox never changes height as tools change: the Segmentation
 * Controls area is sized to its tallest tool and the backup status sits in the header.
 * Behaviour injected via callbacks. Operations are not here: they have their own section
 * (OperationsSection, D1).
 */
import type { ReactNode } from 'react';
import type { ContainerKind } from '@shared/types/annotation';
import type { ThresholdPreset } from '@shared/types/viewer';
import { KIND_TOOLS_LABEL, SEG_FAMILIES, familyOf, resolveMode, toolsForKind, type ToolControl, type ToolDef, type ToolFamily } from './toolCatalog';

const KIND_COLOR: Record<ContainerKind, string> = {
  RTSTRUCT: '#ef4444', // member-name color follows the active member's swatch; default red
  SEG: '#ec4899',
  SR: '#eab308',
};

export interface ContextToolboxControls {
  /**
   * Opacity 0–1 of the Structure outline. Omit to hide: the labelmap's opacity is not a
   * tool setting, so it lives in the Segmentation ⋮ menu instead.
   */
  opacity?: number;
  onOpacityChange?: (value: number) => void;
  /** Label of the opacity control. Default "Labelmap opacity". */
  opacityLabel?: string;
  /** Contour outline thickness, px (Structure). Omit to hide. */
  lineWidth?: number;
  onLineWidthChange?: (value: number) => void;
  /** Brush radius in world millimetres (the segmentation brush family). Omit to hide. */
  brushSize?: number;
  onBrushSizeChange?: (value: number) => void;
  /** Voxel radius the dynamic-threshold brush samples around the first click. */
  samplingRadius?: number;
  onSamplingRadiusChange?: (radius: number) => void;
  /**
   * Whether the tool adds to or removes from the segment — shared by the brush and the
   * shape tools, which are one Cornerstone tool apiece with a fill or an erase strategy.
   * There is no third option: the "outside" variants either throw or ignore their own
   * flag. Holding Shift inverts it for the duration of the press, and the cursor follows.
   */
  editMode?: 'fill' | 'erase';
  onEditModeChange?: (mode: 'fill' | 'erase') => void;
  /**
   * Threshold-brush intensity window [min, max] (HU on CT). Rendered only while the
   * threshold brush is the active tool — it has no effect on any other tool. Omit to
   * hide the control.
   */
  thresholdRange?: [number, number];
  onThresholdRangeChange?: (range: [number, number]) => void;
  /** Modality-scoped preset windows offered alongside the numeric inputs. */
  thresholdPresets?: ThresholdPreset[];
}

/**
 * Fixed height of the Controls area, per kind whose controls change with the tool: sized to
 * the tallest tool with its Advanced settings folded (Segmentation: Level Trace with the band
 * "From scan" and an ROI limit drawn, and Random Walker with its Run row, Contour Fill with its Spline boundary; Structure: the
 * Spline), so switching tools never moves the panel. E2E operations-section checks that no tool's controls overflow it.
 * Kinds not listed have the same controls for every tool.
 */
const CONTROLS_HEIGHT: Partial<Record<ContainerKind, number>> = {
  // Segmentation: Contour Fill with the Spline boundary is now the tallest (branch 6 F5's Slice row).
  SEG: 186,
  // Structure: contour thickness + opacity, then the Spline's settings with its Slice row.
  RTSTRUCT: 182,
};
/** On a short window the Controls area may shrink to its header + one row, then scrolls. */
const CONTROLS_MIN_HEIGHT = 54;

const BACKUP_ROW_STYLE: Record<'saving' | 'saved' | 'error', string> = {
  saving: 'text-blue-400',
  saved: 'text-emerald-400/90',
  error: 'text-red-400',
};

function BackupIcon({ kind }: { kind: 'saving' | 'saved' | 'error' }) {
  if (kind === 'saving') {
    return (
      <svg className="animate-spin" viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={3}>
        <circle cx="12" cy="12" r="10" className="opacity-25" />
        <path d="M4 12a8 8 0 018-8" strokeLinecap="round" className="opacity-75" />
      </svg>
    );
  }
  if (kind === 'error') {
    return (
      <svg viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="8" cy="8" r="6" />
        <line x1="8" y1="5" x2="8" y2="9" />
        <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

export interface ContextToolboxProps {
  kind: ContainerKind;
  /** Active member name shown in the header (in its color). */
  activeMemberName: string;
  activeMemberColor?: string;
  activeToolId: string | null;
  /** Tool ids disabled because no FoR-matched viewport exists (D3). */
  disabledToolIds?: string[];
  /**
   * Tools this machine cannot run, each with why — the button is disabled and its tooltip is
   * the reason (e.g. Region / Region+ without WebGPU).
   */
  unavailableTools?: Partial<Record<string, string>>;
  onSelectTool: (toolId: string) => void;
  /** Icon-only when the panel is narrow. */
  compact?: boolean;
  /** Grid columns: 4 at the default width and wider, 3 when narrower. Default 3. */
  columns?: 3 | 4;
  /** SEG-only controls strip. */
  controls?: ContextToolboxControls;
  /**
   * Silent in-place local-backup status text, e.g. "Backed up · 2s ago"
   * (null/undefined = hidden). Sits in the toolbox header (§3.4; moved from the foot on
   * 2026-10-12 so its appearing cannot change the toolbox height) for every annotation
   * kind — local backup is not a SEG-only concern, so it is not part of the SEG controls.
   */
  backupStatus?: string | null;
  /**
   * Which backup state the text reports. The mockup depicts the success row
   * (emerald check); in-flight and failed backups reuse the row with their own
   * icon/color rather than a toast (§3.4). Defaults to 'saved'.
   */
  backupStatusKind?: 'saving' | 'saved' | 'error';
  /** The Smart tools' own controls, for the active tool (rendered when it declares 'semiAuto'). */
  renderSemiAutoControls?: (toolId: string) => ReactNode;
  /** Live Wire / Spline drawing settings, for the active tool (when it declares 'contourDraw'). */
  renderContourControls?: (toolId: string) => ReactNode;
  /**
   * The member being edited and its container, for the options strip's editing chip — the
   * one place outside the list that names it (R6). Clicking the chip reveals the row.
   */
  editing?: { member: string; container: string; color: string } | null;
  onRevealEditing?: () => void;
  /**
   * Segmentation: the ROI limit, a rectangle that Level Trace, the operations and the
   * modules stay inside. Not a family: it confines tools rather than being one, so its
   * toggle sits in the header band where every tool and operation can reach it.
   */
  roiLimit?: { drawing: boolean; drawn: boolean; onToggleDraw: () => void; onClear: () => void };
  /** Segmentation: each family's last-used tool, which the family button re-activates. */
  lastToolOfFamily?: Partial<Record<string, string>>;
}

export default function ContextToolbox(props: ContextToolboxProps) {
  const {
    kind, activeMemberName, activeMemberColor, activeToolId, disabledToolIds = [], unavailableTools = {}, onSelectTool, compact, columns = 3, controls,
    backupStatus, backupStatusKind, renderSemiAutoControls, renderContourControls, editing, onRevealEditing, lastToolOfFamily = {}, roiLimit,
  } = props;
  const tools = toolsForKind(kind);
  const disabled = new Set(disabledToolIds);
  const nameColor = activeMemberColor ?? KIND_COLOR[kind];
  void activeMemberName; // named once, by the editing chip (R6)
  // The threshold window applies only to the threshold brush, so its control appears
  // only while that tool is active (rather than sitting inert under every other tool).
  // Which controls the ACTIVE tool declares it cannot be used without. Driven by the
  // catalog rather than by a hardcoded tool id: the intensity window used to be gated on
  // `activeToolId === 'threshold'` alone, so the sphere-threshold and rectangle-threshold
  // tools had no way to set the window they depend on. A brush radius was shown for every
  // SEG tool, including scissors and Select, which ignore it.
  const activeTool = tools.find((t) => t.id === activeToolId);
  const needs = (c: ToolControl) => !!activeTool?.needs?.includes(c);
  const activeThresholdPreset =
    controls?.thresholdRange &&
    controls.thresholdPresets?.find(
      (p) => p.range[0] === controls.thresholdRange![0] && p.range[1] === controls.thresholdRange![1],
    )?.name;

  function renderTool(t: ToolDef) {
    const isActive = t.id === activeToolId;
    const unavailable = unavailableTools[t.id];
    const isDisabled = disabled.has(t.id) || !!unavailable;
    let cls: string;
    if (isActive) cls = 'bg-blue-600 text-white';
    else if (isDisabled) cls = 'bg-zinc-900 border border-dashed border-zinc-800 text-zinc-700 cursor-not-allowed';
    else cls = 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300';
    return (
      <button
        key={t.id}
        type="button"
        disabled={isDisabled}
        title={unavailable ?? t.title}
        aria-label={t.label}
        aria-pressed={isActive}
        onClick={() => onSelectTool(t.id)}
        className={`flex items-center min-w-0 py-1.5 rounded ${columns === 4 ? 'gap-1 px-1' : 'gap-1.5 px-2'} ${cls} ${compact ? 'justify-center' : ''}`}
      >
        {t.icon}
        {!compact && <span className="truncate">{t.label}</span>}
      </button>
    );
  }

  // Segmentation shows one row of families (R3-B); a family's mode rows pick its tool.
  const families = kind === 'SEG' ? SEG_FAMILIES : null;
  const activeFamily = families ? familyOf(activeToolId) : undefined;
  const whyOff = (id: string) => unavailableTools[id] ?? (disabled.has(id) ? 'No viewport shows this scan' : undefined);

  function renderFamily(f: ToolFamily) {
    const isActive = f.id === activeFamily?.id;
    const reachable = f.members.filter((id) => !whyOff(id));
    const unavailable = reachable.length ? undefined : whyOff(f.members[0]);
    const target = [lastToolOfFamily[f.id], ...f.members].find((id) => id && !whyOff(id));
    let cls: string;
    if (isActive) cls = 'bg-blue-600 text-white';
    else if (unavailable) cls = 'bg-zinc-900 border border-dashed border-zinc-800 text-zinc-700 cursor-not-allowed';
    else cls = 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300';
    return (
      <button
        key={f.id}
        type="button"
        disabled={!!unavailable}
        title={unavailable ?? f.title}
        aria-label={f.label}
        aria-pressed={isActive}
        onClick={() => target && onSelectTool(target)}
        className={`flex flex-col items-center justify-center gap-0.5 min-w-0 py-1 rounded ${cls}`}
      >
        {f.icon}
        {!compact && <span className="text-[9px] leading-none truncate max-w-full">{f.label}</span>}
      </button>
    );
  }

  /** The active family's mode rows: one segmented choice per axis. */
  function renderModes(f: ToolFamily) {
    const current = activeToolId ? f.modes?.[activeToolId] : undefined;
    return (f.axes ?? []).map((axis) => (
      <div key={axis.id} className="flex items-center gap-2 mt-1.5 first:mt-0" data-testid={`mode-${axis.id}`}>
        <span className="text-[10px] text-zinc-400 whitespace-nowrap w-12 shrink-0">{axis.label}</span>
        <div className="flex flex-1 rounded overflow-hidden border border-zinc-700" role="group" aria-label={axis.label}>
          {axis.options.map((o) => {
            const to = resolveMode(f, activeToolId, axis.id, o.value);
            const off = !to ? 'Not available' : whyOff(to);
            const pressed = current?.[axis.id] === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={pressed}
                disabled={!!off}
                title={off ?? o.title}
                onClick={() => to && to !== activeToolId && onSelectTool(to)}
                className={`flex-1 text-[10px] py-0.5 whitespace-nowrap disabled:opacity-40 ${pressed ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    ));
  }

  const chip = editing && (
    <button
      type="button"
      data-testid="editing-chip"
      onClick={onRevealEditing}
      title="Drawing writes here — click to show it in the list"
      className="flex items-center gap-1.5 max-w-full min-w-0 mb-1.5 px-1.5 py-0.5 rounded bg-zinc-800/80 hover:bg-zinc-700 text-[10px]"
    >
      <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: editing.color || nameColor }} />
      <span className="truncate text-zinc-200">{editing.member}</span>
      <span className="truncate text-zinc-500">· {editing.container}</span>
    </button>
  );

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80 flex flex-col min-h-0" style={{ flex: '0 1 auto' }} data-testid="context-toolbox">
      <div className="px-3 h-7 flex items-center gap-2 shrink-0 bg-zinc-800/70 border-b border-zinc-700" data-testid="toolbox-header">
        <span className="text-[9px] text-zinc-300 font-semibold uppercase tracking-wide whitespace-nowrap">{KIND_TOOLS_LABEL[kind]}</span>
        <span className="flex-1" />
        {backupStatus && (
          <span
            data-testid="backup-status"
            title={backupStatus}
            className={`flex items-center gap-1 min-w-0 text-[10px] ${BACKUP_ROW_STYLE[backupStatusKind ?? 'saved']}`}
          >
            <span className="shrink-0"><BackupIcon kind={backupStatusKind ?? 'saved'} /></span>
            <span className="truncate">{backupStatus}</span>
          </span>
        )}
        {roiLimit && (
          <span className="flex items-center shrink-0 rounded overflow-hidden border border-zinc-600">
            <button
              type="button"
              aria-label="ROI limit"
              aria-pressed={roiLimit.drawing}
              onClick={roiLimit.onToggleDraw}
              title={roiLimit.drawing ? 'Drawing the ROI limit — click to go back to your tool' : 'Drag a rectangle that Level Trace, the operations and modules stay inside'}
              className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] ${roiLimit.drawing ? 'bg-blue-600 text-white' : roiLimit.drawn ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
            >
              <svg viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.4}><rect x="3" y="4" width="10" height="8" rx="1" strokeDasharray="2 1.3" /></svg>
              ROI
            </button>
            {roiLimit.drawn && (
              <button type="button" aria-label="Clear ROI limit" title="Clear the ROI limit" onClick={roiLimit.onClear} className="px-1 py-0.5 text-[10px] bg-zinc-800 text-zinc-400 hover:text-zinc-100 border-l border-zinc-600">✕</button>
            )}
          </span>
        )}
      </div>

      {families ? (
        <div className="px-2 py-1.5 grid grid-cols-7 gap-1 shrink-0" data-testid="toolbox-grid">
          {families.map(renderFamily)}
        </div>
      ) : (
        <div className={`px-2 py-2 grid ${columns === 4 ? 'grid-cols-4' : 'grid-cols-3'} gap-1 text-[11px] shrink-0`} data-testid="toolbox-grid">
          {tools.map(renderTool)}
        </div>
      )}

      {!controls && chip && <div className="px-3 pt-2 pb-0.5 border-t border-zinc-800" data-testid="toolbox-controls">{chip}</div>}
      {controls && (
        <>
          <div
            data-testid="toolbox-controls"
            className="px-3 py-2 border-t border-zinc-800 overflow-y-auto min-h-0"
            style={CONTROLS_HEIGHT[kind] ? { flex: `0 1 ${CONTROLS_HEIGHT[kind]}px`, minHeight: CONTROLS_MIN_HEIGHT } : { flex: 'none' }}
          >
            {chip}
            {activeFamily && renderModes(activeFamily)}
            {controls.lineWidth != null && controls.onLineWidthChange && (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-zinc-400 whitespace-nowrap">Contour thickness</span>
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={controls.lineWidth}
                  onChange={(e) => controls.onLineWidthChange?.(Number(e.target.value))}
                  aria-label="Contour thickness"
                  className="flex-1 accent-blue-500"
                />
                <span className="text-[10px] text-zinc-300">{controls.lineWidth}px</span>
              </div>
            )}
            {controls.opacity != null && controls.onOpacityChange && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-zinc-400 whitespace-nowrap">{controls.opacityLabel ?? 'Labelmap opacity'}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(controls.opacity * 100)}
                onChange={(e) => controls.onOpacityChange!(Number(e.target.value) / 100)}
                aria-label={controls.opacityLabel ?? 'Labelmap opacity'}
                className="flex-1 accent-blue-500"
              />
              <span className="text-[10px] text-zinc-300">{Math.round(controls.opacity * 100)}%</span>
            </div>
            )}
            {needs('brushSize') && controls.brushSize != null && controls.onBrushSizeChange && (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-zinc-400 whitespace-nowrap">Brush size</span>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={controls.brushSize}
                  onChange={(e) => controls.onBrushSizeChange!(Number(e.target.value))}
                  aria-label="Brush size"
                  className="flex-1 accent-blue-500"
                />
                <span className="text-[10px] text-zinc-300">{controls.brushSize}&nbsp;mm</span>
              </div>
            )}
            {needs('samplingRadius') && controls.samplingRadius != null && controls.onSamplingRadiusChange && (
              <div className="flex items-center gap-2 mt-1.5" data-testid="sampling-radius-controls">
                <span className="text-[10px] text-zinc-400 whitespace-nowrap">Sample radius</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={controls.samplingRadius}
                  onChange={(e) => controls.onSamplingRadiusChange!(Number(e.target.value))}
                  aria-label="Sample radius"
                  className="flex-1 accent-blue-500"
                />
                <span className="text-[10px] text-zinc-300">{controls.samplingRadius} vox</span>
              </div>
            )}
            {needs('editMode') && controls.editMode && controls.onEditModeChange && (
              <div className="flex items-center gap-2 mt-1.5" data-testid="edit-mode-controls">
                <span className="text-[10px] text-zinc-400 whitespace-nowrap">Mode</span>
                <div className="flex flex-1 rounded overflow-hidden border border-zinc-700" role="group" aria-label="Edit mode">
                  {(['fill', 'erase'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={controls.editMode === mode}
                      onClick={() => controls.onEditModeChange!(mode)}
                      className={`flex-1 text-[10px] py-0.5 capitalize ${
                        controls.editMode === mode
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-zinc-500 whitespace-nowrap">⇧ inverts</span>
              </div>
            )}
            {needs('intensityWindow') && controls.thresholdRange && controls.onThresholdRangeChange && (
              <div className="mt-1.5" data-testid="threshold-controls">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-400 whitespace-nowrap">Threshold</span>
                  <input
                    type="number"
                    value={controls.thresholdRange[0]}
                    onChange={(e) =>
                      controls.onThresholdRangeChange!([Number(e.target.value), controls.thresholdRange![1]])
                    }
                    aria-label="Threshold minimum"
                    className="w-16 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px] tabular-nums"
                  />
                  <span className="text-[10px] text-zinc-500">to</span>
                  <input
                    type="number"
                    value={controls.thresholdRange[1]}
                    onChange={(e) =>
                      controls.onThresholdRangeChange!([controls.thresholdRange![0], Number(e.target.value)])
                    }
                    aria-label="Threshold maximum"
                    className="w-16 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px] tabular-nums"
                  />
                </div>
                {!!controls.thresholdPresets?.length && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-zinc-400 whitespace-nowrap">Preset</span>
                    <select
                      value={activeThresholdPreset ?? ''}
                      onChange={(e) => {
                        const preset = controls.thresholdPresets!.find((p) => p.name === e.target.value);
                        if (preset) controls.onThresholdRangeChange!([...preset.range] as [number, number]);
                      }}
                      aria-label="Threshold preset"
                      className="flex-1 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
                    >
                      <option value="">Custom</option>
                      {controls.thresholdPresets!.map((p) => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
            {needs('semiAuto') && activeToolId && renderSemiAutoControls?.(activeToolId)}
            {needs('contourDraw') && activeToolId && renderContourControls?.(activeToolId)}
          </div>
        </>
      )}

    </div>
  );
}
