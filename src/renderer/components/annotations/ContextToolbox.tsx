/**
 * ContextToolbox (Rebuild Phase 3, R3.6) — the kind-adaptive tool grid (frozen
 * mockup §4). Presentational. Header = "<KIND> tools" + the active member's name
 * in its kind color. 3-column icon+label grid (responsive → icon-only when
 * `compact`). Tool states: active = blue; planned = flat-greyed + disabled
 * (temporary); FoR-disabled = dashed + slash + disabled (D3, supplied at runtime
 * via `disabledToolIds`); otherwise normal. Segmentation adds a Controls strip
 * (active segment + labelmap-opacity slider) + the silent in-place backup status
 * (§3.4 — never a toast/banner). Behaviour injected via callbacks.
 */
import type { ContainerKind } from '@shared/types/annotation';
import { KIND_TOOLS_LABEL, toolsForKind } from './toolCatalog';

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
  /** Silent in-place backup status text, e.g. "Backed up · 2s ago" (null = hidden). */
  backupStatus?: string | null;
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
}

export default function ContextToolbox(props: ContextToolboxProps) {
  const { kind, activeMemberName, activeMemberColor, activeToolId, disabledToolIds = [], onSelectTool, compact, controls } = props;
  const tools = toolsForKind(kind);
  const disabled = new Set(disabledToolIds);
  const nameColor = activeMemberColor ?? KIND_COLOR[kind];

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80" data-testid="context-toolbox">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wide">{KIND_TOOLS_LABEL[kind]}</span>
        <span className="text-[10px]" style={{ color: nameColor }}>{activeMemberName}</span>
      </div>

      <div className={`p-2 grid grid-cols-3 gap-1 text-[11px]`}>
        {tools.map((t) => {
          const isActive = t.id === activeToolId;
          const isDisabled = t.planned || disabled.has(t.id);
          let cls: string;
          if (isActive) cls = 'bg-blue-600 text-white';
          else if (t.planned) cls = 'bg-zinc-800/40 text-zinc-600 cursor-not-allowed';
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
          </div>
          {controls.backupStatus && (
            <div className="px-3 py-1.5 border-t border-zinc-800 flex items-center gap-1.5 text-[10px] text-emerald-400/90">
              <svg viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 8.5l3 3 7-7" /></svg>
              {controls.backupStatus}
            </div>
          )}
        </>
      )}
    </div>
  );
}
