/**
 * ContextToolbox (Rebuild Phase 3, R3.6) — the kind-adaptive tool grid (frozen
 * mockup §4). Presentational. Header = "<KIND> tools" + the active member's name
 * in its kind color. 3-column icon+label grid (responsive → icon-only when
 * `compact`). Tool states: active = blue; unavailable here = disabled
 * (temporary); FoR-disabled = dashed + slash + disabled (D3, supplied at runtime
 * via `disabledToolIds`); otherwise normal. Segmentation adds a Controls strip
 * (active segment + labelmap-opacity slider) + the silent in-place backup status
 * (§3.4 — never a toast/banner). Behaviour injected via callbacks.
 */
import type { ContainerKind } from '@shared/types/annotation';
import type { ThresholdPreset } from '@shared/types/viewer';
import { KIND_TOOLS_LABEL, toolsForKind, type ToolControl } from './toolCatalog';

const KIND_COLOR: Record<ContainerKind, string> = {
  RTSTRUCT: '#ef4444', // member-name color follows the active member's swatch; default red
  SEG: '#ec4899',
  SR: '#eab308',
};

export interface ContextToolboxControls {
  /** Active segment label (SEG controls strip). */
  activeSegmentLabel: string;
  activeSegmentColor?: string;
  /** Labelmap opacity 0–1. */
  opacity: number;
  onOpacityChange: (value: number) => void;
  /** Brush radius in voxels (the segmentation brush family). Omit to hide the control. */
  brushSize?: number;
  onBrushSizeChange?: (value: number) => void;
  /** Voxel radius the dynamic-threshold brush samples around the first click. */
  samplingRadius?: number;
  onSamplingRadiusChange?: (radius: number) => void;
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
  onSelectTool: (toolId: string) => void;
  /** Icon-only when the panel is narrow. */
  compact?: boolean;
  /** SEG-only controls strip. */
  controls?: ContextToolboxControls;
  /**
   * Silent in-place local-backup status text, e.g. "Backed up · 2s ago"
   * (null/undefined = hidden). Sits at the foot of the toolbox (§3.4) for every
   * annotation kind — local backup is not a SEG-only concern, so it is not part
   * of the SEG controls strip.
   */
  backupStatus?: string | null;
  /**
   * Which backup state the text reports. The mockup depicts the success row
   * (emerald check); in-flight and failed backups reuse the row with their own
   * icon/color rather than a toast (§3.4). Defaults to 'saved'.
   */
  backupStatusKind?: 'saving' | 'saved' | 'error';
}

export default function ContextToolbox(props: ContextToolboxProps) {
  const { kind, activeMemberName, activeMemberColor, activeToolId, disabledToolIds = [], onSelectTool, compact, controls, backupStatus, backupStatusKind } = props;
  const tools = toolsForKind(kind);
  const disabled = new Set(disabledToolIds);
  const nameColor = activeMemberColor ?? KIND_COLOR[kind];
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

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80" data-testid="context-toolbox">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wide">{KIND_TOOLS_LABEL[kind]}</span>
        <span className="text-[10px]" style={{ color: nameColor }}>{activeMemberName}</span>
      </div>

      <div className={`p-2 grid grid-cols-3 gap-1 text-[11px]`}>
        {tools.map((t) => {
          const isActive = t.id === activeToolId;
          const isDisabled = disabled.has(t.id);
          let cls: string;
          if (isActive) cls = 'bg-blue-600 text-white';
          else if (disabled.has(t.id)) cls = 'bg-zinc-900 border border-dashed border-zinc-800 text-zinc-700 cursor-not-allowed';
          else cls = 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300';
          return (
            <button
              key={t.id}
              type="button"
              disabled={isDisabled}
              title={t.title}
              aria-label={t.label}
              aria-pressed={isActive}
              onClick={() => onSelectTool(t.id)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded ${cls} ${compact ? 'justify-center' : ''}`}
            >
              {t.icon}
              {!compact && <span className="truncate">{t.label}</span>}
            </button>
          );
        })}
      </div>

      {controls && (
        <>
          <div className="px-3 py-2 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-zinc-500 uppercase tracking-wide">Controls</span>
              <span className="flex items-center gap-1 text-[10px] text-zinc-300">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: controls.activeSegmentColor ?? nameColor }} />
                {controls.activeSegmentLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-zinc-400 whitespace-nowrap">Labelmap opacity</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(controls.opacity * 100)}
                onChange={(e) => controls.onOpacityChange(Number(e.target.value) / 100)}
                aria-label="Labelmap opacity"
                className="flex-1 accent-blue-500"
              />
              <span className="text-[10px] text-zinc-300">{Math.round(controls.opacity * 100)}%</span>
            </div>
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
                <span className="text-[10px] text-zinc-300">{controls.brushSize}px</span>
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
          </div>
        </>
      )}

      {backupStatus && (
        <div
          data-testid="backup-status"
          className={`px-3 py-1.5 border-t border-zinc-800 flex items-center gap-1.5 text-[10px] ${BACKUP_ROW_STYLE[backupStatusKind ?? 'saved']}`}
        >
          <BackupIcon kind={backupStatusKind ?? 'saved'} />
          {backupStatus}
        </div>
      )}
    </div>
  );
}
